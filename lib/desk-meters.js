"use strict";
// Real input-channel meters from a DiGiCo SD console.
//
// The addresses come from DiGiCo's own iPad command list for the SD8, SD9,
// SD11 and SD12 (IPADV2sd8-9-11-12.dosc, shipped with the V2242 offline
// software): each input channel's Channel_Input section has "post meter/left"
// and "post meter/right", which on the wire are
//   /Input_Channels/<n>/Channel_Input/post_meter/left
//   /Input_Channels/<n>/Channel_Input/post_meter/right
// The list gives no range or unit for meters, so the scale is worked out from
// the values the desk actually sends, and is reported on the admin page.
// EarsMixer only ever queries these addresses ("/?"); it never writes them.
//
// DiGiCo sends meter replies without an OSC type tag string, which standard OSC
// parsers reject, so untagged replies are decoded here.

const METER_ADDRESS = /^\/Input_Channels\/(\d{1,3})\/Channel_Input\/post_meter\/(left|right)$/;
const FRESH_MS = 700; // older readings count as no signal
const FLOOR_DB = -60;

function meterAddress(channel, side = "left") {
	return `/Input_Channels/${channel}/Channel_Input/post_meter/${side}`;
}

/**
 * A meter reply that carries no type tags: a padded address followed directly
 * by big-endian 32-bit floats. Returns null for anything else, including
 * properly tagged messages, which the OSC library already handles.
 */
function decodeUntaggedMeter(packet) {
	const buffer = Buffer.isBuffer(packet) ? packet : Buffer.from(packet);
	if(buffer.length < 8 || buffer[0] !== 0x2f) return null; // "/"
	const end = buffer.indexOf(0);
	if(end < 0) return null;
	const address = buffer.toString("ascii", 0, end);
	if(!METER_ADDRESS.test(address)) return null;
	const offset = (end + 4) & ~3;
	const rest = buffer.length - offset;
	if(rest < 4 || rest > 32 || rest % 4 !== 0 || buffer[offset] === 0x2c) return null; // "," means tagged
	const values = [];
	for(let position = offset; position < buffer.length; position += 4) values.push(buffer.readFloatBE(position));
	return { address, args: values };
}

/**
 * How raw readings map to dBFS. The desk's units are not documented, so this
 * looks at what has arrived: negative numbers mean dB already; values between
 * 0 and about 1 mean linear amplitude. Anything else stays unknown, and then
 * no meter is shown rather than a wrong one.
 */
function detectScale(min, max) {
	if(!Number.isFinite(min) || !Number.isFinite(max)) return "unknown";
	if(min < -0.5 && max <= 30) return "db";
	if(min >= 0 && max <= 2) return "linear";
	return "unknown";
}

function toDb(raw, scale) {
	if(!Number.isFinite(raw)) return null;
	let db;
	if(scale === "db") db = raw;
	else if(scale === "linear") db = raw > 0 ? 20 * Math.log10(raw) : -Infinity;
	else return null;
	return db < FLOOR_DB ? null : Math.round(Math.min(db, 6) * 10) / 10;
}

function createDeskMeterSource({ query, isStereo = () => false, now = () => Date.now() }) {
	const readings = new Map(); // address -> { value, at }
	const stats = { replies: 0, untagged: 0, lastAt: null, min: Infinity, max: -Infinity, queried: 0 };
	return {
		kind: "live",
		/** Ask the desk for the current meter values of these channels. */
		poll(channels) {
			for(const channel of channels) {
				query(meterAddress(channel, "left"));
				if(isStereo(channel)) query(meterAddress(channel, "right"));
				stats.queried++;
			}
		},
		/** A reply from the desk. Returns true when it was a meter, so it goes no further. */
		receive(message, { untagged = false } = {}) {
			if(!message || !METER_ADDRESS.test(message.address)) return false;
			const first = message.args?.[0];
			const value = typeof first === "object" && first !== null ? first.value : first;
			if(typeof value === "number" && Number.isFinite(value)) {
				readings.set(message.address, { value, at: now() });
				stats.replies++; if(untagged) stats.untagged++;
				stats.lastAt = now();
				stats.min = Math.min(stats.min, value); stats.max = Math.max(stats.max, value);
			}
			return true;
		},
		read(channels) {
			const time = now(), scale = detectScale(stats.min, stats.max);
			return channels.map(channel => {
				const sides = [meterAddress(channel, "left"), meterAddress(channel, "right")]
					.map(address => readings.get(address)).filter(entry => entry && time - entry.at < FRESH_MS);
				if(!sides.length) return [channel, null];
				const levels = sides.map(entry => toDb(entry.value, scale)).filter(db => db !== null);
				return [channel, levels.length ? Math.max(...levels) : null];
			});
		},
		/** For the admin page: what the desk has sent so far, so the scale can be checked. */
		stats() {
			return { kind: "live", replies: stats.replies, untagged: stats.untagged, lastAt: stats.lastAt, queried: stats.queried,
				rawMin: Number.isFinite(stats.min) ? stats.min : null, rawMax: Number.isFinite(stats.max) ? stats.max : null,
				scale: detectScale(stats.min, stats.max) };
		},
	};
}

module.exports = { METER_ADDRESS, meterAddress, decodeUntaggedMeter, detectScale, toDb, createDeskMeterSource };
