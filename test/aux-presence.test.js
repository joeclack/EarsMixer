"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendAuxPresence, broadcastAuxPresence } = require('../lib/aux-presence');

function client(id, aux, username, extra = {}) {
  const messages = [];
  return { readyState: 1, clientInfo: { id, aux, username, address: 'private address', log: ['private history'] }, messages,
    send: raw => messages.push(JSON.parse(raw)), ...extra };
}
test('presence is AUX scoped, excludes self/observers/closed sockets and sends only IDs and nicknames', () => {
  const a = client(1, 2, 'Joe'), b = client(2, 2, 'Drummer'), other = client(3, 1, 'Singer');
  const observer = client(4, 2, 'Admin', { isObserver: true }), closed = client(5, 2, 'Left', { readyState: 3 });
  const sockets = [a, b, other, observer, closed];
  broadcastAuxPresence(sockets, 2);
  assert.deepEqual(a.messages, [{ presence: { aux: 2, peers: [{ id: '2', nickname: 'Drummer' }] } }]);
  assert.deepEqual(b.messages[0].presence.peers, [{ id: '1', nickname: 'Joe' }]);
  assert.equal(observer.messages.length, 0); assert.equal(other.messages.length, 0); assert.equal(closed.messages.length, 0);
  b.clientInfo.username = null;
  broadcastAuxPresence(sockets, 2);
  assert.equal(a.messages.at(-1).presence.peers[0].nickname, null);
  b.clientInfo.aux = 1;
  broadcastAuxPresence(sockets, 2); broadcastAuxPresence(sockets, 1);
  assert.deepEqual(a.messages.at(-1).presence.peers, []);
  assert.deepEqual(other.messages.at(-1).presence.peers, [{ id: '2', nickname: null }]);
  sendAuxPresence(a, []);
  assert.deepEqual(a.messages.at(-1).presence.peers, []);
});

test('a phone joining a mix hears who changed it in the last two hours, and never counts its own device', () => {
  const { recordAuxChange, clearAuxChanges, RECENT_CHANGE_MS } = require('../lib/aux-presence');
  clearAuxChanges();
  const now = Date.now();
  const joe = client(1, 2, 'Joe', {}); joe.clientInfo.deviceId = 'joe-phone';
  const joeAgain = client(5, 2, 'Joe', {}); joeAgain.clientInfo.deviceId = 'joe-phone';
  const drummer = client(2, 2, 'Drummer'); drummer.clientInfo.deviceId = 'drum-phone';
  // Another connection from Joe's own phone is not someone else on the mix.
  sendAuxPresence(joe, [joe, joeAgain], now);
  assert.deepEqual(joe.messages.at(-1), { presence: { aux: 2, peers: [] } });
  recordAuxChange(drummer, 2, now - 25 * 60000);
  sendAuxPresence(joe, [joe], now);
  assert.deepEqual(joe.messages.at(-1).presence.lastChange, { nickname: 'Drummer', minutesAgo: 25, self: false });
  // The drummer's own change, seen from a new connection on the same phone, is theirs.
  const drummerAgain = client(6, 2, 'Drummer'); drummerAgain.clientInfo.deviceId = 'drum-phone';
  sendAuxPresence(drummerAgain, [drummerAgain], now);
  assert.equal(drummerAgain.messages.at(-1).presence.lastChange.self, true);
  // Older than two hours, or on another mix, it is not mentioned.
  sendAuxPresence(joe, [joe], now - 25 * 60000 + RECENT_CHANGE_MS);
  assert.equal('lastChange' in joe.messages.at(-1).presence, false);
  const other = client(3, 4, 'Keys');
  sendAuxPresence(other, [other], now);
  assert.equal('lastChange' in other.messages.at(-1).presence, false);
  clearAuxChanges();
});
