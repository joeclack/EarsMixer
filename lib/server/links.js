"use strict";
// Linked channels at runtime: the admin creates and removes links, linking
// brings both channels to the same level in every mix, and a musician's level
// or mute change on one channel is copied to the other.
const configManager = require('../config/configManager.js');
const logger = require('../logging/logger.js');
const { readLinks, createLink, partnerOf, midpointLevel, LINKED_PARAMETERS } = require('../channel-links.js');
const { state } = require('./state.js');

// desk.js and clients.js require this module, so load them when first used.
const desk = () => require('./desk.js');
const clients = () => require('./clients.js');

const SEND = /^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan|on)$/;
const sendAddress = (channel, aux, parameter) => `/Input_Channels/${channel}/Aux_Send/${aux}/send_${parameter}`;
// How long a new link waits for the desk to report a channel's level.
const PENDING_MS = 30000;
// Links still waiting to meet in the middle, by `first:second:aux`.
const pending = new Map();

/** The saved links, validated. */
function links() {
	return readLinks(state.currentState.links);
}

/** Channel numbers the desk has named. */
function deskChannels() {
	const count = state.cache.get('/Console/Input_Channels')?.args[0] ?? 0;
	return Array.from({ length: count }, (_, index) => index + 1).filter(channel => state.cache.has(`/Input_Channels/${channel}/Channel_Input/name`));
}

/** Every AUX on the desk, shown to musicians or not, so a link stays even in mixes shown later. */
function deskAuxes() {
	const modes = state.cache.get('/Console/Aux_Outputs/modes')?.args ?? [];
	return modes.map((_, index) => index + 1).filter(aux => state.cache.has(`/Aux_Outputs/${aux}/Buss_Trim/name`));
}

/** Send a value to the desk and everyone else, unless it is already set. */
function send(address, value) {
	const message = { address, args: [value] };
	if(JSON.stringify(state.cache.get(address)) === JSON.stringify(message)) return;
	desk().maybeCacheResponse(message);
	desk().broadcast(message);
}

const level = (channel, aux) => state.cache.get(sendAddress(channel, aux, 'level'))?.args[0];

/** Set both channels to the level halfway between them in this mix. */
function meet(link, aux) {
	const target = midpointLevel(level(link.channels[0], aux), level(link.channels[1], aux));
	if(target === null) return;
	for(const channel of link.channels) send(sendAddress(channel, aux, 'level'), target);
}

/**
 * Bring a link's channels to the same level in every mix. Levels the server
 * hasn't loaded yet are asked for, and the link meets in the middle when they
 * arrive.
 */
function syncLink(link) {
	for(const aux of deskAuxes()) {
		const missing = link.channels.filter(channel => !Number.isFinite(level(channel, aux)));
		if(!missing.length) { meet(link, aux); continue; }
		pending.set(link.channels.join(':') + ':' + aux, Date.now());
		for(const channel of missing) desk().queryQueue.request(sendAddress(channel, aux, 'level'), true);
	}
}

/** Called for each value from the desk: finish any link that was waiting for it. */
function onDeskValue(message) {
	if(!pending.size) return;
	const match = SEND.exec(message.address || '');
	if(!match || match[3] !== 'level') return;
	const channel = Number(match[1]), aux = Number(match[2]), now = Date.now();
	for(const [key, since] of pending) if(now - since > PENDING_MS) pending.delete(key);
	const link = links().find(entry => entry.channels.includes(channel));
	const key = link && link.channels.join(':') + ':' + aux;
	if(!key || !pending.has(key) || link.channels.some(member => !Number.isFinite(level(member, aux)))) return;
	pending.delete(key);
	meet(link, aux);
}

/**
 * A musician changed a send: copy a level or mute change to the linked channel.
 * Pan isn't copied, so a stereo pair keeps its left and right.
 */
function mirror(message) {
	const match = SEND.exec(message.address || '');
	if(!match || !LINKED_PARAMETERS.has(match[3])) return;
	const partner = partnerOf(links(), Number(match[1]));
	if(partner === null) return;
	send(sendAddress(partner, Number(match[2]), match[3]), message.args[0]);
}

/** Links with each channel's desk name, for the admin dashboard. */
function list() {
	return links().map(link => ({ ...link,
		labels: link.channels.map(channel => state.cache.get(`/Input_Channels/${channel}/Channel_Input/name`)?.args[0] ?? 'Channel ' + channel) }));
}

/** Save a new link, bring its channels together and reload musicians' mixes. */
function create(body) {
	const result = createLink(links(), body, deskChannels());
	if(result.error) return result;
	state.currentState.links = [...links(), result.link];
	configManager.saveCurrentState(state.currentState);
	logger.info(`Linked channels ${result.link.channels.join(' and ')} as "${result.link.name}".`);
	syncLink(result.link);
	// Phones reconnect and get the mix with the new link.
	clients().closeAllWebsocketConnections();
	return { link: list().find(link => link.id === result.link.id) };
}

/** Remove a link. The channels keep their current levels. */
function remove(id) {
	const current = links();
	if(!current.some(link => link.id === id)) return false;
	state.currentState.links = current.filter(link => link.id !== id);
	configManager.saveCurrentState(state.currentState);
	for(const key of pending.keys()) if(!state.currentState.links.some(link => key.startsWith(link.channels.join(':') + ':'))) pending.delete(key);
	clients().closeAllWebsocketConnections();
	return true;
}

/** Bring every link together, for example after a preset with links is loaded. */
function syncAll() {
	for(const link of links()) syncLink(link);
}

module.exports = { links, list, create, remove, mirror, onDeskValue, syncLink, syncAll, deskChannels, deskAuxes };
