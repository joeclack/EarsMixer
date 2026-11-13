"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const x32 = require("../lib/x32.js");

test("fader positions convert to dB and back along the X32 fader law", () => {
  for (const [fader, db] of [[1, 10], [0.75, 0], [0.5, -10], [0.25, -30], [0.0625, -60], [0, -150]]) assert.equal(x32.faderToDb(fader), db);
  for (const [db, fader] of [[10, 1], [20, 1], [0, 0.75], [-10, 0.5], [-30, 0.25], [-60, 0.0625], [-90, 0], [-150, 0]]) assert.equal(x32.dbToFader(db), fader);
  for (const db of [-75, -45.5, -20, -12.3, -3, 4.5]) assert.ok(Math.abs(x32.faderToDb(x32.dbToFader(db)) - db) < 0.051);
});

test("musician messages are translated to X32 addresses", () => {
  const level = (channel, aux) => `/Input_Channels/${channel}/Aux_Send/${aux}/send_level`;
  assert.deepEqual(x32.toDesk({ address: level(1, 3), args: [0] }), { address: "/ch/01/mix/03/level", args: [0.75] });
  assert.deepEqual(x32.toDesk({ address: level(32, 16), args: [-150] }), { address: "/ch/32/mix/16/level", args: [0] });
  assert.deepEqual(x32.toDesk({ address: level(33, 1) + "/?", args: [] }), { address: "/auxin/01/mix/01/level", args: [] });
  assert.deepEqual(x32.toDesk({ address: "/Input_Channels/40/Aux_Send/5/send_pan", args: [0.25] }), { address: "/auxin/08/mix/05/pan", args: [0.25] });
  // Pan sits on the odd bus of a pair; channels and buses outside the desk have no address.
  assert.equal(x32.toDesk({ address: "/Input_Channels/1/Aux_Send/4/send_pan", args: [0.5] }), null);
  assert.equal(x32.toDesk({ address: level(41, 1), args: [0] }), null);
  assert.equal(x32.toDesk({ address: level(1, 17), args: [0] }), null);
  assert.equal(x32.toDesk({ address: level(1, 1), args: ["loud"] }), null);
});

test("names, scenes and unknown messages", () => {
  assert.deepEqual(x32.toDesk({ address: "/Input_Channels/2/Channel_Input/name/?", args: [] }), { address: "/ch/02/config/name", args: [] });
  assert.deepEqual(x32.toDesk({ address: "/Aux_Outputs/12/Buss_Trim/name", args: ["A name longer than twelve"] }), { address: "/bus/12/config/name", args: ["A name longe"] });
  assert.deepEqual(x32.toDesk({ address: "/Snapshots/Current_Snapshot/?", args: [] }), { address: "/-show/prepos/current", args: [] });
  assert.deepEqual(x32.toDesk({ address: "/Snapshots/names/?", args: [] }, 7), { address: "/-show/showfile/scene/007/name", args: [] });
  assert.equal(x32.toDesk({ address: "/Snapshots/names/?", args: [] }, -1), null);
  assert.equal(x32.toDesk({ address: "/SnapshotName", args: ["x"] }), null);
  assert.equal(x32.toDesk({ address: "/Console/Channels/?", args: [] }), null);
});

test("desk messages are translated to the messages the mixers use", () => {
  assert.deepEqual(x32.fromDesk({ address: "/ch/05/mix/02/level", args: [0.5] }), { address: "/Input_Channels/5/Aux_Send/2/send_level", args: [-10] });
  assert.deepEqual(x32.fromDesk({ address: "/auxin/02/mix/07/pan", args: [1] }), { address: "/Input_Channels/34/Aux_Send/7/send_pan", args: [1] });
  assert.deepEqual(x32.fromDesk({ address: "/ch/05/config/name", args: ["Kick"] }), { address: "/Input_Channels/5/Channel_Input/name", args: ["Kick"] });
  assert.deepEqual(x32.fromDesk({ address: "/ch/05/config/name", args: [""] }), { address: "/Input_Channels/5/Channel_Input/name", args: ["Ch 5"] });
  assert.deepEqual(x32.fromDesk({ address: "/auxin/03/config/name", args: [""] }), { address: "/Input_Channels/35/Channel_Input/name", args: ["Aux 3"] });
  assert.deepEqual(x32.fromDesk({ address: "/bus/09/config/name", args: [""] }), { address: "/Aux_Outputs/9/Buss_Trim/name", args: ["Bus 9"] });
  assert.deepEqual(x32.fromDesk({ address: "/-show/prepos/current", args: [4] }), { address: "/Snapshots/Current_Snapshot", args: [4] });
  assert.deepEqual(x32.fromDesk({ address: "/-show/showfile/scene/004/name", args: ["Service"] }), { address: "/Snapshots/name", args: [4, "Service"] });
  for (const address of ["/ch/01/mix/fader", "/ch/33/mix/01/level", "/ch/01/mix/17/level", "/bus/17/config/name", "/meters/1"]) assert.equal(x32.fromDesk({ address, args: [0.5] }), null);
});

test("every send the mixers can address survives a round trip", () => {
  for (const channel of [1, 32, 33, 40]) for (const aux of [1, 16]) {
    const address = `/Input_Channels/${channel}/Aux_Send/${aux}/send_level`;
    assert.deepEqual(x32.fromDesk(x32.toDesk({ address, args: [-10] })), { address, args: [-10] });
  }
});

test("linked bus pairs become one stereo mix", () => {
  const links = new Map();
  assert.equal(x32.missingLink(links), "/config/buslink/1-2");
  assert.deepEqual(x32.linkPair({ address: "/config/buslink/3-4", args: [1] }), { pair: 1, linked: true });
  assert.deepEqual(x32.linkPair({ address: "/config/buslink/15-16", args: [0] }), { pair: 7, linked: false });
  for (const address of ["/config/buslink/2-3", "/config/buslink/17-18", "/config/chlink/1-2"]) assert.equal(x32.linkPair({ address, args: [1] }), null);
  for (let pair = 0; pair < 8; pair++) links.set(pair, pair === 1);
  assert.equal(x32.missingLink(links), null);
  assert.deepEqual(x32.busModes(links), [1, 1, 2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
});
