"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readLinks, createLink, partnerOf, midpointLevel, visibleLinks } = require('../lib/channel-links');

test('linked channels meet halfway in dB, and a known level wins over an unknown one', () => {
  assert.equal(midpointLevel(-1, 1), 0);
  assert.equal(midpointLevel(-10, -20), -15);
  assert.equal(midpointLevel(-150, 0), -75);
  assert.equal(midpointLevel(undefined, -6), -6);
  assert.equal(midpointLevel(-3, null), -3);
  assert.equal(midpointLevel(undefined, undefined), null);
  assert.equal(midpointLevel(10, 10), 10);
});

test('saved links keep only valid pairs, and a channel belongs to one link', () => {
  const links = readLinks([
    { id: 'a1', name: '  Guitar   1 ', channels: [10, 11] },
    { id: 'a2', name: 'Reuses 11', channels: [11, 12] },
    { id: 'a3', name: 'Same twice', channels: [5, 5] },
    { id: 'a4', name: '', channels: [1, 2] },
    { id: 'a1', name: 'Duplicate id', channels: [20, 21] },
    { name: 'No id', channels: [30, 31] },
    { id: 'a5', name: 'Keys', channels: ['13', '14'] },
    'nonsense',
  ]);
  assert.deepEqual(links, [{ id: 'a1', name: 'Guitar 1', channels: [10, 11] }, { id: 'a5', name: 'Keys', channels: [13, 14] }]);
  assert.deepEqual(readLinks(undefined), []);
  assert.equal(partnerOf(links, 10), 11);
  assert.equal(partnerOf(links, 11), 10);
  assert.equal(partnerOf(links, 12), null);
});

test('a new link needs a name and two different, unlinked desk channels', () => {
  const existing = [{ id: 'a1', name: 'Guitar 1', channels: [10, 11] }];
  const desk = [1, 2, 3, 10, 11];
  assert.match(createLink(existing, { name: '', channels: [1, 2] }, desk).error, /name/);
  assert.match(createLink(existing, { name: 'x'.repeat(41), channels: [1, 2] }, desk).error, /40 characters/);
  assert.match(createLink(existing, { name: 'One', channels: [1] }, desk).error, /two channels/);
  assert.match(createLink(existing, { name: 'Same', channels: [2, 2] }, desk).error, /different/);
  assert.match(createLink(existing, { name: 'Missing', channels: [2, 99] }, desk).error, /doesn’t have/);
  assert.match(createLink(existing, { name: 'Taken', channels: [3, 11] }, desk).error, /Channel 11 is already linked/);
  const { link } = createLink(existing, { name: ' Keys ', channels: ['2', 3] }, desk);
  assert.equal(link.name, 'Keys');
  assert.deepEqual(link.channels, [2, 3]);
  assert.match(link.id, /^[a-f0-9-]{36}$/);
});

test('musicians are only sent links whose channels are both shown', () => {
  const links = [{ id: 'a1', name: 'Guitar 1', channels: [10, 11] }, { id: 'a2', name: 'Keys', channels: [13, 14] }];
  const channels = [{ channel: 10, enabled: true }, { channel: 11 }, { channel: 13, enabled: true }, { channel: 14, enabled: false }];
  assert.deepEqual(visibleLinks(links, channels), [{ name: 'Guitar 1', channels: [10, 11] }]);
});

// Load lib/server/links.js against stand-ins for the desk, phones and saved
// settings, so nothing is written to disk or sent to a real desk.
function loadLinks() {
  const root = path.join(__dirname, '..', 'lib');
  const cache = new Map(), sent = [], queried = [], saved = [];
  let closed = 0;
  const state = { currentState: { channels: [], auxes: [] }, cache };
  const stub = (file, exports) => { const id = path.join(root, file); require.cache[id] = { id, filename: id, loaded: true, exports }; };
  stub('server/state.js', { state });
  stub('config/configManager.js', { saveCurrentState: value => saved.push(structuredClone(value)) });
  stub('logging/logger.js', { info() {}, debug() {}, warn() {}, error() {} });
  stub('server/desk.js', { maybeCacheResponse: message => cache.set(message.address, message), broadcast: message => sent.push(message),
    queryQueue: { request: address => queried.push(address) } });
  stub('server/clients.js', { closeAllWebsocketConnections: () => { closed++; } });
  const file = path.join(root, 'server', 'links.js');
  delete require.cache[file];
  const links = require(file);
  const set = (address, value) => cache.set(address, { address, args: [value] });
  set('/Console/Input_Channels', 4);
  for (const channel of [1, 2, 3, 4]) set(`/Input_Channels/${channel}/Channel_Input/name`, 'Ch ' + channel);
  cache.set('/Console/Aux_Outputs/modes', { address: '/Console/Aux_Outputs/modes', args: [2, 2] });
  for (const aux of [1, 2]) set(`/Aux_Outputs/${aux}/Buss_Trim/name`, 'Mix ' + aux);
  return { links, state, cache, set, sent, queried, saved, closed: () => closed };
}
const level = (channel, aux) => `/Input_Channels/${channel}/Aux_Send/${aux}/send_level`;

test('linking sets both channels to the midpoint in every mix, waiting for levels it has not loaded', () => {
  const server = loadLinks();
  server.set(level(1, 1), -1); server.set(level(2, 1), 1);
  server.set(level(1, 2), -10);
  const result = server.links.create({ name: 'Guitar 1', channels: [1, 2] });
  assert.equal(result.link.name, 'Guitar 1');
  assert.deepEqual(result.link.labels, ['Ch 1', 'Ch 2']);
  assert.deepEqual(server.saved.at(-1).links.map(link => link.channels), [[1, 2]]);
  assert.equal(server.closed(), 1);
  // Mix 1 meets at 0 dB straight away; mix 2 asks the desk for channel 2.
  assert.deepEqual(server.sent.map(message => [message.address, message.args[0]]), [[level(1, 1), 0], [level(2, 1), 0]]);
  assert.deepEqual(server.queried, [level(2, 2)]);
  // When the desk answers, mix 2 meets in the middle too.
  server.set(level(2, 2), -20);
  server.links.onDeskValue({ address: level(2, 2), args: [-20] });
  assert.deepEqual(server.sent.slice(2).map(message => [message.address, message.args[0]]), [[level(1, 2), -15], [level(2, 2), -15]]);
  // A later value for the same mix doesn't move them again.
  server.links.onDeskValue({ address: level(2, 2), args: [-20] });
  assert.equal(server.sent.length, 4);
});

test('a musician moving one linked channel moves the other; pan stays separate', () => {
  const server = loadLinks();
  server.set(level(3, 1), -6); server.set(level(4, 1), -6);
  server.links.create({ name: 'Keys', channels: [3, 4] });
  server.sent.length = 0;
  server.links.mirror({ address: level(3, 1), args: [-2.5] });
  server.links.mirror({ address: '/Input_Channels/4/Aux_Send/1/send_on', args: [0] });
  server.links.mirror({ address: '/Input_Channels/3/Aux_Send/1/send_pan', args: [0] });
  server.links.mirror({ address: level(1, 1), args: [-4] });
  assert.deepEqual(server.sent.map(message => [message.address, message.args[0]]),
    [[level(4, 1), -2.5], ['/Input_Channels/3/Aux_Send/1/send_on', 0]]);
  // Unlinking stops the copying.
  assert.equal(server.links.remove(server.links.list()[0].id), true);
  assert.equal(server.links.remove('missing'), false);
  server.links.mirror({ address: level(3, 1), args: [-9] });
  assert.equal(server.sent.length, 2);
});
