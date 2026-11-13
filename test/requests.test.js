"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRequest, createRequestBoard, createRequestLimit, MAX_TEXT } = require("../lib/requests");

test("requests need a known kind or some text, and text is tidied and capped", () => {
  assert.equal(parseRequest(null), null);
  assert.equal(parseRequest({ kind: "free-beer" }), null);
  assert.equal(parseRequest({ text: "   " }), null);
  assert.deepEqual(parseRequest({ kind: "more-click" }), { kind: "more-click", text: "" });
  assert.deepEqual(parseRequest({ kind: "nope", text: " vocals\n\tplease " }), { kind: null, text: "vocals please" });
  assert.equal(parseRequest({ text: "x".repeat(500) }).text.length, MAX_TEXT);
});

test("the board keeps the newest requests and records acknowledgement once", () => {
  let time = 1000;
  const board = createRequestBoard({ now: () => time, limit: 3 });
  for (let i = 0; i < 5; i++) board.add({ kind: "talk", text: "" }, { clientId: i, name: "Drums" });
  assert.deepEqual(board.list().map(item => item.clientId), [4, 3, 2]);
  const [newest] = board.list();
  assert.equal(newest.label, "Talk to me");
  time = 2000; assert.equal(board.acknowledge(newest.id).acknowledgedAt, 2000);
  time = 3000; assert.equal(board.acknowledge(newest.id).acknowledgedAt, 2000);
  assert.equal(board.acknowledge(999), null);
  board.clear(); assert.equal(board.list().length, 0);
});

test("requests are limited when sent too close together or too often", () => {
  let time = 0;
  const allow = createRequestLimit({ now: () => time, gap: 1500, perMinute: 3 });
  assert.equal(allow(), true);
  time = 1000; assert.equal(allow(), false);
  time = 2000; assert.equal(allow(), true);
  time = 4000; assert.equal(allow(), true);
  time = 6000; assert.equal(allow(), false);
  time = 61000; assert.equal(allow(), true);
});
