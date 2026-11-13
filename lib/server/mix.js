"use strict";
// What musicians and the dashboard see: the visible mix, levels and the mixer link.
const QRCode = require('qrcode');
const { getMainIPAddress, generateColour } = require('../utils/utils.js');
const { dbToSlider, panToCentered, colourToRGB } = require('../mix-values.js');
const { state } = require('./state.js');
let qrURL = null;
let qrImage = null;

/**
 * Build initial configuration for new connections
 * @returns - the initial configuration
 */
function buildConfig()
{
	let auxilaries = [];
	if(state.cache.has("/Console/Aux_Outputs/modes") && state.currentState.auxes != undefined)
	{
		let auxModes = state.cache.get("/Console/Aux_Outputs/modes").args;
		for(const [index, mode] of auxModes.entries())
		{
			//skip auxes whose name hasn't arrived from the desk yet (matches the /aux route)
			if(!state.cache.has(`/Aux_Outputs/${index+1}/Buss_Trim/name`))
			{
				continue;
			}

			auxilaries.push({
				enabled: state.currentState.auxes[index] ? state.currentState.auxes[index].enabled : true,
				label: state.cache.get(`/Aux_Outputs/${index+1}/Buss_Trim/name`).args[0],
				channel: index + 1,
				stereo: mode == 2,
				colour: state.currentState.auxes[index] ? state.currentState.auxes[index].colour : generateColour(auxModes.length, index),
				icon: state.currentState.auxes[index] ? state.currentState.auxes[index].icon : ""
			});
		}
	}

	let channels = [];
	if(state.cache.has("/Console/Input_Channels") && state.currentState.channels != undefined)
	{
		for(let i=0; i<state.cache.get("/Console/Input_Channels").args[0]; i++)
		{
			if(state.cache.has(`/Input_Channels/${i+1}/Channel_Input/name`))
			{
				channels.push({
					enabled: state.currentState.channels[i] ? state.currentState.channels[i].enabled : true,
					label: state.cache.get(`/Input_Channels/${i+1}/Channel_Input/name`).args[0],
					channel: i + 1,
					order: state.currentState.channels[i]?.displayOrder ?? i,
					title: state.currentState.channels[i] ? state.currentState.channels[i].title : "",
					icon: state.currentState.channels[i] ? state.currentState.channels[i].icon : ""
				});
			}
		}
	}

	return JSON.stringify({
		"config": {
			channels: channels,
			aux: auxilaries,
			snapshot: state.currentSnapshotName,
			// Clients show meters only when the server has a meter source.
			meters: state.meters?.kind() ?? null
		}
	});
}

/**
 * Get the current server url
 */
async function getConnectionInfo(publicUrl = state.config.server.publicUrl || getServerURL()) {
	const url = publicUrl.replace(/\/$/, '') + '/';
	if(qrURL !== url) {
		qrURL = url;
		qrImage = QRCode.toDataURL(url, { width: 320, margin: 2 });
		qrImage.catch(() => { if(qrURL === url) qrURL = null; });
	}
	return { url, qr: await qrImage };
}

function getServerURL()
{
	if(process.env.OSC_WEBMIXER_PUBLIC_URL)
	{
		return process.env.OSC_WEBMIXER_PUBLIC_URL.replace(/\/$/, "");
	}
	// A boot-time service may start before the network adapter has an address.
	let url = `http://${getMainIPAddress() || '127.0.0.1'}`;
	if(state.config.server.port != 80)
	{
		url += ":" + state.config.server.port;
	}
	return url;
}

function getVisibleConfig() {
	const result = JSON.parse(buildConfig()).config;
	result.channels = result.channels.filter(channel => channel.enabled).sort((a, b) => a.order - b.order);
	result.aux = result.aux.filter(aux => aux.enabled);
	return result;
}

function getClientLevels(aux, channels = getVisibleConfig().channels) {
	return channels.map(channel => {
		const prefix = '/Input_Channels/' + channel.channel + '/Aux_Send/' + aux;
		return { channel: channel.channel, label: channel.label,
			level: dbToSlider(state.cache.get(prefix + '/send_level')?.args[0]),
			pan: panToCentered(state.cache.get(prefix + '/send_pan')?.args[0]) };
	});
}

function serializeClient(socket, disconnectedAt = null, mix = getVisibleConfig()) {
	const info = socket.clientInfo;
	const aux = mix.aux.find(entry => entry.channel === info.aux);
	return { ...info, disconnectedAt, auxLabel: aux?.label ?? null,
		auxColour: colourToRGB(aux?.colour), levels: info.aux ? getClientLevels(info.aux, mix.channels) : null };
}
Object.assign(exports, { buildConfig, getConnectionInfo, getServerURL, getVisibleConfig, getClientLevels, serializeClient });
