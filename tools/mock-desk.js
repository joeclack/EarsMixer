"use strict";

/**
 * Mock DiGiCo console for developing / debugging EarsMixer without real hardware.
 *
 * It listens on the desk port and answers the OSC queries that index.js sends while
 * loading (channel count, aux modes, channel + aux names, snapshot, send levels and
 * pans), so the server reaches its "ready" state and the web mixer, plugins and
 * external-device routing can all be exercised on a workbench.
 *
 * Every message the server sends is printed, so this doubles as a way to see exactly
 * what the web mixer is doing to the desk.
 *
 * Usage:
 *   node tools/mock-desk.js                 # uses ./config.json (or defaults)
 *   node tools/mock-desk.js --channels 32 --auxes 8
 *   node tools/mock-desk.js --port 9000 --reply-port 8000 --host 127.0.0.1
 *   node tools/mock-desk.js --live          # also push periodic snapshot changes
 *   node tools/mock-desk.js --x32           # pretend to be a Behringer X32 on port 10023
 *
 * Point webmixer at it by setting the desk IP to this machine (127.0.0.1 when both
 * run on the same box) in the admin area.
 */

const fs = require("fs");
const path = require("path");
const osc = require("osc");

/**
 * Parse "--flag value" / "--flag" style arguments.
 * @returns {Object.<string, string|boolean>}
 */
function parseArgs(argv)
{
	const args = {};
	for(let i = 0; i < argv.length; i++)
	{
		if(!argv[i].startsWith("--"))
		{
			continue;
		}
		const key = argv[i].slice(2);
		const next = argv[i + 1];
		if(next === undefined || next.startsWith("--"))
		{
			args[key] = true;
		}
		else
		{
			args[key] = next;
			i++;
		}
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));

/**
 * Read ports from ./config.json when it exists so the mock lines up with whatever
 * webmixer is configured to use. CLI flags win over the file.
 */
let fileConfig = {};
const configPath = path.join(process.cwd(), "config.json");
if(fs.existsSync(configPath))
{
	try
	{
		fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
	}
	catch(e)
	{
		console.warn(`Could not parse ${configPath}: ${e.message}. Using defaults.`);
	}
}

const X32 = Boolean(args.x32);
const DESK_PORT = parseInt(args.port ?? (X32 ? 10023 : fileConfig?.desk?.port ?? 9000), 10);
const REPLY_PORT = parseInt(args["reply-port"] ?? fileConfig?.osc?.port ?? 8000, 10);
const HOST = args.host ?? "0.0.0.0";
const CHANNEL_COUNT = parseInt(args.channels ?? 24, 10);
const AUX_COUNT = parseInt(args.auxes ?? args.auxilaries ?? 6, 10);

const CHANNEL_NAMES = [
	"Kick", "Snare Top", "Snare Btm", "Hi Hat", "Rack Tom", "Floor Tom",
	"OH L", "OH R", "Bass", "Gtr 1", "Gtr 2",
	"Acoustic", "Keys", "MD", "Click", "Track",
	"Vox 1", "Vox 2", "Vox 3", "Vox 4", "MC"
];
const AUX_NAMES = [
	"Drums IEM", "Bass IEM", "Gtr IEM", "Keys IEM", "Vox 1 IEM", "MD Mix",
	"Vox 2 IEM","Vox 3 IEM","Vox 4 IEM"
];

/**
 * Build the mock desk state.
 */
const state = {
	channelCount: CHANNEL_COUNT,
	// alternate mono (1) / stereo (2) auxes so both code paths get exercised
	auxModes: Array.from({ length: AUX_COUNT }, (_, i) => (i % 3 === 2 ? 2 : 1)),
	channelName: (n) => CHANNEL_NAMES[(n - 1) % CHANNEL_NAMES.length] || `Channel ${n}`,
	auxName: (n) => AUX_NAMES[(n - 1) % AUX_NAMES.length] || `Aux ${n}`,
	snapshotIndex: 1,
	snapshotNames: ["Default", "Sunday Service", "Band 1", "Support", "Headliner", "Walk Out"],
	// live send level (dB) / pan (0..1) values, keyed by OSC address, lazily defaulted
	sends: new Map()
};

/**
 * Default send level / pan for a channel->aux pair before anything has moved it.
 */
function defaultSend(address)
{
	return address.endsWith("send_pan") ? 0.5 : -12;
}

const udpPort = new osc.UDPPort({
	localAddress: HOST,
	localPort: DESK_PORT,
	metadata: false
});

let replyTo = null; // { address, port } of the webmixer server, learned from its first packet
let dropQueryOnce = args['drop-query-once'];

/**
 * Send an OSC message back to the webmixer server.
 */
function reply(address, oscArgs)
{
	const target = replyTo || { address: "127.0.0.1", port: REPLY_PORT };
	udpPort.send({ address: address, args: oscArgs }, target.address, target.port);
	console.log(`  -> ${address} ${JSON.stringify(oscArgs)}`);
}

udpPort.on("ready", function()
{
	if(X32)
	{
		console.log(`Mock X32 listening on ${HOST}:${DESK_PORT}: 32 channels, 8 aux inputs, 16 buses (3-4 linked).`);
		return;
	}
	console.log(`Mock DiGiCo desk listening on ${HOST}:${DESK_PORT}`);
	console.log(`Replies go to the webmixer OSC port ${REPLY_PORT} (learned from incoming packets).`);
	console.log(`${state.channelCount} channels, ${state.auxModes.length} auxes ` +
		`(${state.auxModes.filter(m => m === 2).length} stereo).`);
	console.log("Set the desk IP in the webmixer admin area to this machine, then reload.\n");
});

udpPort.on("error", function(err)
{
	console.error("UDP error:", err && err.stack ? err.stack : err);
});

udpPort.on("message", function(oscMsg, timeTag, info)
{
	replyTo = { address: info.address, port: info.port };

	const address = oscMsg.address;
	console.log(`<- ${address} ${oscMsg.args && oscMsg.args.length ? JSON.stringify(oscMsg.args) : ""}`.trimEnd());
	if(X32) return handleX32(oscMsg);
	if(address === dropQueryOnce) {
		dropQueryOnce = null;
		console.log('  (dropping one reply to simulate packet loss)');
		return;
	}

	// --- query for a value (address ends with /?) ---
	if(address.endsWith("/?"))
	{
		const q = address.slice(0, -2);
		let m;

		if(q === "/Console/Channels")
		{
			return reply("/Console/Input_Channels", [state.channelCount]);
		}

		if(q === "/Console/Aux_Outputs/modes")
		{
			return reply("/Console/Aux_Outputs/modes", state.auxModes.slice());
		}

		if((m = q.match(/^\/Aux_Outputs\/(\d+)\/Buss_Trim\/name$/)))
		{
			return reply(`/Aux_Outputs/${m[1]}/Buss_Trim/name`, [state.auxName(parseInt(m[1], 10))]);
		}

		if((m = q.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/name$/)))
		{
			return reply(`/Input_Channels/${m[1]}/Channel_Input/name`, [state.channelName(parseInt(m[1], 10))]);
		}

		if(q === "/Snapshots/Current_Snapshot")
		{
			return reply("/Snapshots/Current_Snapshot", [state.snapshotIndex]);
		}

		if(q === "/Snapshots/names")
		{
			const name = state.snapshotNames[state.snapshotIndex] || `Snapshot ${state.snapshotIndex}`;
			// webmixer expects args[0] === current index and the name as the last arg
			return reply("/Snapshots/name", [state.snapshotIndex, name]);
		}

		if((m = q.match(/^\/Input_Channels\/\d+\/Aux_Send\/\d+\/send_(level|pan)$/)))
		{
			const value = state.sends.has(q) ? state.sends.get(q) : defaultSend(q);
			return reply(q, [value]);
		}

		// unknown query - stay quiet, a real desk simply wouldn't answer
		return;
	}

	// --- a value being set by a web client (forwarded through webmixer) ---
	let m = address.match(/^\/Input_Channels\/\d+\/Aux_Send\/\d+\/send_(level|pan)$/);
	if(m && oscMsg.args && oscMsg.args.length)
	{
		state.sends.set(address, oscMsg.args[0]);
		return;
	}

	// --- session reload ---
	if(address === "/Console/Session/!")
	{
		console.log("  (session reload requested)");
		return;
	}
});

/**
 * Behringer X32 emulation: 32 channels, 8 aux inputs and 16 buses, with buses
 * 3-4 linked as a stereo pair. A query is an address with no arguments, the
 * answer goes to the port the question came from, and levels are fader
 * positions from 0 to 1.
 */
const x32 = {
	values: new Map([["/config/buslink/3-4", 1], ["/-show/prepos/current", 0]]),
	scenes: ["Soundcheck", "Service", "Walk Out"],
	subscribed: false
};
function x32Default(address)
{
	let m;
	if((m = address.match(/^\/ch\/(\d\d)\/config\/name$/))) return state.channelName(parseInt(m[1], 10));
	if((m = address.match(/^\/auxin\/(\d\d)\/config\/name$/))) return parseInt(m[1], 10) === 8 ? "" : `Playback ${parseInt(m[1], 10)}`;
	if((m = address.match(/^\/bus\/(\d\d)\/config\/name$/))) return state.auxName(parseInt(m[1], 10));
	if((m = address.match(/^\/-show\/showfile\/scene\/(\d{3})\/name$/))) return x32.scenes[parseInt(m[1], 10)] ?? "";
	if(/^\/config\/buslink\/\d+-\d+$/.test(address)) return 0;
	if(/^\/(ch|auxin)\/\d\d\/mix\/\d\d\/level$/.test(address)) return 0.5;
	if(/^\/(ch|auxin)\/\d\d\/mix\/\d\d\/pan$/.test(address)) return 0.5;
	return undefined;
}
function handleX32(oscMsg)
{
	const address = oscMsg.address;
	if(address === "/xinfo") return reply("/xinfo", ["127.0.0.1", "Mock X32", "X32", "4.06-8"]);
	if(address === "/info") return reply("/info", ["V2.07", "osc-server", "X32", "4.06-8"]);
	if(address === "/xremote") { x32.subscribed = true; return; }
	if(oscMsg.args && oscMsg.args.length)
	{
		if(x32Default(address) !== undefined || x32.values.has(address)) x32.values.set(address, oscMsg.args[0]);
		return;
	}
	const value = x32.values.has(address) ? x32.values.get(address) : x32Default(address);
	if(value !== undefined) reply(address, [value]);
}

udpPort.open();

/**
 * Optional: periodically move the snapshot on so the snapshot-name display and the
 * reload path can be tested without touching a desk.
 */
if(args.live)
{
	setInterval(function()
	{
		if(X32)
		{
			if(!x32.subscribed) return;
			const scene = (x32.values.get("/-show/prepos/current") + 1) % x32.scenes.length;
			x32.values.set("/-show/prepos/current", scene);
			console.log(`\n[live] scene -> ${scene} "${x32.scenes[scene]}"`);
			return reply("/-show/prepos/current", [scene]);
		}
		state.snapshotIndex = (state.snapshotIndex + 1) % state.snapshotNames.length;
		console.log(`\n[live] snapshot -> ${state.snapshotIndex} "${state.snapshotNames[state.snapshotIndex]}"`);
		reply("/Snapshots/Current_Snapshot", [state.snapshotIndex]);
	}, 15000);
}

process.on("SIGINT", function()
{
	console.log("\nStopping mock desk.");
	udpPort.close();
	process.exit(0);
});
