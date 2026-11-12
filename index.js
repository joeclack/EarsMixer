"use strict";
// EarsMixer: bridges a DiGiCo desk (OSC) to musicians' phones (WebSocket).
// Start-up only; the server lives in lib/server.
const logger = require('./lib/logging/logger.js');
const { createAdminAuth } = require('./lib/admin-session.js');
const { createClientAccess } = require('./lib/client-access.js');
const { state } = require('./lib/server/state.js');
const web = require('./lib/server/web.js');
const desk = require('./lib/server/desk.js');
const clients = require('./lib/server/clients.js');

/**
 * Last-resort handlers so an unexpected error is logged instead of silently
 * killing the server (which would drop every connected device mid-show).
 */
process.on('uncaughtException', function(err)
{
	logger.error("Uncaught exception: " + (err && err.stack ? err.stack : err));
});
process.on('unhandledRejection', function(reason)
{
	logger.error("Unhandled promise rejection: " + (reason && reason.stack ? reason.stack : reason));
});

// Give Bonjour time to withdraw advertisements when the service/demo stops.
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
	const timeout = setTimeout(() => process.exit(0), 1500);
	Promise.allSettled([...web.discoveryStops].map(stop => stop())).then(() => {
		clearTimeout(timeout);
		process.exit(0);
	});
});

Promise.all([createAdminAuth(), createClientAccess()]).then(([auth, access]) => {
	state.adminAuth = auth;
	state.clientAccess = access;
	// When the PIN is switched on, changed or a device is revoked, disconnect
	// any client that no longer has access; it will be asked for the PIN.
	access.onChange(() => {
		for(const socket of [...state.connections]) {
			if(socket.isObserver || access.isAuthorized(socket.clientInfo.deviceId)) continue;
			clients.rejectClient(socket, 'revoked');
		}
	});
	web.startServer();
	desk.startOSC();
}).catch(error => { logger.error(error.stack || error); process.exit(1); });
