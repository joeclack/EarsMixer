"use strict";
// PIN-based access for mixer clients (the mobile app and the browser mixer).
//
// When enabled, a device must pair once by entering the PIN shown on the admin
// dashboard. Pairing returns a random access token that the device keeps and
// presents on every connection. Access lasts until the admin changes the PIN,
// signs out every device, or revokes that device.
//
// Devices are identified by an ID the client generates and stores, because
// IP addresses change and phones do not expose a stable hardware address.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomBytes, randomInt, timingSafeEqual } = require("node:crypto");

const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_DEVICES = 500;
const hash = token => createHash("sha256").update(token).digest("hex");
const newPin = () => String(randomInt(0, 1000000)).padStart(6, "0");

function deviceName(value) {
    if (typeof value !== "string") return null;
    const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    return name && name.length <= 80 && !/[\x00-\x1f\x7f]/.test(name) ? name : null;
}

async function createClientAccess(directory = process.env.OSC_WEBMIXER_DATA_DIR || path.join(__dirname, "..", "data")) {
    const file = path.join(directory, "client-access.json");
    let state = { version: 1, enabled: false, pin: newPin(), devices: {} };
    try {
        const saved = JSON.parse(await fs.readFile(file, "utf8"));
        if (saved?.version !== 1 || typeof saved.enabled !== "boolean" || !/^\d{6}$/.test(saved.pin) || !saved.devices || typeof saved.devices !== "object")
            throw new Error("Invalid client access file.");
        state = saved;
    } catch (error) {
        // A damaged file must never silently switch the PIN off.
        if (error.code !== "ENOENT") throw error;
    }
    let writes = Promise.resolve();
    const listeners = new Set();
    function persist() {
        const snapshot = JSON.stringify(state, null, 2) + "\n";
        const write = async () => {
            await fs.mkdir(directory, { recursive: true });
            const temporary = file + "." + randomBytes(8).toString("hex") + ".tmp";
            try {
                await fs.writeFile(temporary, snapshot, { flag: "wx", mode: 0o600 });
                await fs.rename(temporary, file);
            } finally {
                await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
            }
        };
        const result = writes.then(write);
        writes = result.catch(() => { });
        return result;
    }
    // Notify the server so it can disconnect clients that lost access.
    const changed = () => { for (const listener of listeners) listener(); };

    // Brute-force limits: per address, per device and overall, each per minute.
    const attempts = new Map();
    function allow(key, limit) {
        const now = Date.now();
        for (const [entry, value] of attempts) if (value.expires <= now) attempts.delete(entry);
        const attempt = attempts.get(key) || { count: 0, expires: now + 60000 };
        if (attempt.count >= limit) return Math.ceil((attempt.expires - now) / 1000);
        attempt.count++; attempts.set(key, attempt);
        return 0;
    }

    // Keep paired devices ahead of unpaired ones, so a flood of new IDs cannot
    // push paired devices out of the list.
    function prune() {
        const devices = Object.values(state.devices).sort((a, b) => (!!b.tokenHash - !!a.tokenHash) || b.lastSeen - a.lastSeen);
        for (const device of devices.slice(MAX_DEVICES)) delete state.devices[device.id];
    }
    function record(id, address, name) {
        const now = Date.now();
        const device = state.devices[id] || (state.devices[id] = { id, name: null, tokenHash: null, pairedAt: null, firstSeen: now, lastSeen: now, lastAddress: null });
        device.lastSeen = now;
        if (address) device.lastAddress = address;
        if (name !== undefined) device.name = deviceName(name) ?? device.name;
        prune();
        return device;
    }
    function tokenMatches(device, token) {
        if (!device?.tokenHash || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return false;
        return timingSafeEqual(Buffer.from(hash(token), "hex"), Buffer.from(device.tokenHash, "hex"));
    }

    return {
        required: () => state.enabled,
        onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        // Called for every connection that identifies itself. Returns the device
        // when it may connect, or null when it needs to pair first.
        identify({ device, token, name } = {}, address) {
            if (typeof device !== "string" || !DEVICE_ID.test(device)) return state.enabled ? null : { id: null };
            const known = state.devices[device];
            if (state.enabled && !tokenMatches(known, token)) return null;
            const previous = known && { seen: known.lastSeen, address: known.lastAddress, name: known.name };
            const entry = record(device, address, name);
            // Save new devices and changes straight away, but routine reconnects at
            // most once a minute, so a chatty client cannot cause constant writes.
            if (!previous || previous.address !== entry.lastAddress || previous.name !== entry.name || entry.lastSeen - previous.seen > 60000)
                void persist().catch(error => console.error("Could not save device activity", error));
            return entry;
        },
        isAuthorized(deviceId) { return !state.enabled || !!state.devices[deviceId]?.tokenHash; },
        async pair(body, address) {
            if (!state.enabled) return { status: 200, body: { paired: true, token: null } };
            const device = body?.device, pin = body?.pin;
            if (typeof device !== "string" || !DEVICE_ID.test(device))
                return { status: 400, body: { error: "This device could not be identified. Restart the app and try again." } };
            const wait = allow("address:" + address, 5) || allow("device:" + device, 5) || allow("all", 30);
            if (wait) return { status: 429, headers: { "Retry-After": String(wait) }, body: { error: "Too many PIN attempts. Try again in a minute." } };
            const entered = typeof pin === "string" ? pin.replace(/\s+/g, "") : "";
            if (!/^\d{6}$/.test(entered) || !timingSafeEqual(Buffer.from(entered), Buffer.from(state.pin)))
                return { status: 401, body: { error: "Incorrect PIN. Check it with the person running the mixer." } };
            const token = randomBytes(32).toString("hex");
            const entry = record(device, address, body?.name);
            entry.tokenHash = hash(token); entry.pairedAt = Date.now();
            await persist();
            return { status: 200, body: { paired: true, token } };
        },
        summary() {
            return {
                enabled: state.enabled, pin: state.pin,
                devices: Object.values(state.devices).sort((a, b) => b.lastSeen - a.lastSeen).map(({ tokenHash, ...device }) => ({ ...device, paired: !!tokenHash })),
            };
        },
        async setEnabled(enabled) { state.enabled = !!enabled; await persist(); changed(); },
        // A new PIN also signs every device out.
        async changePin() { state.pin = newPin(); for (const device of Object.values(state.devices)) device.tokenHash = null; await persist(); changed(); },
        async revokeAll() { for (const device of Object.values(state.devices)) device.tokenHash = null; await persist(); changed(); },
        async revoke(id) {
            const device = state.devices[id];
            if (!device) return false;
            device.tokenHash = null; await persist(); changed();
            return true;
        },
        async forget(id) {
            if (!state.devices[id]) return false;
            delete state.devices[id]; await persist(); changed();
            return true;
        },
    };
}

module.exports = { createClientAccess, DEVICE_ID };
