"use strict";
// Stream channel signal meters from the desk to musician clients.

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
		// A live source asks the desk once per tick for every channel someone can see.
		if(source.poll) {
			const wanted = new Set();
			for(const socket of listening) for(const entry of (socket.mixConfig?.channels || []).slice(0, maxChannels)) wanted.add(entry.channel);
			source.poll([...wanted]);
		}
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
		/** Desk replies that are meter readings stop here; returns true when consumed. */
		receive: (message, options) => !!source?.receive?.(message, options),
		stats: () => source?.stats?.() ?? (source ? { kind: source.kind } : null),
		subscribe(socket, wanted) { socket.metersWanted = !!wanted && !!source; update(); },
		update, stop,
	};
}

module.exports = { createMeterStream };
