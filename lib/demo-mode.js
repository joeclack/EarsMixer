"use strict";

/**
 * Demo mode for the packaged server: run against a built-in pretend desk instead
 * of a DiGiCo console, so people can try EarsMixer with no desk set up.
 *
 * Demo mode is on when OSC_WEBMIXER_DEMO=1 (the macOS menu bar app sets it) or
 * when a "demo-mode" file exists in the EarsMixer home folder (the Windows tray
 * creates it, because the service's environment is fixed at install time).
 *
 * It keeps its own settings and data in <home>/demo, so the real desk address,
 * connection PIN, admin password and layouts are never touched. The demo uses
 * the real web port, so the menu bar app, tray, QR code and phones connect as
 * usual, and it is advertised as "EarsMixer Demo" unless renamed in its admin.
 */

const fs = require("node:fs");
const path = require("node:path");

/** Loopback UDP ports for the server and the demo desk; never exposed to the network. */
const DEMO_OSC_PORT = 8013;
const DEMO_DESK_PORT = 9013;
const DEMO_FLAG = "demo-mode";

function demoRequested(home, env = process.env) {
	return env.OSC_WEBMIXER_DEMO === "1" || fs.existsSync(path.join(home, DEMO_FLAG));
}

function readJson(file) {
	try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/**
 * Point the server at demo settings. Call before loading the server modules,
 * which read the config and data folders when they are first required.
 * @param {string} home The EarsMixer home folder.
 * @param {string} realConfigDir The normal config folder, used for the web port.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ oscPort: number, deskPort: number, configDir: string }}
 */
function prepareDemo(home, realConfigDir, env = process.env) {
	const root = path.join(home, "demo");
	const configDir = path.join(root, "config");
	const dataDir = path.join(root, "data");
	fs.mkdirSync(configDir, { recursive: true });
	fs.mkdirSync(dataDir, { recursive: true });

	const real = readJson(path.join(realConfigDir, "global.json")) || {};
	const file = path.join(configDir, "global.json");
	const saved = readJson(file) || {};
	const webPort = Number(real.server?.port) || 80;
	const config = {
		...saved,
		debug: saved.debug === true,
		// The demo's own admin can rename it; the port always follows the real server.
		server: { ...saved.server, name: saved.server?.name || "EarsMixer Demo", port: webPort },
		osc: { port: DEMO_OSC_PORT },
		desk: { ip: "127.0.0.1", port: DEMO_DESK_PORT },
		externalDevices: [],
	};
	const temporary = file + ".tmp";
	fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n");
	fs.renameSync(temporary, file);

	env.OSC_WEBMIXER_DEMO = "1";
	env.OSC_WEBMIXER_CONFIG_DIR = configDir;
	env.OSC_WEBMIXER_DATA_DIR = dataDir;
	// The OSC port is fixed above; a port override meant for the real desk would break the demo.
	delete env.OSC_WEBMIXER_OSC_PORT;
	return { oscPort: DEMO_OSC_PORT, deskPort: DEMO_DESK_PORT, configDir };
}

/**
 * Start the server, in demo mode when requested. Launchers call this after
 * setting the normal config and data folders.
 * @param {string} home The EarsMixer home folder.
 * @param {() => void} startServer Loads the server (require("../index.js")).
 */
async function launch(home, startServer, env = process.env) {
	if (!demoRequested(home, env)) { startServer(); return; }
	const { oscPort, deskPort } = prepareDemo(home, env.OSC_WEBMIXER_CONFIG_DIR, env);
	const { startDemoDesk } = require("./demo-desk.js");
	await startDemoDesk({ host: "127.0.0.1", port: deskPort, replyPort: oscPort, channels: 20, auxes: 8 });
	console.log("Demo mode: using the built-in demo desk (20 channels, 8 AUX mixes). Desk settings are unchanged.");
	startServer();
}

module.exports = { demoRequested, prepareDemo, launch, DEMO_FLAG, DEMO_OSC_PORT, DEMO_DESK_PORT };
