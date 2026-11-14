"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeUntaggedMeter, detectScale, toDb, createDeskMeterSource, meterAddress } = require("../lib/desk-meters");
const { createMeterStream } = require("../lib/meters");

function untagged(address, values) {
  const name = Buffer.alloc((Buffer.byteLength(address) + 4) & ~3);
  name.write(address, "ascii");
  const data = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => data.writeFloatBE(value, index * 4));
  return Buffer.concat([name, data]);
}

test("untagged DiGiCo meter replies decode; tagged and other packets do not", () => {
  const packet = untagged("/Input_Channels/5/Channel_Input/post_meter/left", [0.25]);
  const meter = decodeUntaggedMeter(packet);
  assert.equal(meter.address, "/Input_Channels/5/Channel_Input/post_meter/left");
  assert.ok(Math.abs(meter.args[0] - 0.25) < 1e-6);
  const tagged = Buffer.concat([untagged("/Input_Channels/5/Channel_Input/post_meter/left", []), Buffer.from(",f\0\0"), Buffer.alloc(4)]);
  assert.equal(decodeUntaggedMeter(tagged), null);
  assert.equal(decodeUntaggedMeter(untagged("/Input_Channels/5/Aux_Send/1/send_level", [-12])), null);
  assert.equal(decodeUntaggedMeter(Buffer.from("junk")), null);
});

test("the scale is worked out from the values seen, and unknown scales show nothing", () => {
  assert.equal(detectScale(-80, -3), "db");
  assert.equal(detectScale(0, 0.9), "linear");
  assert.equal(detectScale(0, 255), "unknown");
  assert.equal(toDb(-12, "db"), -12);
  assert.equal(toDb(0.5, "linear"), -6);
  assert.equal(toDb(0, "linear"), null);
  assert.equal(toDb(0.5, "unknown"), null);
});

test("the source queries only what it is asked for, and stale readings read as no signal", () => {
  let time = 0;
  const sent = [];
  const source = createDeskMeterSource({ query: address => sent.push(address), now: () => time });
  source.poll([1, 2]);
  assert.deepEqual(sent, [meterAddress(1), meterAddress(2)]);
  assert.equal(source.receive({ address: meterAddress(1), args: [0.5] }), true);
  assert.equal(source.receive({ address: meterAddress(2), args: [{ type: "f", value: 0.1 }] }), true);
  assert.equal(source.receive({ address: "/Input_Channels/1/Aux_Send/1/send_level", args: [-3] }), false);
  assert.deepEqual(source.read([1, 2, 3]), [[1, -6], [2, -20], [3, null]]);
  time = 1000;
  assert.deepEqual(source.read([1]), [[1, null]]);
  const stats = source.stats();
  assert.equal(stats.replies, 2); assert.equal(stats.scale, "linear"); assert.equal(stats.rawMax, 0.5);
});

test("the stream polls the desk once per tick for every channel a listener can see", async () => {
  const polled = [];
  const source = { kind: "live", poll: channels => polled.push(channels), read: channels => channels.map(channel => [channel, null]) };
  const a = { readyState: 1, bufferedAmount: 0, mixConfig: { channels: [{ channel: 1 }, { channel: 2 }] }, send() {} };
  const b = { readyState: 1, bufferedAmount: 0, mixConfig: { channels: [{ channel: 2 }, { channel: 3 }] }, send() {} };
  const stream = createMeterStream({ source, clients: () => [a, b], rate: 50 });
  stream.subscribe(a, true); stream.subscribe(b, true);
  await new Promise(resolve => setTimeout(resolve, 70));
  stream.stop();
  assert.ok(polled.length >= 1);
  assert.deepEqual(polled[0].sort(), [1, 2, 3]);
  assert.equal(stream.receive({ address: "/x", args: [] }), false);
});
