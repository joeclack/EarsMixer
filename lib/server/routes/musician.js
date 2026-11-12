"use strict";
// Routes the mobile app and browser mixer use without an admin session.
const mixView = require('../mix.js');
const { state } = require('../state.js');

function useMusicianRoutes(app)
{
	// Only connection information, so the tray QR still works with an admin password.
	app.get('/api/connection', async (req, res, next) => {
		try { res.set('Cache-Control', 'no-store').json({ ...await mixView.getConnectionInfo(), pinRequired: state.clientAccess.required() }); }
		catch(error) { next(error); }
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
