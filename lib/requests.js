"use strict";
// Requests from musicians to the engineer: one-tap asks plus an optional short
// message. The engineer acknowledges them on the admin dashboard.

const KINDS = Object.freeze({
	'more-me': 'More me',
	'less-me': 'Less me',
	'more-click': 'More click',
	'talk': 'Talk to me',
	'problem': 'Problem',
});
const MAX_TEXT = 140;

/** A request from a musician, or null when it has nothing valid to say. */
function parseRequest(raw) {
	if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const kind = typeof raw.kind === 'string' && Object.hasOwn(KINDS, raw.kind) ? raw.kind : null;
	// Collapse whitespace and drop control characters so a message stays one tidy line.
	const text = typeof raw.text === 'string'
		? raw.text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '';
	if(!kind && !text) return null;
	return { kind, text };
}

/** The newest requests, oldest dropped first. */
function createRequestBoard({ now = () => Date.now(), limit = 50 } = {}) {
	const items = [];
	let nextId = 1;
	return {
		add(request, from) {
			const item = { id: nextId++, at: now(), kind: request.kind, label: request.kind ? KINDS[request.kind] : 'Message', text: request.text,
				clientId: from.clientId, name: from.name ?? null, aux: from.aux ?? null, auxLabel: from.auxLabel ?? null, acknowledgedAt: null };
			items.unshift(item);
			if(items.length > limit) items.length = limit;
			return item;
		},
		acknowledge(id) {
			const item = items.find(entry => entry.id === id);
			if(!item) return null;
			item.acknowledgedAt ??= now();
			return item;
		},
		list() { return items.map(item => ({ ...item })); },
		remove(id) {
			const index = items.findIndex(entry => entry.id === id);
			if(index < 0) return false;
			items.splice(index, 1);
			return true;
		},
		clear() { items.length = 0; },
	};
}

/** At most `burst` requests close together, and no more than `perMinute` a minute. */
function createRequestLimit({ now = () => Date.now(), gap = 1500, perMinute = 8 } = {}) {
	let last = -Infinity;
	const times = [];
	return () => {
		const time = now();
		while(times.length && time - times[0] >= 60000) times.shift();
		if(time - last < gap || times.length >= perMinute) return false;
		last = time; times.push(time);
		return true;
	};
}

module.exports = { KINDS, MAX_TEXT, parseRequest, createRequestBoard, createRequestLimit };
