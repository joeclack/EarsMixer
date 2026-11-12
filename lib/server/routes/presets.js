"use strict";
// Saved presets of enabled AUX mixes and channels.
const configManager = require('../../config/configManager.js');
const logger = require('../../logging/logger.js');
const clients = require('../clients.js');
const { state } = require('../state.js');

function usePresetRoutes(app)
{
	app.get('/api/presets', (req, res) => {
		let presets = configManager.getPresets()

		res.json(presets.map(p => ({
			uuid: p.uuid,
			name: p.name,
			lastChanged: p.lastChanged
		})));
	});

	app.post('/api/presets/:uuid/load', (req, res) => {
		try {
			const { uuid } = req.params;

			if (!uuid) {
				return res.status(400).json({
					success: false,
					message: "Preset UUID is required."
				});
			}

			const preset = configManager.getPresetById(uuid);

			if (!preset) {
				return res.status(404).json({
					success: false,
					message: `Preset with ID "${uuid}" not found.`
				});
			}

			state.currentState = structuredClone(preset)
			configManager.saveCurrentState(state.currentState);
			clients.closeAllWebsocketConnections();

			res.json({
				success: true,
				message: `Preset "${preset.name}" loaded successfully.`,
				state: state.currentState
			});
		} catch (err) {
			logger.error(`Error loading preset: ${err}`);
			res.status(500).json({
				success: false,
				message: "An internal server error occurred."
			});
		}
	});

	app.post('/api/presets/save-current-state', (req, res) => {
		try {
			const { name } = req.body;

			if (!name || name.trim() === "") {
				return res.status(400).json({ success: false, message: "Preset name is required." });
			}

			const newPreset = configManager.saveCurrentStateAsPreset(state.currentState, name);

			res.status(201).json({
				success: true,
				message: "Preset saved successfully.",
				preset: newPreset
			});
		} catch (err) {
			if (err.code === 'PRESET_EXISTS') {
				return res.status(409).json({
					success: false,
					message: err.message
				});
			}

			logger.error(`Error saving preset: ${err}`);
			res.status(500).json({
				success: false,
				message: "An internal server error occurred."
			});
		}
	});

	app.delete('/api/presets/:uuid', (req, res) => {
		try {
			const { uuid } = req.params;
			configManager.deletePreset(uuid);

			res.json({ 
				success: true, 
				message: "Preset deleted successfully." 
			});

		} catch (err) {
			if (err.code === 'PRESET_NOT_FOUND') {
				return res.status(404).json({ 
					success: false, 
					message: err.message 
				});
			}

			logger.error("Error deleting preset:", err);
			res.status(500).json({ 
				success: false, 
				message: "Failed to delete preset." 
			});
		}
	});

	app.get('/api/presets/:uuid/download', (req, res) => {
		try {
			const { uuid } = req.params;
			const preset = configManager.getPresetById(uuid);

			if (!preset) {
				return res.status(404).json({ success: false, message: "Preset not found." });
			}

			const filename = `${preset.name.replace(/\s+/g, '_')}.json`;
			res.setHeader('Content-Type', 'application/json');
			res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

			res.send(JSON.stringify(preset, null, 4));
		} catch (err) {
			res.status(500).send("Error generating download.");
		}
	});
}

module.exports = { usePresetRoutes };
