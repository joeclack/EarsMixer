"use strict";
// Musician and dashboard WebSocket connections.
const webSocket = require("ws");
const logger = require('../logging/logger.js');
const { deviceUsername } = require('../templates.js');
const { dbToSlider, panToCentered } = require('../mix-values.js');
const { sendAuxPresence, broadcastAuxPresence } = require('../aux-presence.js');
const { parseRequest, createRequestLimit } = require('../requests.js');
const { state } = require('./state.js');
const { sameOrigin, createRateLimit } = require('./security.js');
const mixView = require('./mix.js');
const desk = require('./desk.js');
let nextClientId = 1;

function logClient(socket, entry) {
	socket.clientInfo.log.push({ at: Date.now(), ...entry });
	if(socket.clientInfo.log.length > 100) socket.clientInfo.log.shift();
}

function selectClientAux(socket, aux) {
	const selected = socket.mixConfig.aux.find(entry => entry.channel === aux);
	if(!selected) return false;
	if(socket.clientInfo.aux !== aux) {
		logClient(socket, { type: 'aux', aux, auxLabel: selected.label, value: aux });
		const previous = socket.clientInfo.aux;
		socket.clientInfo.aux = aux;
		desk.warmAux(aux, true, socket.mixConfig);
		broadcastAuxPresence(state.connections, previous);
		broadcastAuxPresence(state.connections, aux);
	}
	return true;
}

function startWebSocketServer() {
	if(state.wss) return;
	// Mixer messages are tiny; refuse anything large before parsing it.
	state.wss = new webSocket.Server({ server: state.server, maxPayload: 64 * 1024 });
	const presenceServer = state.wss;
	const presenceHeartbeat = setInterval(() => {
		for (const socket of presenceServer.clients) {
			if (socket.isAlive === false) { socket.terminate(); continue; }
			socket.isAlive = false; socket.ping();
		}
	}, 30000);
	presenceHeartbeat.unref();
	state.wss.on('close', () => clearInterval(presenceHeartbeat));
	state.wss.on('connection', function(socket, req) {
		if(!state.loaded) { socket.close(); return; }
		socket.isAlive = true;
		socket.on('pong', () => { socket.isAlive = true; });
		socket.isObserver = new URL(req.url, 'http://localhost').searchParams.get('role') === 'observer';
		// The admin dashboard's live view observes with the admin session instead of a PIN.
		// It must also come from the dashboard itself, so another website open in
		// the admin's browser cannot watch the live mix. Musician connections may
		// come from other origins by design (the app's web build).
		if(socket.isObserver && (!sameOrigin(req) || !state.adminAuth.authenticated(req))) { socket.close(4403, 'Admin sign-in required'); return; }
		// A fader drag sends a few dozen messages a second; ignore floods beyond that.
		const withinRate = createRateLimit(300);
		const withinRequestLimit = createRequestLimit();
		// Settings changes close clients; reuse this configuration during fader moves.
		socket.mixConfig = mixView.getVisibleConfig();
		socket.clientInfo = { id: nextClientId++, username: null, deviceId: null, deviceName: null, address: req.socket.remoteAddress,
			connectedAt: Date.now(), lastActivity: Date.now(), aux: null, log: [] };
		// A client joins the live mix only once admitted. With no PIN required it is
		// admitted straight away; otherwise it must send its device and token first.
		const admit = () => {
			socket.admitted = true;
			clearTimeout(socket.authTimer);
			state.connections.push(socket);
			socket.send(mixView.buildConfig());
			sendAuxPresence(socket, state.connections);
		};
		if(socket.isObserver || !state.clientAccess.required()) admit();
		else socket.authTimer = setTimeout(() => rejectClient(socket, 'required'), 10000);
		socket.on('message', function(data) {
			if(!withinRate()) return;
			let msg;
			try { msg = JSON.parse(data.toString()); } catch { return; }
			if(!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
			if(socket.isObserver) return;
			if('auth' in msg) {
				const device = state.clientAccess.identify(msg.auth && typeof msg.auth === 'object' ? msg.auth : {}, req.socket.remoteAddress);
				if(!device) { rejectClient(socket, 'required'); return; }
				socket.clientInfo.deviceId = device.id; socket.clientInfo.deviceName = device.name ?? null;
				if(!socket.admitted) admit();
				return;
			}
			if(!socket.admitted) return;
			socket.clientInfo.lastActivity = Date.now();
			if('username' in msg) {
				try {
					const nickname = deviceUsername(msg.username);
					if (nickname !== socket.clientInfo.username) {
						socket.clientInfo.username = nickname;
						broadcastAuxPresence(state.connections, socket.clientInfo.aux);
					}
				} catch {}
				return;
			}
			if('meters' in msg) {
				state.meters?.subscribe(socket, msg.meters === true);
				return;
			}
			if('request' in msg) {
				// A request to the engineer. Too many close together are dropped.
				const request = parseRequest(msg.request);
				if(!request || !withinRequestLimit()) { socket.send(JSON.stringify({ requestRejected: true })); return; }
				const info = socket.clientInfo;
				const item = state.requests.add(request, { clientId: info.id, name: info.username || info.deviceName, aux: info.aux,
					auxLabel: info.aux ? state.cache.get(`/Aux_Outputs/${info.aux}/Buss_Trim/name`)?.args[0] ?? null : null });
				logClient(socket, { type: 'request', label: item.label, text: item.text, value: item.id });
				socket.send(JSON.stringify({ requestSent: { id: item.id, kind: item.kind, text: item.text, at: item.at } }));
				return;
			}
			if('selectedAux' in msg) {
				const previous = socket.clientInfo.aux;
				if (selectClientAux(socket, Number(msg.selectedAux)) && previous === socket.clientInfo.aux) sendAuxPresence(socket, state.connections);
				return;
			}
			if(typeof msg.address !== 'string' || !Array.isArray(msg.args)) return;
			const match = /^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan|on)(\/\?)?$/.exec(msg.address);
			if(!match) return;
			const channel = Number(match[1]), aux = Number(match[2]), parameter = match[3], query = !!match[4];
			const mix = socket.mixConfig;
			if(!mix.channels.some(entry => entry.channel === channel) || !mix.aux.some(entry => entry.channel === aux)) return;
			// send_on is 1 (on) or 0 (off, muted in this mix).
			if(query ? msg.args.length !== 0 : (msg.args.length !== 1 || !Number.isFinite(msg.args[0]) ||
				(parameter === 'level' ? msg.args[0] < -150 || msg.args[0] > 10 : parameter === 'on' ? msg.args[0] !== 0 && msg.args[0] !== 1 : msg.args[0] < 0 || msg.args[0] > 1))) return;
			selectClientAux(socket, aux);
			msg = desk.processPlugins(msg);
			if(msg === false) return;
			if(query) {
				const key = msg.address.slice(0, -2);
				if(state.cache.has(key)) socket.send(JSON.stringify(state.cache.get(key)));
				else desk.queryQueue.request(key, true);
				return;
			}
			if(state.cache.has(msg.address) && JSON.stringify(state.cache.get(msg.address)) === JSON.stringify(msg)) return;
			const previous = state.cache.get(msg.address)?.args[0];
			if(parameter === 'on') logClient(socket, { type: 'mute', aux, auxLabel: state.cache.get(`/Aux_Outputs/${aux}/Buss_Trim/name`)?.args[0],
				channel, channelLabel: state.cache.get(`/Input_Channels/${channel}/Channel_Input/name`)?.args[0], value: msg.args[0], previousValue: previous ?? null });
			else logClient(socket, { type: parameter, aux, auxLabel: state.cache.get(`/Aux_Outputs/${aux}/Buss_Trim/name`)?.args[0],
				channel, channelLabel: state.cache.get(`/Input_Channels/${channel}/Channel_Input/name`)?.args[0],
				value: parameter === 'level' ? dbToSlider(msg.args[0]) : panToCentered(msg.args[0]),
				previousValue: parameter === 'level' ? dbToSlider(previous) : panToCentered(previous) });
			desk.maybeCacheResponse(msg);
			desk.broadcast(msg, socket);
		});
		socket.on('close', () => {
			clearTimeout(socket.authTimer);
			if(!socket.admitted) return;
			if(!socket.isObserver) state.disconnectedClients.unshift(mixView.serializeClient(socket, Date.now()));
			if(state.disconnectedClients.length > 50) state.disconnectedClients.pop();
			state.connections = state.connections.filter(connection => connection !== socket);
			socket.metersWanted = false;
			state.meters?.update();
			if (!socket.isObserver) broadcastAuxPresence(state.connections, socket.clientInfo.aux);
		});
		socket.on('error', err => logger.debug('Client socket error: ' + err.message));
	});
	state.wss.on('error', err => logger.error('wss error: ' + err));
}

/**
 * Tell a client it needs the connection PIN (or that its access was revoked),
 * then close it. Clients stop reconnecting and ask for the PIN.
 */
function rejectClient(socket, reason)
{
	clearTimeout(socket.authTimer);
	if(socket.readyState === webSocket.OPEN) {
		socket.send(JSON.stringify({ auth: reason }));
		socket.close(4401, reason === 'revoked' ? 'Access revoked' : 'PIN required');
	}
}

/**
 * Close all webmixer connections
 */
function closeAllWebsocketConnections()
{
	for(let connection of state.connections)
	{
		connection.close();
	}
	state.connections = [];
}
Object.assign(exports, { logClient, selectClientAux, startWebSocketServer, rejectClient, closeAllWebsocketConnections });
