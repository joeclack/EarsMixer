"use strict";

/**
 * A pretend DiGiCo console for demo mode and development.
 *
 * It listens for OSC on a UDP port and answers the queries the server sends
 * while loading (channel count, AUX modes, channel and AUX names, snapshot,
 * send levels, pans and mutes), so the server reaches its "ready" state and
 * phones can use a full mixer without a desk. Sends set by phones are kept, so
 * moving a fader and reloading shows the new level.
 *
 * Used in-process by the packaged server's demo mode (see lib/demo-mode.js) and
 * by tools/mock-desk.js for development.
 */

const osc = require("osc");

const CHANNEL_NAMES = [
	"Kick", "Snare Top", "Snare Btm", "Hi Hat", "Rack Tom", "Floor Tom",
	"OH L", "OH R", "Bass", "Gtr 1", "Gtr 2",
	"Acoustic", "Keys", "MD", "Click", "Track",
	"Vox 1", "Vox 2", "Vox 3", "Vox 4", "MC"
];
const AUX_NAMES = [
	"Drums IEM", "Bass IEM", "Gtr IEM", "Keys IEM", "Vox 1 IEM", "MD Mix",
	"Vox 2 IEM", "Vox 3 IEM", "Vox 4 IEM"
];
const SNAPSHOT_NAMES = ["Default", "Sunday Service", "Band 1", "Support", "Headliner", "Walk Out"];

/** Default send level (dB), pan (0..1) or on (1) before anything has moved it. */
function defaultSend(address) {
	return address.endsWith("send_pan") ? 0.5 : address.endsWith("send_on") ? 1 : -12;
}

/**
 * Start the demo desk.
 * @param {object} options
 * @param {string} [options.host] Address to listen on. Defaults to loopback.
 * @param {number} options.port UDP port the server sends desk OSC to.
 * @param {number} options.replyPort The server's OSC receive port, used until it has sent a packet.
 * @param {number} [options.channels] Input channels (default 20).
 * @param {number} [options.auxes] AUX mixes (default 8). Every third is stereo.
 * @param {boolean} [options.live] Move to the next snapshot every 15 seconds.
 * @param {string} [options.dropQueryOnce] Ignore the first query for this address (tests packet loss).
 * @param {(line: string) => void} [options.log] Receives a line per OSC message. Silent by default.
 * @returns {Promise<{ port: number, close: () => void }>} Resolves once listening.
 */
function startDemoDesk({ host = "127.0.0.1", port, replyPort, channels = 20, auxes = 8, live = false, dropQueryOnce = null, log = () => {} }) {
	const state = {
		channelCount: channels,
		auxModes: Array.from({ length: auxes }, (_, i) => (i % 3 === 2 ? 2 : 1)),
		snapshotIndex: 1,
		sends: new Map(),
	};
	const channelName = n => CHANNEL_NAMES[(n - 1) % CHANNEL_NAMES.length] || `Channel ${n}`;
	const auxName = n => AUX_NAMES[(n - 1) % AUX_NAMES.length] || `Aux ${n}`;

	const udpPort = new osc.UDPPort({ localAddress: host, localPort: port, metadata: false });
	let replyTo = null; // the server's address and port, learned from its first packet
	let liveTimer = null;

	function reply(address, args) {
		const target = replyTo || { address: "127.0.0.1", port: replyPort };
		udpPort.send({ address, args }, target.address, target.port);
		log(`  -> ${address} ${JSON.stringify(args)}`);
	}

	udpPort.on("message", (message, timeTag, info) => {
		replyTo = { address: info.address, port: info.port };
		const address = message.address;
		log(`<- ${address} ${message.args && message.args.length ? JSON.stringify(message.args) : ""}`.trimEnd());
		if (address === dropQueryOnce) {
			dropQueryOnce = null;
			log("  (dropping one reply to simulate packet loss)");
			return;
		}

		if (address.endsWith("/?")) {
			const query = address.slice(0, -2);
			let m;
			if (query === "/Console/Channels") return reply("/Console/Input_Channels", [state.channelCount]);
			if (query === "/Console/Aux_Outputs/modes") return reply("/Console/Aux_Outputs/modes", state.auxModes.slice());
			if ((m = query.match(/^\/Aux_Outputs\/(\d+)\/Buss_Trim\/name$/))) return reply(`/Aux_Outputs/${m[1]}/Buss_Trim/name`, [auxName(Number(m[1]))]);
			if ((m = query.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/name$/))) return reply(`/Input_Channels/${m[1]}/Channel_Input/name`, [channelName(Number(m[1]))]);
			if (query === "/Snapshots/Current_Snapshot") return reply("/Snapshots/Current_Snapshot", [state.snapshotIndex]);
			if (query === "/Snapshots/names") {
				// The server expects args[0] to be the current index and the name last.
				return reply("/Snapshots/name", [state.snapshotIndex, SNAPSHOT_NAMES[state.snapshotIndex] || `Snapshot ${state.snapshotIndex}`]);
			}
			if (/^\/Input_Channels\/\d+\/Aux_Send\/\d+\/send_(level|pan|on)$/.test(query)) {
				return reply(query, [state.sends.has(query) ? state.sends.get(query) : defaultSend(query)]);
			}
			return; // A real desk doesn't answer unknown queries either.
		}

		if (/^\/Input_Channels\/\d+\/Aux_Send\/\d+\/send_(level|pan|on)$/.test(address) && message.args && message.args.length) {
			state.sends.set(address, message.args[0]);
			return;
		}
		if (address === "/Console/Session/!") log("  (session reload requested)");
	});

	return new Promise((resolve, reject) => {
		let ready = false;
		udpPort.on("error", error => {
			if (!ready) { reject(error); return; }
			log("Demo desk UDP error: " + (error && error.message ? error.message : error));
		});
		udpPort.on("ready", () => {
			ready = true;
			if (live) {
				liveTimer = setInterval(() => {
					state.snapshotIndex = (state.snapshotIndex + 1) % SNAPSHOT_NAMES.length;
					log(`[live] snapshot -> ${state.snapshotIndex} "${SNAPSHOT_NAMES[state.snapshotIndex]}"`);
					reply("/Snapshots/Current_Snapshot", [state.snapshotIndex]);
				}, 15000);
				liveTimer.unref?.();
			}
			resolve({
				port,
				close() {
					if (liveTimer) clearInterval(liveTimer);
					try { udpPort.close(); } catch {}
				},
			});
		});
		udpPort.open();
	});
}

module.exports = { startDemoDesk };
