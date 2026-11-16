"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMeterStream } = require("../lib/meters");

const source = {
  kind: "desk",
  read(channels) { return channels.map(channel => [channel, -12]); },
};

function socket(channels) {
  return { readyState: 1, bufferedAmount: 0, sent: [], mixConfig: { channels: channels.map(channel => ({ channel })) },
    send(data) { this.sent.push(JSON.parse(data)); } };
}

test("meters stream only to subscribed clients, for their visible channels, and stop with none", async () => {
  const listening = socket([1, 2]), quiet = socket([1]);
  const stream = createMeterStream({ source, clients: () => [listening, quiet], rate: 50 });
  assert.equal(stream.kind(), "desk");
  stream.subscribe(listening, true);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.ok(listening.sent.length >= 2);
  assert.equal(quiet.sent.length, 0);
  const message = listening.sent.at(-1).meters;
  assert.equal(message.kind, "desk");
  assert.deepEqual(message.levels, [[1, -12], [2, -12]]);
  stream.subscribe(listening, false);
  const count = listening.sent.length;
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(listening.sent.length, count);
});

test("a client that falls behind is skipped, and no source means no meters", async () => {
  const slow = socket([1]); slow.bufferedAmount = 1e6;
  const stream = createMeterStream({ source, clients: () => [slow], rate: 50 });
  stream.subscribe(slow, true);
  await new Promise(resolve => setTimeout(resolve, 80));
  stream.stop();
  assert.equal(slow.sent.length, 0);
  const none = createMeterStream({ source: null, clients: () => [slow] });
  none.subscribe(slow, true);
  assert.equal(none.available(), false);
  assert.equal(slow.metersWanted, false);
});
