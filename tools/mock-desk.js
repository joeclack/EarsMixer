"use strict";

/**
 * Mock DiGiCo console for developing / debugging EarsMixer without real hardware.
 * The desk itself lives in lib/demo-desk.js, which the packaged server's demo
 * mode also uses; this script runs it on its own and prints every message, so it
 * doubles as a way to see exactly what the web mixer sends to the desk.
 *
 * Usage:
 *   node tools/mock-desk.js                 # uses ./config.json (or defaults)
 *   node tools/mock-desk.js --channels 32 --auxes 8
 *   node tools/mock-desk.js --port 9000 --reply-port 8000 --host 127.0.0.1
 *   node tools/mock-desk.js --live          # also push periodic snapshot changes
 *
 * Point webmixer at it by setting the desk IP to this machine (127.0.0.1 when both
 * run on the same box) in the admin area.
 */

const fs = require("fs");
const path = require("path");
const { startDemoDesk } = require("../lib/demo-desk.js");

/**
 * Parse "--flag value" / "--flag" style arguments.
 * @returns {Object.<string, string|boolean>}
 */
function parseArgs(argv)
{
	const args = {};
	for(let i = 0; i < argv.length; i++)
	{
		if(!argv[i].startsWith("--")) continue;
		const key = argv[i].slice(2);
		const next = argv[i + 1];
		if(next === undefined || next.startsWith("--")) args[key] = true;
		else { args[key] = next; i++; }
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));

// Read ports from ./config.json when it exists so the mock lines up with whatever
// webmixer is configured to use. CLI flags win over the file.
let fileConfig = {};
const configPath = path.join(process.cwd(), "config.json");
if(fs.existsSync(configPath))
{
	try { fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8")); }
	catch(e) { console.warn(`Could not parse ${configPath}: ${e.message}. Using defaults.`); }
}

const DESK_PORT = parseInt(args.port ?? fileConfig?.desk?.port ?? 9000, 10);
const REPLY_PORT = parseInt(args["reply-port"] ?? fileConfig?.osc?.port ?? 8000, 10);
const HOST = args.host ?? "0.0.0.0";
const CHANNEL_COUNT = parseInt(args.channels ?? 24, 10);
const AUX_COUNT = parseInt(args.auxes ?? args.auxilaries ?? 6, 10);

startDemoDesk({
	host: HOST, port: DESK_PORT, replyPort: REPLY_PORT, channels: CHANNEL_COUNT, auxes: AUX_COUNT,
	live: Boolean(args.live), dropQueryOnce: typeof args["drop-query-once"] === "string" ? args["drop-query-once"] : null,
	log: line => console.log(line),
}).then(desk => {
	console.log(`Mock DiGiCo desk listening on ${HOST}:${DESK_PORT}`);
	console.log(`Replies go to the webmixer OSC port ${REPLY_PORT} (learned from incoming packets).`);
	console.log(`${CHANNEL_COUNT} channels, ${AUX_COUNT} auxes (${Array.from({ length: AUX_COUNT }, (_, i) => i % 3 === 2).filter(Boolean).length} stereo).`);
	console.log("Set the desk IP in the webmixer admin area to this machine, then reload.\n");
	process.on("SIGINT", function()
	{
		console.log("\nStopping mock desk.");
		desk.close();
		process.exit(0);
	});
}, error => {
	console.error("UDP error:", error && error.stack ? error.stack : error);
	process.exitCode = 1;
});
