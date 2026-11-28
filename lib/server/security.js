"use strict";
// Small, testable checks used by the desk connection, WebSocket server and settings.
const net = require('node:net');
const os = require('node:os');

function plainAddress(address) {
	return typeof address === 'string' ? address.replace(/^::ffff:/i, '') : '';
}

/**
 * Whether an OSC packet may come from this address. Only the desk and the
 * configured external devices may send OSC. A desk entered as a hostname
 * cannot be compared with a packet's address, so it is not restricted.
 */
function allowedOscSource(address, config) {
	const desk = (config.desk?.ip || '').trim();
	if(!desk || !net.isIP(desk)) return true;
	const source = plainAddress(address);
	if(source === desk) return true;
	return (config.externalDevices || []).some(device => plainAddress(device.ip) === source);
}

/**
 * Whether a WebSocket upgrade came from this server's own pages. Requests
 * without an Origin header (native apps) are not from a browser page.
 */
function sameOrigin(req) {
	const origin = req.headers.origin;
	if(!origin) return true;
	try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

/**
 * Whether a request came from a program on this computer (the menu bar app),
 * not from the network or a web page. The Host check stops a page on another
 * site reaching this through a DNS name that points at 127.0.0.1.
 */
function localRequest(req) {
	const remote = plainAddress(req.socket?.remoteAddress);
	if(remote !== '127.0.0.1' && remote !== '::1') return false;
	if(req.headers.origin) return false;
	const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
	return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

/** Allow at most `limit` events per second; returns a function that reports whether to accept one. */
function createRateLimit(limit, now = Date.now) {
	let windowStart = 0, count = 0;
	return () => {
		const time = now();
		if(time - windowStart >= 1000) { windowStart = time; count = 0; }
		return ++count <= limit;
	};
}

const hostname = /^(?=.{1,253}$)([a-z\d]([a-z\d-]{0,61}[a-z\d])?)(\.[a-z\d]([a-z\d-]{0,61}[a-z\d])?)*$/i;

/** Whether a desk or device address is an IP address or a hostname. */
function validAddress(value) {
	return typeof value === 'string' && (net.isIP(value) !== 0 || hostname.test(value));
}

// Names that only the local network can answer for, so a website cannot point them at this server.
const LOCAL_NAME = /\.(?:local|lan|home\.arpa|internal|localdomain|localhost)$/;

function hostOf(value) {
	try { return new URL(value.includes('://') ? value : 'http://' + value).hostname.toLowerCase().replace(/\.$/, ''); }
	catch { return null; }
}

/**
 * Whether a request's Host is a name this server can be reached by. A website
 * can point its own domain at this server's address (DNS rebinding), and the
 * browser then treats the admin pages as part of that site. Such a request
 * carries the website's domain as its Host. IP addresses, local names, this
 * computer's name and the mixer link set in the admin are accepted.
 * @param {import('http').IncomingMessage} req
 * @param {{ server?: { publicUrl?: string } }} config
 */
function trustedHost(req, config, { computerName = os.hostname(), publicUrl = process.env.OSC_WEBMIXER_PUBLIC_URL } = {}) {
	const header = req.headers.host;
	// Browsers always send Host; a request without one is not from a web page.
	if(!header) return true;
	const host = hostOf(String(header));
	if(!host) return false;
	if(host.startsWith('[') || net.isIP(host) || host === 'localhost' || !host.includes('.') || LOCAL_NAME.test(host)) return true;
	const computer = computerName.toLowerCase().replace(/\.$/, '');
	if(host === computer || host === computer + '.local') return true;
	return [config.server?.publicUrl, publicUrl].some(url => url && hostOf(url) === host);
}

/**
 * Read the external OSC devices from the desk settings form. Returns null when
 * any entry is invalid, so nothing is saved from a malformed request.
 */
function readExternalDevices(body) {
	if(body.externalName === undefined) return [];
	const list = value => Array.isArray(value) ? value : null;
	const names = list(body.externalName), ips = list(body.externalIP), ports = list(body.externalReceive);
	const broadcasts = list(body.externalBroadcast), loopbacks = list(body.externalLoopback);
	if(!names || !ips || !ports || !broadcasts || !loopbacks || names.length > 32 ||
		[ips, ports, broadcasts, loopbacks].some(values => values.length !== names.length)) return null;
	const devices = [];
	for(let index = 0; index < names.length; index++) {
		const name = names[index], ip = typeof ips[index] === 'string' ? ips[index].trim() : '', port = Number(ports[index]);
		if(typeof name !== 'string' || !name.trim() || name.length > 80 || /[\x00-\x1f\x7f]/.test(name) ||
			!(net.isIP(ip) || hostname.test(ip)) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
		devices.push({ broadcast: broadcasts[index] == "true", name: name.trim(), ip, port, loopback: loopbacks[index] == "true" });
	}
	return devices;
}

module.exports = { allowedOscSource, sameOrigin, localRequest, createRateLimit, readExternalDevices, validAddress, trustedHost };
