"use strict";
// Shared server state. Modules read and update these fields rather than
// keeping their own copies, so a settings change is seen everywhere.
const configManager = require("../config/configManager.js");
const logger = require('../logging/logger.js');
const { productVersion } = require('../product-info.js');

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
	/** The kind of desk that answered at the desk address, or null until one has. See desk-detect.js. */
	detectedDesk: null,
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
};
module.exports = { state, appVersion: productVersion() };
