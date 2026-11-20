"use strict";
// Shared server state. Modules read and update these fields rather than
// keeping their own copies, so a settings change is seen everywhere.
const configManager = require("../config/configManager.js");
const logger = require('../logging/logger.js');
const { productVersion } = require('../product-info.js');
const { createMeterStream } = require('../meters.js');
const { createDeskMeterSource, deskMetersEnabled } = require('../desk-meters.js');
const { createRequestBoard } = require('../requests.js');

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
	/** Signal meter stream for musician clients. */
	meters: null,
	/** Requests from musicians to the engineer, newest first. */
	requests: createRequestBoard(),
};
// Desk meters are off by default: the readings aren't reliable yet (an SD9
// answered every query with a constant value). With no meter source the
// server never asks the desk for meters, phones and the browser mixer show
// none, and the admin page hides the Signal meters panel. Set
// OSC_WEBMIXER_DESK_METERS=1 to try them; the desk is then asked for its
// input meters (see lib/desk-meters.js) only while a phone is showing them.
function deskMeterSource() {
	if(!deskMetersEnabled()) return null;
	return createDeskMeterSource({
		query(address) {
			if(state.udpPort && state.loaded) state.udpPort.send({ address: address + '/?', args: [] }, state.config.desk.ip, state.config.desk.port);
		},
	});
}
state.meters = createMeterStream({
	source: deskMeterSource(),
	clients: () => state.connections,
	rate: 8,
});
module.exports = { state, appVersion: productVersion() };
