"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSimulatedMeterSource, createMeterStream, METER_FLOOR } = require("../lib/meters");

test("simulated readings are bounded, marked simulated and stable per channel", () => {
  let time = 0;
  const a = createSimulatedMeterSource({ now: () => time }), b = createSimulatedMeterSource({ now: () => time });
  assert.equal(a.kind, "simulated");
  for (let step = 0; step < 600; step++, time += 66) {
    const readings = a.read([1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(readings, b.read([1, 2, 3, 4, 5, 6, 7, 8]));
    for (const [, db] of readings) assert.ok(db === null || (db >= METER_FLOOR && db <= 1), String(db));
  }
});

function socket(channels) {
  return { readyState: 1, bufferedAmount: 0, sent: [], mixConfig: { channels: channels.map(channel => ({ channel })) },
    send(data) { this.sent.push(JSON.parse(data)); } };
}

test("meters stream only to subscribed clients, for their visible channels, and stop with none", async () => {
  const listening = socket([1, 2]), quiet = socket([1]);
  const stream = createMeterStream({ source: createSimulatedMeterSource(), clients: () => [listening, quiet], rate: 50 });
  assert.equal(stream.kind(), "simulated");
  stream.subscribe(listening, true);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.ok(listening.sent.length >= 2);
  assert.equal(quiet.sent.length, 0);
  const message = listening.sent.at(-1).meters;
  assert.equal(message.kind, "simulated");
  assert.deepEqual(message.levels.map(([channel]) => channel), [1, 2]);
  stream.subscribe(listening, false);
  const count = listening.sent.length;
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(listening.sent.length, count);
});

test("a client that falls behind is skipped, and no source means no meters", async () => {
  const slow = socket([1]); slow.bufferedAmount = 1e6;
  const stream = createMeterStream({ source: createSimulatedMeterSource(), clients: () => [slow], rate: 50 });
  stream.subscribe(slow, true);
  await new Promise(resolve => setTimeout(resolve, 80));
  stream.stop();
  assert.equal(slow.sent.length, 0);
  const none = createMeterStream({ source: null, clients: () => [slow] });
  none.subscribe(slow, true);
  assert.equal(none.available(), false);
  assert.equal(slow.metersWanted, false);
});
