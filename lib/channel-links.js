"use strict";
// Linked channels: two desk inputs, such as Guitar 1 L and Guitar 1 R, that the
// admin joins so musicians get one fader for both. The server keeps their send
// levels and mutes the same in every mix. Pan stays per channel, so a stereo
// pair keeps its left and right.

const crypto = require('node:crypto');

const MAX_LINKS = 128;
const MAX_NAME_LENGTH = 40;
/** The send parameters a link keeps the same on both channels. */
const LINKED_PARAMETERS = new Set(['level', 'on']);

const isChannel = value => Number.isInteger(value) && value > 0 && value <= 1000;

/** A link's name, trimmed, or null if it is missing or too long. */
function linkName(value) {
	if(typeof value !== 'string') return null;
	const name = value.trim().replace(/\s+/g, ' ');
	return name && name.length <= MAX_NAME_LENGTH ? name : null;
}

/**
 * Saved links, keeping only valid ones. A channel belongs to at most one link,
 * so a later link that reuses a channel is dropped.
 * @param {unknown} value
 * @returns {{ id: string, name: string, channels: [number, number] }[]}
 */
function readLinks(value) {
	if(!Array.isArray(value)) return [];
	const used = new Set(), ids = new Set(), links = [];
	for(const entry of value.slice(0, MAX_LINKS)) {
		if(!entry || typeof entry !== 'object') continue;
		const name = linkName(entry.name);
		const channels = Array.isArray(entry.channels) ? entry.channels.map(Number) : [];
		const id = typeof entry.id === 'string' && /^[a-f0-9-]{1,64}$/i.test(entry.id) ? entry.id : null;
		if(!name || !id || ids.has(id) || channels.length !== 2 || !channels.every(isChannel) || channels[0] === channels[1]) continue;
		if(channels.some(channel => used.has(channel))) continue;
		channels.forEach(channel => used.add(channel)); ids.add(id);
		links.push({ id, name, channels: [channels[0], channels[1]] });
	}
	return links;
}

/**
 * Check a new link against the existing ones.
 * @param {ReturnType<typeof readLinks>} links
 * @param {unknown} body - `{ name, channels: [first, second] }`
 * @param {number[]} deskChannels - channel numbers the desk reports
 * @returns {{ link: { id: string, name: string, channels: [number, number] } } | { error: string }}
 */
function createLink(links, body, deskChannels) {
	if(links.length >= MAX_LINKS) return { error: 'There are too many linked channels. Remove one first.' };
	const name = linkName(body?.name);
	if(!name) return { error: `Give the linked channels a name of ${MAX_NAME_LENGTH} characters or fewer.` };
	const channels = Array.isArray(body?.channels) ? body.channels.map(Number) : [];
	if(channels.length !== 2 || !channels.every(isChannel)) return { error: 'Choose two channels to link.' };
	if(channels[0] === channels[1]) return { error: 'Choose two different channels.' };
	if(!channels.every(channel => deskChannels.includes(channel))) return { error: 'The desk doesn’t have one of those channels. Refresh and try again.' };
	const taken = channels.find(channel => links.some(link => link.channels.includes(channel)));
	if(taken !== undefined) return { error: `Channel ${taken} is already linked. Remove that link first.` };
	return { link: { id: crypto.randomUUID(), name, channels: [channels[0], channels[1]] } };
}

/** The other channel in a channel's link, or null. */
function partnerOf(links, channel) {
	const link = links.find(entry => entry.channels.includes(channel));
	return link ? link.channels[link.channels[0] === channel ? 1 : 0] : null;
}

/**
 * The level two channels meet at when they're linked: halfway between them in
 * dB, so -1 dB and +1 dB both become 0 dB. A channel at −∞ (-150) counts as
 * -150 dB. With one level unknown, both take the known one.
 * @param {number | undefined} first
 * @param {number | undefined} second
 * @returns {number | null}
 */
function midpointLevel(first, second) {
	const known = [first, second].filter(Number.isFinite);
	if(!known.length) return null;
	const level = known.reduce((sum, value) => sum + value, 0) / known.length;
	return Math.round(Math.max(-150, Math.min(10, level)) * 100) / 100;
}

/**
 * The links musicians are sent with the mix: name and channels, for links
 * whose channels are both shown. The first channel is the one the app's
 * fader writes; the server copies changes to the second.
 * @param {ReturnType<typeof readLinks>} links
 * @param {{ channel: number, enabled?: boolean }[]} channels
 */
function visibleLinks(links, channels) {
	const shown = new Set(channels.filter(channel => channel.enabled !== false).map(channel => channel.channel));
	return links.filter(link => link.channels.every(channel => shown.has(channel))).map(link => ({ name: link.name, channels: [...link.channels] }));
}

module.exports = { MAX_LINKS, MAX_NAME_LENGTH, LINKED_PARAMETERS, readLinks, createLink, partnerOf, midpointLevel, visibleLinks };
