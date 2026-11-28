"use strict";
// Desk settings saved from the admin dashboard, and the data its form loads.
const path = require('node:path');
const configManager = require('../../config/configManager.js');
const logger = require('../../logging/logger.js');
const { getMainIPAddress, generateColour } = require('../../utils/utils.js');
const { channelColour } = require('../../mix-values.js');
const mixView = require('../mix.js');
const desk = require('../desk.js');
const clients = require('../clients.js');
const web = require('../web.js');
const { readExternalDevices, validAddress } = require('../security.js');
const { readDeskLayout } = require('../../desk-layout.js');
const { cleanServerName, MAX_NAME_BYTES } = require('../../discovery.js');
const { state } = require('../state.js');

function useSettingsRoutes(app)
{
	//when a post request occurs in the admin area
	app.post('/admin', (req, res) => {
		const body = req.body && typeof req.body === 'object' ? req.body : {};
		// Read and check the whole form first. Nothing changes unless all of it is valid.
		const requestedWebPort = Number(process.env.OSC_WEBMIXER_WEB_PORT || body.server_port);
		const requestedOscPort = Number(process.env.OSC_WEBMIXER_OSC_PORT || body.osc_port);
		const requestedDeskPort = Number(body.desk_port);
		const requestedDeskIp = typeof body.desk_ip === 'string' ? body.desk_ip.trim() : '';
		const validPort = port => Number.isInteger(port) && port >= 1 && port <= 65535;
		if(![requestedWebPort, requestedOscPort, requestedDeskPort].every(validPort) || !validAddress(requestedDeskIp)) {
			res.status(400).json({ error: 'Enter a desk IP address or hostname, and port numbers between 1 and 65535.' }); return;
		}
		const externalDevices = readExternalDevices(body);
		if(!externalDevices) {
			res.status(400).json({ error: 'Each external device needs a name, an IP address or hostname, and a port between 1 and 65535.' }); return;
		}
		// A form without the field keeps the current name; an empty one clears it.
		const requestedName = body.server_name === undefined ? (state.config.server.name || '') : cleanServerName(body.server_name);
		if(requestedName === null) {
			res.status(400).json({ error: `Keep the server name to ${MAX_NAME_BYTES} characters or fewer.` }); return;
		}
		const layout = readDeskLayout(body, state.currentState.channels);
		if(!layout) {
			res.status(400).json({ error: 'Some AUX or channel settings could not be read. Reload the page and try again.' }); return;
		}

		// Everything is valid: apply it.
		const nameChanged = (state.config.server.name || '') !== requestedName;
		if(requestedName) state.config.server.name = requestedName;
		else delete state.config.server.name;
		const deskChanged = state.config.desk.ip !== requestedDeskIp || Number(state.config.desk.port) !== requestedDeskPort;
		const portChanged = state.config.server.port != requestedWebPort;
		const oscPortChanged = state.config.osc.port != requestedOscPort;
		state.config.server.port = requestedWebPort;
		state.config.osc.port = requestedOscPort;

		state.config.debug = body.debug == "debug";
		logger.setDebug(state.config.debug);

		state.config.desk.ip = requestedDeskIp;
		state.config.desk.port = requestedDeskPort;

		state.config.externalDevices = externalDevices;

		if(layout.auxes) state.currentState.auxes = layout.auxes;
		if(layout.channels) state.currentState.channels = layout.channels;

		logger.info("Configuration updated via web interface. Saving current configuration state to disk.")
		configManager.saveGlobalConfig(state.config);
		configManager.saveCurrentState(state.currentState);
		if(nameChanged) web.refreshDiscovery();

		if(layout.auxNames)
		{
			for(let i=0; i<layout.auxNames.length; i++)
			{
				if(
					state.cache.has(`/Aux_Outputs/${i+1}/Buss_Trim/name`) &&
					state.cache.get(`/Aux_Outputs/${i+1}/Buss_Trim/name`).args[0] != layout.auxNames[i]
				)
				{
					//store new name
					state.cache.get(`/Aux_Outputs/${i+1}/Buss_Trim/name`).args[0] = layout.auxNames[i];

					//let other connections know about new name
					desk.broadcast({
							"address": `/Aux_Outputs/${i+1}/Buss_Trim/name`,
							"args": [
								layout.auxNames[i]
							]
						}
					);
				}
			}
		}

		if(layout.channelNames)
		{
			for(let i=0; i<layout.channelNames.length; i++)
			{
				if(
					state.cache.has(`/Input_Channels/${i+1}/Channel_Input/name`) &&
					state.cache.get(`/Input_Channels/${i+1}/Channel_Input/name`).args[0] != layout.channelNames[i]
				)
				{
					//store new name
					state.cache.get(`/Input_Channels/${i+1}/Channel_Input/name`).args[0] = layout.channelNames[i];

					//let other connections know about new name
					desk.broadcast({
							"address": `/Input_Channels/${i+1}/Channel_Input/name`,
							"args": [
								layout.channelNames[i]
							]
						}
					);
				}
			}
		}

		//force webmixer client and admin connections to reload
		clients.closeAllWebsocketConnections();

		if(oscPortChanged || deskChanged)
		{
			desk.stopOSC(desk.startOSC);
		}

		if(portChanged)
		{
			clients.closeAllWebsocketConnections();

			//close web socket server if it is running
			if(state.wss)
			{
				state.wss.close();
				state.wss = null;
			}

			//close web server
			state.server.close();

			logger.warn(`Server port has changed. Please visit ${mixView.getServerURL()} to continue.`);

			//respond with redirection to the new port
			res.send(`<script>document.location.href="${mixView.getServerURL()}/admin.html#desk-settings";</script>`);

			web.startServer();
			return;
		}

		res.json({ success: true });
	});

	//when a get request occurs in the admin area
	app.get('/admin', (req, res) => {
		res.sendFile(path.join(__dirname, '..', '..', '..', 'web', 'admin.html'));
	});

	//provide the current config to the admin area when it has been requested by ajax.
	app.get('/config', (req, res) => {
		if(!state.config.server)
		{
			state.config.server = {};
		}
		state.config.server.ip = getMainIPAddress() || '127.0.0.1';
		res.json(state.config);
	});

	//provide the current config for the auxilaries
	app.get('/aux', (req, res) => {
		let auxDetails = [];

		if(state.cache.has("/Console/Aux_Outputs/modes"))
		{
			let auxModes = state.cache.get("/Console/Aux_Outputs/modes").args;
			for(let i=0; i<auxModes.length; i++)
			{
				if(!state.cache.has(`/Aux_Outputs/${i+1}/Buss_Trim/name`))
				{
					continue;
				}

				let enabled = true;
				let colour = generateColour(auxModes.length, i);
				let icon = "";
				if(state.currentState.auxes && state.currentState.auxes[i])
				{
					if(state.currentState.auxes[i].enabled != undefined)
					{
						enabled = state.currentState.auxes[i].enabled;
					}
					if(state.currentState.auxes[i].colour != undefined)
					{
						colour = state.currentState.auxes[i].colour;
					}
					if(state.currentState.auxes[i].icon != undefined)
					{
						icon = state.currentState.auxes[i].icon;
					}
				}
				auxDetails.push({
					"enabled": enabled,
					"name": state.cache.get(`/Aux_Outputs/${i+1}/Buss_Trim/name`).args[0],
					"colour": colour,
					"icon": icon
				});
			}
		}
		res.json(auxDetails);
	});

	//provide the current config for the channels
	app.get('/channels', (req, res) => {

		let channelDetails = [];
		if(state.cache.has("/Console/Input_Channels"))
		{
			for(let i=0; i<state.cache.get("/Console/Input_Channels").args[0]; i++)
			{
				if(!state.cache.has(`/Input_Channels/${i+1}/Channel_Input/name`))
				{
					continue;
				}

				let enabled = true;
				let order = i + 1;
				let title = "";
				let icon = "";
				if(state.currentState.channels && state.currentState.channels[i])
				{
					if(state.currentState.channels[i].enabled != undefined)
					{
						enabled = state.currentState.channels[i].enabled;
					}
					if(state.currentState.channels[i].displayOrder != undefined)
					{
						order = state.currentState.channels[i].displayOrder;
					}
					if(state.currentState.channels[i].title != undefined)
					{
						title = state.currentState.channels[i].title;
					}
					if(state.currentState.channels[i].icon != undefined)
					{
						icon = state.currentState.channels[i].icon;
					}
				}
				channelDetails.push({
					"enabled": enabled,
					"name": state.cache.get(`/Input_Channels/${i+1}/Channel_Input/name`).args[0],
					"order": order,
					"title": title,
					"colour": channelColour(state.currentState.channels?.[i]?.colour),
					"icon": icon
				});
			}
		}
		res.json(channelDetails);
	});
}

module.exports = { useSettingsRoutes };
