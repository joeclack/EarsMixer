"use strict";
// Routes the mobile app and browser mixer use without an admin session.
const mixView = require('../mix.js');
const webSocket = require('ws');
const { state } = require('../state.js');
const { localRequest } = require('../security.js');
const { deskLabel } = require('../../desk-detect.js');

function useMusicianRoutes(app)
{
	// Only connection information, so the tray QR still works with an admin password.
	app.get('/api/connection', async (req, res, next) => {
		try { res.set('Cache-Control', 'no-store').json({ ...await mixView.getConnectionInfo(), pinRequired: state.clientAccess.required() }); }
		catch(error) { next(error); }
	});
	// Desk and device status for the menu bar app on this computer. It has no
	// admin session, so this answers only local programs and gives no detail.
	app.get('/api/local/status', (req, res) => {
		if(!localRequest(req)) { res.sendStatus(404); return; }
		const devices = state.connections.filter(socket => !socket.isObserver && socket.readyState === webSocket.OPEN).length;
		res.set('Cache-Control', 'no-store').json({ desk: { connected: state.loaded, address: state.config.desk.ip || "", type: state.detectedDesk?.type ?? null, label: deskLabel(state.detectedDesk) }, devices });
	});
	// Pair a mixer client with the connection PIN. Rate limited in clientAccess.
	app.post('/api/pair', async (req, res, next) => {
		try {
			const result = await state.clientAccess.pair(req.body, req.socket.remoteAddress);
			if(result.headers) res.set(result.headers);
			res.status(result.status).set('Cache-Control', 'no-store').json(result.body);
		} catch(error) { next(error); }
	});
}

module.exports = { useMusicianRoutes };
