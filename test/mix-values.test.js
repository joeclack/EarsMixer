"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { dbToSlider, panToCentered, colourToRGB } = require('../lib/mix-values');
const { QueryQueue } = require('../lib/query-queue');

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
