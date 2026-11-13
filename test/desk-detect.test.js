"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { X32_PORT, X32_PROBE, identifyDesk, deskLabel } = require("../lib/desk-detect.js");

test("an X32 is identified from its /xinfo answer", () => {
  assert.equal(X32_PORT, 10023);
  assert.deepEqual(X32_PROBE, { address: "/xinfo", args: [] });
  const desk = identifyDesk({ address: "/xinfo", args: ["192.168.4.5", "My Mixer", "X32RACK", "4.06-8"] });
  assert.deepEqual(desk, { type: "x32", name: "My Mixer", model: "X32RACK", firmware: "4.06-8" });
  assert.equal(deskLabel(desk), "Behringer X32RACK");
  assert.equal(deskLabel(identifyDesk({ address: "/xinfo", args: ["10.0.0.2", "", "M32R", "4.06"] })), "Midas M32R");
});

test("a DiGiCo desk is identified from any /Console/ message", () => {
  assert.deepEqual(identifyDesk({ address: "/Console/Input_Channels", args: [48] }), { type: "digico" });
  assert.deepEqual(identifyDesk({ address: "/Console/Session/!", args: [] }), { type: "digico" });
  assert.equal(deskLabel({ type: "digico" }), "DiGiCo");
});

test("other messages and malformed answers identify nothing", () => {
  assert.equal(identifyDesk({ address: "/Input_Channels/1/Aux_Send/1/send_level", args: [-10] }), null);
  assert.equal(identifyDesk({ address: "/xinfo", args: [] }), null);
  assert.equal(identifyDesk({ address: "/xinfo", args: ["10.0.0.2", "Name", 5, "4.06"] }), null);
  assert.equal(identifyDesk(null), null);
  assert.equal(deskLabel(null), "");
});
