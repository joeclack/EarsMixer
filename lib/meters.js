"use strict";
// Channel signal meters for musician clients.
//
// Real DiGiCo meter requests are not implemented: the console's input-meter
// addresses, units and subscription lifecycle have not been confirmed against
// a real desk, and must not be guessed from its output-meter addresses. Until
// they are, a real desk has no meter source and clients hide their meters.
//
// The demo (npm run dev) uses a simulated source instead. Its readings are
// marked "simulated" so clients never present them as real console data.

const METER_FLOOR = -60;

// A small, repeatable pseudo-random generator per channel.
function seeded(seed) {
	let value = seed >>> 0 || 1;
	return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
}

/**
 * Simulated band signals: kick and snare hits on a 120 bpm grid, sustained
 * sources that drift and breathe, and the odd peak that touches clip. Each
 * channel's character depends only on its number, so the demo is stable.
 */
function createSimulatedMeterSource({ now = () => Date.now() } = {}) {
	const channels = new Map();
	function channelState(channel) {
		let entry = channels.get(channel);
		if(!entry) {
			const random = seeded(channel * 2654435761);
			const kinds = ['kick', 'snare', 'hat', 'sustain', 'sustain', 'vocal', 'sustain', 'quiet'];
			entry = { random, kind: kinds[(channel - 1) % kinds.length], base: -26 + random() * 12, drift: 0, phase: random() * Math.PI * 2, silentUntil: 0 };
			channels.set(channel, entry);
		}
		return entry;
	}
	function level(channel, time) {
		const entry = channelState(channel);
		const beat = (time / 500) % 4; // 120 bpm, four beats to a bar
		const sinceBeat = (beat % 1) * 500;
		const noise = (entry.random() - 0.5) * 3;
		entry.drift = Math.max(-6, Math.min(6, entry.drift + (entry.random() - 0.5) * 0.6));
		if(entry.silentUntil > time) return null;
		// Sustained sources and vocals rest now and then, like real players.
		if((entry.kind === 'vocal' || entry.kind === 'sustain') && entry.random() < 0.0015) entry.silentUntil = time + 1500 + entry.random() * 3000;
		let db;
		switch(entry.kind) {
			case 'kick': db = -6 - sinceBeat / 18 + noise; break;
			case 'snare': db = (Math.floor(beat) % 2 === 1 ? -8 - sinceBeat / 16 : -38) + noise; break;
			case 'hat': db = -22 - ((time / 250) % 1) * 250 / 14 + noise; break;
			case 'vocal': db = entry.base + 4 + Math.sin(time / 700 + entry.phase) * 7 + entry.drift + noise; break;
			case 'quiet': db = -48 + Math.sin(time / 1300 + entry.phase) * 6 + noise; break;
			default: db = entry.base + Math.sin(time / 900 + entry.phase) * 4 + entry.drift + noise;
		}
		// A rare peak that touches clip shows the clip indicator.
		if(entry.random() < 0.0008) db = 0.5;
		db = Math.min(1, db);
		return db < METER_FLOOR ? null : Math.round(db * 10) / 10;
	}
	return {
		kind: 'simulated',
		read(channelNumbers) {
			const time = now();
			return channelNumbers.map(channel => [channel, level(channel, time)]);
		},
	};
}

/**
 * Streams readings to clients that asked for meters, at a bounded rate. The
 * timer only runs while at least one client is subscribed, and a client that
 * falls behind is skipped rather than queued.
 */
function createMeterStream({ source, clients, rate = 15, maxBuffered = 64 * 1024, maxChannels = 256 }) {
	let timer = null;
	const interval = Math.round(1000 / rate);
	function subscribers() { return clients().filter(socket => socket.metersWanted && socket.readyState === 1); }
	function tick() {
		const listening = subscribers();
		if(!listening.length) { stop(); return; }
		for(const socket of listening) {
			if(socket.bufferedAmount > maxBuffered) continue;
			const channels = (socket.mixConfig?.channels || []).slice(0, maxChannels).map(entry => entry.channel);
			if(!channels.length) continue;
			try { socket.send(JSON.stringify({ meters: { kind: source.kind, levels: source.read(channels) } })); } catch {}
		}
	}
	function stop() { if(timer) { clearInterval(timer); timer = null; } }
	function update() {
		if(!source) { stop(); return; }
		if(subscribers().length && !timer) { timer = setInterval(tick, interval); timer.unref?.(); }
		else if(!subscribers().length) stop();
	}
	return {
		available: () => !!source,
		kind: () => source?.kind ?? null,
		subscribe(socket, wanted) { socket.metersWanted = !!wanted && !!source; update(); },
		update, stop,
	};
}

module.exports = { METER_FLOOR, createSimulatedMeterSource, createMeterStream };
