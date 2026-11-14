"use strict";

const os = require('node:os');
const { getResponder } = require('@homebridge/ciao');
const { getLANAddresses } = require('./utils/utils');

// A DNS-SD instance name is one DNS label: at most 63 bytes of UTF-8.
const MAX_NAME_BYTES = 63;

// Tidy an admin-entered server name: no control characters, single spaces,
// trimmed. Returns '' when blank and null when it is too long to advertise.
function cleanServerName(value) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') return null;
    const name = value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    return Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES ? null : name;
}

// The name apps show for this server: the admin's name, or one made from the computer name.
function serverName(configured, port, hostname = os.hostname()) {
    return cleanServerName(configured) ||
        `EarsMixer - ${hostname.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 35)} (${port})`;
}

// DNS-SD is only a locator. Clients still verify /api/connection and authenticate
// normally. Never advertise account information, tokens or saved layouts.
function advertiseMixer({ port, version, bindAddress = '0.0.0.0', logger = console,
    hostname = os.hostname(), getName = () => '', addresses = getLANAddresses, responderFactory = getResponder,
    refreshMs = 15000 }) {
    let responder, stopped = false, fingerprint = '', refreshing = false, again = false;

    async function refresh() {
        if (stopped) return;
        if (refreshing) { again = true; return; }
        refreshing = true;
        try {
            const name = serverName(getName(), port, hostname);
            const selected = addresses().filter(a => bindAddress === '0.0.0.0' || bindAddress === '::' || a.address === bindAddress);
            // A new name re-announces the service, so apps update without a restart.
            const next = JSON.stringify([name, selected]);
            if (next === fingerprint) return;
            fingerprint = next;
            const previous = responder;
            responder = undefined;
            if (previous) await previous.shutdown();
            if (stopped || !selected.length) return;
            responder = responderFactory({ interface: [...new Set(selected.map(a => a.name))], excludeIpv6: true });
            const service = responder.createService({ name, type: 'earsmixer', port,
                disabledIpv6: true, restrictedAddresses: selected.map(a => a.address),
                txt: { product: 'EarsMixer', protocol: '1', version, path: '/' } });
            // Advertising may wait for the network. Do not delay HTTP startup.
            service.advertise().then(() => {
                if (!stopped) logger.info(`Local discovery: ${name} on port ${port}.`);
            }).catch(error => { if (!stopped) logger.warn(`Local discovery unavailable: ${error.message}. Manual connections still work.`); });
        } catch (error) {
            fingerprint = ''; // retry after interfaces or permissions change
            logger.warn(`Local discovery unavailable: ${error.message}. Manual connections still work.`);
        } finally {
            refreshing = false;
            if (again) { again = false; void refresh(); }
        }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), refreshMs);
    timer.unref();
    async function stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        const previous = responder;
        responder = undefined;
        if (previous) await previous.shutdown().catch(error => logger.warn(`Discovery shutdown: ${error.message}`));
    }
    // Re-check the name and addresses now rather than at the next interval.
    stop.refresh = () => void refresh();
    return stop;
}

module.exports = { advertiseMixer, cleanServerName, serverName, MAX_NAME_BYTES };
