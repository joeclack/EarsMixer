"use strict";
// Admin dashboard API: mobile access, live status and the mixer link.
const webSocket = require('ws');
const configManager = require('../../config/configManager.js');
const logger = require('../../logging/logger.js');
const { colourToRGB } = require('../../mix-values.js');
const { deskLabel } = require('../../desk-detect.js');
const { normalizeMixerUrl } = require('../../mixer-url.js');
const { appVersion } = require('../state.js');
const mixView = require('../mix.js');
const desk = require('../desk.js');
const { state } = require('../state.js');

function useAdminRoutes(app)
{
	app.get('/api/admin/access', (req, res) => {
		const online = new Set(state.connections.filter(socket => !socket.isObserver).map(socket => socket.clientInfo.deviceId).filter(Boolean));
		const summary = state.clientAccess.summary();
		res.json({ ...summary, devices: summary.devices.map(device => ({ ...device, online: online.has(device.id) })) });
	});
	app.put('/api/admin/access', async (req, res, next) => {
		if(typeof req.body?.enabled !== 'boolean') { res.status(400).json({ error: 'Choose whether a PIN is required.' }); return; }
		try { await state.clientAccess.setEnabled(req.body.enabled); res.json(state.clientAccess.summary()); } catch(error) { next(error); }
	});
	app.post('/api/admin/access/pin', async (req, res, next) => {
		try { await state.clientAccess.changePin(); res.json(state.clientAccess.summary()); } catch(error) { next(error); }
	});
	app.post('/api/admin/access/revoke-all', async (req, res, next) => {
		try { await state.clientAccess.revokeAll(); res.json(state.clientAccess.summary()); } catch(error) { next(error); }
	});
	app.delete('/api/admin/access/devices/:id', async (req, res, next) => {
		try {
			const removed = req.query.forget === '1' ? await state.clientAccess.forget(req.params.id) : await state.clientAccess.revoke(req.params.id);
			if(!removed) { res.status(404).json({ error: 'That device is no longer listed. Refresh the list.' }); return; }
			res.json(state.clientAccess.summary());
		} catch(error) { next(error); }
	});
	app.get('/api/admin/status', async (req, res) => {
		const mix = mixView.getVisibleConfig();
		const clients = state.connections.filter(socket => !socket.isObserver && socket.readyState === webSocket.OPEN);
		const selectedAux = Number(req.query.aux);
		if(state.loaded && mix.aux.some(aux => aux.channel === selectedAux)) desk.warmAux(selectedAux);
		const connection = await mixView.getConnectionInfo();
		res.json({
			...connection, customMixerUrl: state.config.server.publicUrl || "", loaded: state.loaded,
			desk: state.detectedDesk ? { ...state.detectedDesk, label: deskLabel(state.detectedDesk) } : null,
			snapshot: state.currentSnapshotName,
			version: appVersion, connections: clients.length, authEnabled: false,
			adminPasswordEnabled: state.adminAuth.isEnabled(),
			clients: clients.map(socket => mixView.serializeClient(socket, null, mix)), disconnectedClients: state.disconnectedClients,
			aux: mix.aux.map(aux => ({ ...aux, colour: colourToRGB(aux.colour) })),
			channels: mix.channels,
			mixLevels: Object.fromEntries(mix.aux.map(aux => [aux.channel, mixView.getClientLevels(aux.channel, mix.channels)]))
		});
	});

	app.put('/api/admin/mixer-url', async (req, res) => {
		let publicUrl;
		try { publicUrl = normalizeMixerUrl(req.body?.url); }
		catch(error) { res.status(400).json({ error: error.message }); return; }
		try {
			const connection = await mixView.getConnectionInfo(publicUrl || mixView.getServerURL());
			const nextConfig = { ...state.config, server: { ...state.config.server, publicUrl } };
			configManager.saveGlobalConfig(nextConfig);
			state.config = nextConfig;
			res.json({ ...connection, customMixerUrl: publicUrl });
		} catch(error) {
			logger.error('Mixer URL save failed: ' + error.message);
			res.status(500).json({ error: 'Could not save the mixer URL. Please try again.' });
		}
	});
}

module.exports = { useAdminRoutes };
