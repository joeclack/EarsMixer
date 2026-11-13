"use strict";
// The DiGiCo desk connection: OSC over UDP, the value cache and plugins.
const osc = require("osc");
const fs = require('fs');
const net = require('node:net');
const webSocket = require("ws");
const logger = require('../logging/logger.js');
const { QueryQueue } = require('../query-queue.js');
const { X32_PORT, X32_PROBE, identifyDesk, deskLabel } = require('../desk-detect.js');
const x32 = require('../x32.js');
const { state } = require('./state.js');
const { allowedOscSource } = require('./security.js');
const mixView = require('./mix.js');
const clients = require('./clients.js');
let discoveryTimer = null;
let x32LastSeen = 0;
let x32KeepAlive = null;
/** Whether each X32 bus pair is linked, by pair index. */
const x32Links = new Map();
const x32Mode = () => state.detectedDesk?.type === 'x32';
const queryQueue = new QueryQueue(msg => {
	if(state.loaded) sendToDesk(msg);
});

/**
 * Send a DiGiCo-style message to the desk. In X32 mode it is translated first,
 * and messages the X32 has no equivalent for are not sent.
 */
function sendToDesk(msg)
{
	if(!state.udpPort) return;
	if(!x32Mode()) { state.udpPort.send(msg, state.config.desk.ip, state.config.desk.port); return; }
	const translated = x32.toDesk(msg, state.currentSnapshot);
	if(translated) state.udpPort.send(translated, state.config.desk.ip, X32_PORT);
}

/** Forget which desk answered, so the next answer decides the mode again. */
function forgetDesk()
{
	clearInterval(x32KeepAlive);
	x32KeepAlive = null;
	x32Links.clear();
	state.detectedDesk = null;
}

/** Drop everything loaded from the desk and load it again. */
function reloadFromDesk()
{
	queryQueue.clear();
	state.cache.clear();
	state.loaded = false;
	state.currentSnapshot = -1;
	state.currentSnapshotName = '';
	clients.closeAllWebsocketConnections();
	fetchValues();
}

/**
 * Load all plugins from the ./plugins directory
 * @returns - Array of plugins (empty if none found/enabled)
 */
function loadPlugins() {
	if (!fs.existsSync('./plugins')) {
		logger.warn("Directory ./plugins/ not found. Creating empty directory.");
		fs.mkdirSync('./plugins');
		logger.info("To use plugins, please add them to the ./plugins/ directory.");
		return [];
	}

	let plugins = [];
	const pluginFiles = fs.readdirSync('./plugins');

	for (const file of pluginFiles) {
		if (file.startsWith('_')) {
			logger.info(`Not loading plugin "${file}".`);
			continue;
		}
		if (!file.endsWith('.js')) {
			logger.warn(`Ignoring non-JS file "${file}" in plugin directory.`);
			continue;
		}
		let plugin = require(require('path').resolve('plugins', file));
		plugins.push(new plugin());
		logger.info(`Loaded plugin "${file}".`);
	}

	return plugins;
}

const plugins = loadPlugins();

function warmAux(aux, priority = true, mix = mixView.getVisibleConfig()) {
	const stereo = mix.aux.find(entry => entry.channel === aux)?.stereo;
	for(const channel of mix.channels) {
		const prefix = '/Input_Channels/' + channel.channel + '/Aux_Send/' + aux;
		if(!state.cache.has(prefix + '/send_level')) queryQueue.request(prefix + '/send_level', priority);
		if(stereo && !state.cache.has(prefix + '/send_pan')) queryQueue.request(prefix + '/send_pan', priority);
	}
}

/**
 * Callback to request values from the desk. Will keep trying until values have loaded.
 * @returns null
 */
function fetchValues()
{
	if(state.loaded)
	{
		return;
	}

	if(state.config.desk.ip) probeDesk();
	clearTimeout(discoveryTimer);
	if(!state.loaded) discoveryTimer = setTimeout(fetchValues, 3000);
}

/**
 * Ask the desk to identify itself. Until the desk type is known, both the
 * DiGiCo and the X32 question are sent; only the desk that is there answers.
 */
function probeDesk()
{
	// An X32 that has stopped answering may have been swapped for another desk.
	if(x32Mode() && Date.now() - x32LastSeen > 10000) {
		logger.warn(deskLabel(state.detectedDesk) + " stopped answering. Detecting the desk again.");
		forgetDesk();
		state.cache.clear();
	}
	loadNextRequiredParameter();
	if(state.detectedDesk?.type !== 'digico') state.udpPort.send(X32_PROBE, state.config.desk.ip, X32_PORT);
}

/**
 * Record which kind of desk sent a message.
 * @returns {boolean} whether the message was only a desk identification
 */
function noteDesk(oscMsg)
{
	const found = identifyDesk(oscMsg);
	if(!found) return false;
	if(found.type === 'x32') x32LastSeen = Date.now();
	if(state.detectedDesk?.type !== found.type) {
		// A different kind of desk at this address: nothing loaded so far applies.
		if(state.detectedDesk) { queryQueue.clear(); state.cache.clear(); state.loaded = false; clients.closeAllWebsocketConnections(); }
		forgetDesk();
		state.detectedDesk = found;
		if(found.type === 'x32') {
			logger.info(`Detected ${deskLabel(found)}${found.name ? ` "${found.name}"` : ''}${found.firmware ? ', firmware ' + found.firmware : ''}. Using Behringer mode.`);
			const keepAlive = () => { if(state.udpPort) state.udpPort.send(x32.KEEP_ALIVE, state.config.desk.ip, X32_PORT); };
			keepAlive();
			x32KeepAlive = setInterval(keepAlive, x32.KEEP_ALIVE_INTERVAL);
			x32KeepAlive.unref();
			if(!state.loaded) loadNextRequiredParameter();
		} else logger.info("Detected a DiGiCo desk. Using DiGiCo mode.");
	}
	return found.type === 'x32';
}

/**
 * Start listening to OSC messages from the network
 */
function startOSC()
{
	state.udpPort = new osc.UDPPort({
		localAddress: process.env.OSC_WEBMIXER_BIND_ADDRESS || "0.0.0.0",
		localPort: state.config.osc.port
	});

	state.udpPort.on("error", function (err)
	{
		if(err.code == "EHOSTDOWN" || err.code == "EHOSTUNREACH")
		{
			logger.error(err.address + " is not responding");
			return;
		}
		if(err.code == "EADDRINUSE" || err.code == "EACCES")
		{
			//can't receive OSC without this port - retrying is pointless, so fail loudly
			logger.error("Could not open OSC port.");
			logger.error(`OSC port ${state.config.osc.port} is ${err.code == "EACCES" ? "not permitted" : "already in use"}. ` +
				`Close whatever is using it or change the OSC Receive Port in the admin area.`);
			process.exit(1);
		}
		logger.error("UDP error: " + (err && err.stack ? err.stack : err));
	});

	state.udpPort.on("message", function(oscMsg, timeTag, info)
	{
		// Only the desk and configured external devices may send OSC.
		if(!allowedOscSource(info?.address, state.config)) {
			logger.debug("Ignored OSC from unexpected address " + info?.address);
			return;
		}
		logger.debug("Message received over UDP: " + JSON.stringify(oscMsg));

		// Only the desk itself says what it is, not an external device.
		// A desk entered as a hostname cannot be compared with the packet's address.
		const fromDesk = !net.isIP(state.config.desk.ip) || String(info?.address).replace(/^::ffff:/i, '') === state.config.desk.ip;
		if(fromDesk && noteDesk(oscMsg)) return;

		if(x32Mode()) {
			if(fromDesk) x32LastSeen = Date.now();
			const link = fromDesk ? x32.linkPair(oscMsg) : null;
			if(link) {
				const changed = x32Links.has(link.pair) && x32Links.get(link.pair) !== link.linked;
				x32Links.set(link.pair, link.linked);
				// Linking or unlinking buses changes which mixes exist.
				if(state.loaded && changed) reloadFromDesk();
				else if(!state.loaded) loadNextRequiredParameter();
				return;
			}
			// External devices and plugins keep using DiGiCo-style messages.
			const translated = fromDesk ? x32.fromDesk(oscMsg) : null;
			if(translated) oscMsg = translated;
			else if(fromDesk) return;
		}

		//session has changed. Reload
		if(oscMsg.address == "/Console/Session/!")
		{
			reloadFromDesk();
			return;
		}

		//ignore messages that are already cached
		queryQueue.received(oscMsg.address);
		if(state.cache.has(oscMsg.address) && JSON.stringify(state.cache.get(oscMsg.address)) == JSON.stringify(oscMsg))
		{
			logger.debug("Message already in cache " + JSON.stringify(oscMsg));
			if(!state.loaded) loadNextRequiredParameter();
			return;
		}

		oscMsg = processPlugins(oscMsg);
		if(oscMsg === false)
		{
			return;
		}

		processSnapshotMsg(oscMsg);

		maybeCacheResponse(oscMsg);

		if(!state.loaded)
		{
			loadNextRequiredParameter();
			return;
		}

		//respond from cache if a value exists
		const key = oscMsg.address.slice(0,-2);
		if(oscMsg.address.substr(-2) == "/?" && state.cache.has(key))
		{
			broadcast(state.cache.get(key));
			return;
		}

		broadcast(oscMsg, info.address); //send to everyone except the IP that it came from
	});

	state.udpPort.on("ready", fetchValues);

	state.udpPort.open();
	logger.info("Loading values from mixing desk...");
}

/**
 * Handles Current Snapshot messages sent by the console
 * @param {object} oscMsg
 */
function processSnapshotMsg(oscMsg)
{
	if(oscMsg.address == "/Snapshots/Current_Snapshot")
	{
		if(state.loaded && state.currentSnapshot !== -1 && state.currentSnapshot !== oscMsg.args[0]) {
			queryQueue.clear();
			for(const address of state.cache.keys()) if(/\/Aux_Send\/\d+\/send_(level|pan)$/.test(address)) state.cache.delete(address);
			for(const socket of state.connections) if(socket.readyState === webSocket.OPEN) {
				socket.send(JSON.stringify({ address: '/MixReload', args: [] }));
			}
		}
		state.currentSnapshot = oscMsg.args[0];

		//when the current snapshot has been deleted
		if(state.currentSnapshot < 0)
		{
			state.currentSnapshotName = "";
			broadcast({
				"address": "/SnapshotName",
				args: [
					state.currentSnapshotName
				]
			}, state.config.desk.ip);
			return;
		}

		//request the names for the current snapshots. We will use the response to store the snapshot name below.
		sendToDesk({address: "/Snapshots/names/?", args: []});

		return;
	}

	//rename the current snapshot
	let renameSnapshot = oscMsg.address.match(/^\/Snapshots\/Rename_Snapshot\/([0-9]+)$/);
	if(renameSnapshot !== null && renameSnapshot[1] == state.currentSnapshot)
	{
		state.currentSnapshotName = oscMsg.args[0];

		broadcast({
			"address": "/SnapshotName",
			args: [
				state.currentSnapshotName
			]
		}, state.config.desk.ip);

		return;
	}

	//if the message is the snapshot name we are waiting for
	if(oscMsg.address == "/Snapshots/name" && oscMsg.args[0] == state.currentSnapshot)
	{
		state.currentSnapshotName = oscMsg.args[oscMsg.args.length - 1];

		broadcast({
			"address": "/SnapshotName",
			args: [
				state.currentSnapshotName
			]
		}, state.config.desk.ip);
	}
}

/**
 * Broadcast an OSC message to all connections
 * @param {Object} oscMsg - the OSC message to send
 * @param {string|WebSocketConnection} source - don't broadcast to this connection
 * @returns {void}
 */
function broadcast(oscMsg, source)
{
	//notify desk
	if(state.config.desk.ip != source)
	{
		sendToDesk(oscMsg);
		logger.debug(`Sent ${JSON.stringify(oscMsg)} to Mixing Desk (${state.config.desk.ip})`);
	}

	//notify all external devices
	if(state.config.externalDevices)
	{
		for(let external of state.config.externalDevices)
		{
			if(external.broadcast && (external.loopback || external.ip != source))
			{
				state.udpPort.send(oscMsg, external.ip, external.port);
				logger.debug(`Sent ${JSON.stringify(oscMsg)} to External "${external.name}" (${external.ip}:${external.port})`);
			}
		}
	}

	//notify all webmixer connections
	let validConnections = [];
	const payload = JSON.stringify(oscMsg);
	const sendAux = /^\/Input_Channels\/\d+\/Aux_Send\/(\d+)\/send_(?:level|pan)$/.exec(oscMsg.address);
	state.connections.forEach(function(connection)
	{
		/**
		* CONNECTING = 0
		* OPEN = 1
		*/
		if(connection.readyState === webSocket.OPEN)
		{
			validConnections.push(connection);
			if(connection != source && (!sendAux || connection.clientInfo?.aux == null || connection.clientInfo.aux === Number(sendAux[1])))
			{
				connection.send(payload);
				logger.debug(`Sent ${JSON.stringify(oscMsg)} to socket ${validConnections.length}`);
			}
		}
	});
	state.connections = validConnections;
}

/**
 * Stop listening to OSC messages
 */
function stopOSC(onClosed)
{
	clearTimeout(discoveryTimer);
	queryQueue.clear();
	state.cache.clear();
	state.loaded = false;
	forgetDesk();
	state.currentSnapshot = -1;
	state.currentSnapshotName = '';
	clients.closeAllWebsocketConnections();
	const previousPort = state.udpPort;
	state.udpPort = undefined;
	if(previousPort) {
		if(onClosed) previousPort.once('close', onClosed);
		previousPort.close();
	} else if(onClosed) onClosed();
}

/**
 * Determine if we should cache the message and store it in memory.
 * @param {object} msg - the osc message to
 */
function maybeCacheResponse(msg)
{
	let matchAddresses = [
		/^\/Input_Channels\/(\d{1,3})\/Aux_Send\/(\d{1,3})\/send_level$/, //cache channel aux level
		/^\/Input_Channels\/(\d{1,3})\/Aux_Send\/(\d{1,3})\/send_pan$/, //cache channel aux pan
		/^\/Input_Channels\/(\d{1,3})\/Channel_Input\/name$/, //cache channel name
		/^\/Aux_Outputs\/([0-9]+)\/Buss_Trim\/name$/, //cache aux name
		/^\/Console\/Aux_Outputs\/modes$/, //cache aux modes (stereo or mono)
		/^\/Console\/Input_Channels$/ //cache total number of channels
	];

	for(let address of matchAddresses)
	{
		if(address.test(msg.address))
		{
			state.cache.set(msg.address, msg);
			logger.debug(`Cached ${JSON.stringify(msg)}`);
			return;
		}
	}
}

/**
 * Request the required parameters from the desk in order.
 * This gets called every time a mesage arrives until all the required parameters have loaded.
 */
function loadNextRequiredParameter()
{
	if(x32Mode())
	{
		// An X32 has a fixed layout. Only its bus links need asking for.
		if(!state.cache.has("/Console/Input_Channels")) state.cache.set("/Console/Input_Channels", {address: "/Console/Input_Channels", args: [x32.INPUT_COUNT]});
		if(!state.cache.has("/Console/Aux_Outputs/modes"))
		{
			const missing = x32.missingLink(x32Links);
			if(missing)
			{
				state.udpPort.send({address: missing, args: []}, state.config.desk.ip, X32_PORT);
				return;
			}
			state.cache.set("/Console/Aux_Outputs/modes", {address: "/Console/Aux_Outputs/modes", args: x32.busModes(x32Links)});
		}
	}

	if(!state.cache.has("/Console/Input_Channels"))
	{
		//reguest channel count (amoung other things)
		sendToDesk({address: "/Console/Channels/?", args: []});
		return;
	}

	if(!state.cache.has("/Console/Aux_Outputs/modes"))
	{
		//request aux modes
		sendToDesk({address: "/Console/Aux_Outputs/modes/?", args: []});
		return;
	}

	//request aux names
	for(let i=1; i<=state.cache.get("/Console/Aux_Outputs/modes").args.length; i++)
	{
		if(!state.cache.has(`/Aux_Outputs/${i}/Buss_Trim/name`))
		{
			sendToDesk({address: `/Aux_Outputs/${i}/Buss_Trim/name/?`, args: []});
			return;
		}
	}

	//request channel names
	for(let i=1; i<=state.cache.get("/Console/Input_Channels").args[0]; i++)
	{
		if(!state.cache.has(`/Input_Channels/${i}/Channel_Input/name`))
		{
			sendToDesk({address: `/Input_Channels/${i}/Channel_Input/name/?`, args: []});
			return;
		}
	}

	//request current snapshot. If there is a snapshot then the index on the snapshot will be returned.
	//We can then request the name of that snapshot
	sendToDesk({address: "/Snapshots/Current_Snapshot/?", args: []});

	state.loaded = true;
	primeCache();
	clearTimeout(discoveryTimer);
	logger.info("Loaded values from mixing desk.");

	clients.startWebSocketServer();
	logger.info("Webmixer ready to use.");
}

/**
 * Load AUX levels and panning values into the cache.
 * These aren't essential to using webmixer so they can load in the background.
 * @returns
 */
function primeCache()
{
	logger.debug("Priming Cache");
	const mix = mixView.getVisibleConfig();
	for(const aux of mix.aux) warmAux(aux.channel, false, mix);
	logger.debug("Background cache queries queued");
}

/**
 * Send a OSC message to a device via UDP
 * @param {string} name - the name of the device to send to
 * @param {object} msg - the OSC message to send
 */
function sendUDP(name, msg)
{
	if(state.config.externalDevices)
	{
		for(let external of state.config.externalDevices)
		{
			if(external.name == name)
			{
				state.udpPort.send(msg, external.ip, external.port);
					logger.debug(`Sent ${JSON.stringify(msg)} to External "${external.name}" (${external.ip}:${external.port})`);
			}
		}
	}
}

/**
 * Processes all loaded plugins.
 * @param {Object} oscMsg
 * @return {bool|object} - false when nothing should happen after the plugins have executed or the OSC message which may have been modified.
 */
function processPlugins(oscMsg)
{
	for(const plugin of plugins)
	{
		let response = plugin.handleOSC(oscMsg, {broadcast: broadcast, cache: state.cache, send: sendUDP});
		if(response === false)
		{
			return false;
		}
		if(response !== undefined)
		{
			oscMsg = response;
		}
	}
	return oscMsg;
}
Object.assign(exports, { queryQueue, warmAux, fetchValues, sendToDesk, probeDesk, noteDesk, startOSC, processSnapshotMsg, broadcast, stopOSC, maybeCacheResponse, loadNextRequiredParameter, primeCache, sendUDP, processPlugins });
