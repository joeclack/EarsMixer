"use strict";
// Desk settings saved from the admin dashboard, and the data its form loads.
const path = require('node:path');
const configManager = require('../../config/configManager.js');
const logger = require('../../logging/logger.js');
const { getMainIPAddress, generateColour } = require('../../utils/utils.js');
const mixView = require('../mix.js');
const desk = require('../desk.js');
const clients = require('../clients.js');
const web = require('../web.js');
const { state } = require('../state.js');

function useSettingsRoutes(app)
{
	//when a post request occurs in the admin area
	app.post('/admin', (req, res) => {

		const requestedWebPort = Number(process.env.OSC_WEBMIXER_WEB_PORT || req.body.server_port);
		const requestedOscPort = Number(process.env.OSC_WEBMIXER_OSC_PORT || req.body.osc_port);
		const requestedDeskPort = Number(req.body.desk_port);
		const validPort = port => Number.isInteger(port) && port >= 1 && port <= 65535;
		if(![requestedWebPort, requestedOscPort, requestedDeskPort].every(validPort) ||
			typeof req.body.desk_ip !== 'string' || !req.body.desk_ip.trim()) {
			res.status(400).json({ error: 'Enter a desk address and port numbers between 1 and 65535.' }); return;
		}
		const deskChanged = state.config.desk.ip !== req.body.desk_ip.trim() || Number(state.config.desk.port) !== requestedDeskPort;
		//update config with new values
		let portChanged = false;
		if(state.config.server.port != requestedWebPort)
		{
			portChanged = true;
			state.config.server.port = requestedWebPort;
		}

		let oscPortChanged = false;
		if(state.config.osc.port != requestedOscPort)
		{
			oscPortChanged = true;
			state.config.osc.port = requestedOscPort;
		}

		state.config.debug = req.body.debug == "debug";
		logger.setDebug(state.config.debug);

		state.config.desk.ip = req.body.desk_ip.trim();
		state.config.desk.port = requestedDeskPort;

		state.config.externalDevices = [];
		if(req.body.externalName)
		{
			for(let x = 0; x<req.body.externalName.length; x++)
			{
				state.config.externalDevices.push({
					broadcast: req.body.externalBroadcast[x] == "true",
					name: req.body.externalName[x],
					ip: req.body.externalIP[x],
					port: req.body.externalReceive[x],
					loopback: req.body.externalLoopback[x] == "true"
				});
			}
		}

		if (req.body.auxEnabled && req.body.auxColour && req.body.auxIcon) {
			const auxConfig = req.body.auxEnabled.map((enabledValue, index) => ({
				enabled: enabledValue === "true",
				colour: req.body.auxColour[index],
				icon: req.body.auxIcon[index]
			}));
			state.currentState.auxes = auxConfig;
		}

		if(req.body.channelEnabled && req.body.channelOrder && req.body.channelIcon)
		{
			const channelConfig = req.body.channelEnabled.map((enabledValue, index) => ({
				enabled: enabledValue === "true",
				displayOrder: parseInt(req.body.channelOrder[index]) || index,
				title: req.body.sectionTitle ? req.body.sectionTitle[index] : "",
				icon: req.body.channelIcon ? req.body.channelIcon[index] : ""
			}))
			state.currentState.channels = channelConfig;
		}

		logger.info("Configuration updated via web interface. Saving current configuration state to disk.")
		configManager.saveGlobalConfig(state.config);
		configManager.saveCurrentState(state.currentState);

		if(req.body.auxName)
		{
			for(let i=0; i<req.body.auxName.length; i++)
			{
				if(
					state.cache.has(`/Aux_Outputs/${i+1}/Buss_Trim/name`) &&
					state.cache.get(`/Aux_Outputs/${i+1}/Buss_Trim/name`).args[0] != req.body.auxName[i]
				)
				{
					//store new name
					state.cache.get(`/Aux_Outputs/${i+1}/Buss_Trim/name`).args[0] = req.body.auxName[i];

					//let other connections know about new name
					desk.broadcast({
							"address": `/Aux_Outputs/${i+1}/Buss_Trim/name`,
							"args": [
								req.body.auxName[i]
							]
						}
					);
				}
			}
		}

		if(req.body.channelName)
		{
			for(let i=0; i<req.body.channelName.length; i++)
			{
				if(
					state.cache.has(`/Input_Channels/${i+1}/Channel_Input/name`) &&
					state.cache.get(`/Input_Channels/${i+1}/Channel_Input/name`).args[0] != req.body.channelName[i]
				)
				{
					//store new name
					state.cache.get(`/Input_Channels/${i+1}/Channel_Input/name`).args[0] = req.body.channelName[i];

					//let other connections know about new name
					desk.broadcast({
							"address": `/Input_Channels/${i+1}/Channel_Input/name`,
							"args": [
								req.body.channelName[i]
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
					"icon": icon
				});
			}
		}
		res.json(channelDetails);
	});
}

module.exports = { useSettingsRoutes };
