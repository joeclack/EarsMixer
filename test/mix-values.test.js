"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { dbToSlider, panToCentered, colourToRGB, channelColour } = require('../lib/mix-values');
const { QueryQueue } = require('../lib/query-queue');
const { CHANNEL_COLOURS, CHANNEL_COLOUR_VALUES, channelColourName } = require('../lib/channel-colours');

test('native dB and pan are displayed using the custom dashboard units', () => {
  assert.equal(dbToSlider(-150), 0);
  assert.equal(dbToSlider(-90), 0.01);
  assert.equal(dbToSlider(-40), 0.1);
  assert.equal(dbToSlider(10), 1);
  assert.equal(dbToSlider(undefined), null);
  assert.equal(panToCentered(0), -1);
  assert.equal(panToCentered(0.5), 0);
  assert.equal(panToCentered(1), 1);
  assert.equal(colourToRGB('#EF4444'), '239, 68, 68');
});

test('channel colours keep only palette colours and clear anything else', () => {
  assert.equal(channelColour('#E5484D'), '#e5484d');
  assert.equal(channelColour('#ff9592'), '#ff9592');
  assert.equal(channelColour('#ef4444'), '');
  assert.equal(channelColour(''), '');
  assert.equal(channelColour(undefined), '');
  assert.equal(channelColour('red'), '');
  assert.equal(channelColour('#e5484d"><script>'), '');
});

test('every palette colour has light, main and dark versions, plus white and black', () => {
  const lightness = hex => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
  assert(CHANNEL_COLOURS.length >= 8);
  for (const colour of CHANNEL_COLOURS) {
    for (const hex of [colour.light, colour.main, colour.dark]) assert.match(hex, /^#[0-9a-f]{6}$/);
    assert(lightness(colour.light) > lightness(colour.main), colour.name);
    assert(lightness(colour.dark) < lightness(colour.main), colour.name);
  }
  assert.equal(channelColour('#FFFFFF'), '#ffffff');
  assert.equal(channelColour('#000000'), '#000000');
  assert.equal(channelColour('#b3262b'), '#b3262b');
  assert.equal(channelColourName('#b3262b'), 'Dark red');
  assert.equal(channelColourName('#ff9592'), 'Light red');
  assert.equal(channelColourName('#000000'), 'Black');
  assert.equal(new Set(CHANNEL_COLOUR_VALUES).size, CHANNEL_COLOUR_VALUES.length);
});

test('duplicate queries share one request and missing replies do not block other channels', async () => {
  const sent = [];
  const queue = new QueryQueue(msg => sent.push(msg.address), { delay: 1, timeout: 15, attempts: 2 });
  try {
    queue.request('/missing'); queue.request('/missing'); queue.request('/working');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(sent, ['/missing/?', '/working/?']);
    queue.received('/working');
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(sent.filter(address => address === '/missing/?').length, 2);
    assert.equal(queue.pending.size, 0);
  } finally { queue.clear(); }
});

test('active mix requests are promoted ahead of background cache queries', async () => {
  const sent = [];
  const queue = new QueryQueue(msg => sent.push(msg.address), { delay: 1, timeout: 1000 });
  try {
    queue.request('/first'); queue.request('/background'); queue.request('/selected');
    queue.request('/selected', true);
    queue.received('/first');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(sent, ['/first/?', '/selected/?']);
    queue.received('/selected');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(sent, ['/first/?', '/selected/?', '/background/?']);
  } finally { queue.clear(); }
});
