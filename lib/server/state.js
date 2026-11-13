"use strict";
// Shared server state. Modules read and update these fields rather than
// keeping their own copies, so a settings change is seen everywhere.
const configManager = require("../config/configManager.js");
const logger = require('../logging/logger.js');
const { productVersion } = require('../product-info.js');
const { createMeterStream, createSimulatedMeterSource } = require('../meters.js');

configManager.ensureConfigDirectoryExists();
const config = configManager.getGlobalConfigOrDefault();
for(const [name, section] of [['OSC_WEBMIXER_WEB_PORT', 'server'], ['OSC_WEBMIXER_OSC_PORT', 'osc']]) {
	if(process.env[name]) {
		const port = Number(process.env[name]);
		if(!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(name + ' must be a valid port.');
		config[section].port = port;
	}
}
// Configure logger to use settings from global config
logger.configure(config.debug, Boolean(process.env.OSC_WEBMIXER_SERVICE));

const state = {
	/** Global configuration (ports, desk address, external devices). */
	config,
	/** Enabled/ordered AUX mixes and channels shown to musicians. */
	currentState: configManager.getCurrentStateOrDefault(),
	/** The osc.js UDP port, while open. */
	udpPort: undefined,
	/** Admitted WebSocket connections. */
	connections: [],
	/** Whether the desk's channel and AUX metadata has loaded. */
	loaded: false,
	/** Cached OSC messages by address. */
	cache: new Map(),
	currentSnapshotName: "",
	currentSnapshot: -1,
	/** The HTTP server and its WebSocket server. */
	server: null,
	wss: null,
	adminAuth: null,
	clientAccess: null,
	/** Recently disconnected clients, newest first, for the admin dashboard. */
	disconnectedClients: [],
	/** Signal meter stream for musician clients (simulated in the demo only). */
	meters: null,
};
// Only the demo has a meter source. Real desk meters wait on confirmed
// console addresses (see lib/meters.js).
state.meters = createMeterStream({
	source: process.env.OSC_WEBMIXER_DEMO_METERS === '1' ? createSimulatedMeterSource() : null,
	clients: () => state.connections,
});
module.exports = { state, appVersion: productVersion() };
