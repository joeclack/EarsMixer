"use strict";

// How long a change still counts as recent. A mix changed last week must not
// look like someone is using it now.
const RECENT_CHANGE_MS = 2 * 60 * 60 * 1000;

// The last change to each mix: who made it and when. Kept in memory only; it
// is a hint for musicians, not a record.
const lastChanges = new Map();

function sameDevice(a, b) {
    return a === b || (!!a?.clientInfo?.deviceId && a.clientInfo.deviceId === b?.clientInfo?.deviceId);
}

// Call when a phone changes a send on a mix.
function recordAuxChange(socket, aux, at = Date.now()) {
    const info = socket.clientInfo;
    lastChanges.set(aux, { at, clientId: info.id, deviceId: info.deviceId || null, nickname: info.username || info.deviceName || null });
}

// Presence exposes only a connection ID and nickname, never addresses or admin
// data. Other connections from the same device are not "someone else". The last
// change says only who, how long ago and whether it was this device.
function sendAuxPresence(socket, connections, now = Date.now()) {
    if (socket.isObserver || socket.readyState !== 1) return;
    const aux = socket.clientInfo?.aux;
    const peers = aux == null ? [] : connections.filter(other => !sameDevice(other, socket) && !other.isObserver &&
        other.readyState === 1 && other.clientInfo?.aux === aux).map(other => ({
        id: String(other.clientInfo.id), nickname: other.clientInfo.username || null
    }));
    const presence = { aux, peers };
    const change = aux == null ? undefined : lastChanges.get(aux);
    if (change && now - change.at < RECENT_CHANGE_MS) {
        const self = change.clientId === socket.clientInfo.id || (!!change.deviceId && change.deviceId === socket.clientInfo.deviceId);
        presence.lastChange = { nickname: change.nickname, minutesAgo: Math.max(0, Math.floor((now - change.at) / 60000)), self };
    }
    try { socket.send(JSON.stringify({ presence })); } catch {}
}
function broadcastAuxPresence(connections, aux) {
    if (aux == null) return;
    for (const socket of connections) if (socket.clientInfo?.aux === aux) sendAuxPresence(socket, connections);
}
function clearAuxChanges() { lastChanges.clear(); }
module.exports = { sendAuxPresence, broadcastAuxPresence, recordAuxChange, clearAuxChanges, RECENT_CHANGE_MS };
