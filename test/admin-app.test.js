"use strict";
// Logic shared by the Preact admin dashboard (admin/src), tested without a browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const load = name => import("../admin/src/" + name);

test("levels, pan and streamed desk values are shown the way the dashboard expects", async () => {
  const { levelText, panText, parseLiveUpdate, ago } = await load("format.mjs");
  assert.deepEqual([levelText(0), levelText(0.624), levelText(1.4), levelText(null)], ["off", "62", "100", "—"]);
  assert.deepEqual([panText(0), panText(-0.12), panText(0.3), panText(undefined)], ["C", "L12", "R30", ""]);
  assert.deepEqual(parseLiveUpdate({ address: "/Input_Channels/3/Aux_Send/2/send_level", args: [-150] }), { channel: 3, aux: 2, field: "level", value: 0 });
  assert.equal(parseLiveUpdate({ address: "/Input_Channels/3/Aux_Send/2/send_pan", args: [0.5] }).value, 0);
  assert.equal(parseLiveUpdate({ address: "/Input_Channels/3/Aux_Send/2/send_level", args: [10] }).value, 1);
  assert.equal(parseLiveUpdate({ address: "/Snapshots/name", args: ["x"] }), null);
  assert.deepEqual([ago(1000, 3000), ago(1000, 31000), ago(1000, 601000), ago(0)], ["now", "30 s ago", "10 min ago", "never"]);
});

test("a run of changes to one control becomes one log line, newest first", async () => {
  const { coalesceLog, changeText } = await load("format.mjs");
  const entry = (at, channel, value, previousValue) => ({ client: 1, at, type: "level", aux: 1, channel, channelLabel: "Ch" + channel, value, previousValue });
  const log = coalesceLog([entry(1, 1, 0.5, 0.4), entry(2, 1, 0.6, 0.5), entry(3, 2, 0.2, 0.2), { client: 1, at: 4, type: "aux", aux: 2, auxLabel: "Bass" }]);
  assert.deepEqual(log.map(changeText), ["Opened Bass", "Ch2 20", "Ch1 40 → 60"]);
  assert.equal(log[2].at, 2);
});

test("the template channel list keeps groups together and reorders within them", async () => {
  const { buildItems, flatten, move, upgrade } = await load("templates-model.mjs");
  const groups = [{ id: 1, name: "Kit", members: [1, 2, 3] }, { id: 2, name: "Guitars", members: [6, 5] }];
  const items = buildItems([1, 4, 2, 5, 3, 6, 7], groups);
  assert.deepEqual(items.map(item => item.group ? item.group.name + ":" + item.members : item.channel), ["Kit:1,2,3", 4, "Guitars:5,6", 7]);
  // Moving a group moves its channels together; moving inside a group stays inside it.
  assert.deepEqual(flatten(move(items, 0, 2)), [4, 5, 6, 1, 2, 3, 7]);
  assert.deepEqual(flatten(items.map(item => item.group?.id === 1 ? { ...item, members: move(item.members, 0, 2) } : item)), [2, 3, 1, 4, 5, 6, 7]);
  // A template that only showed favourites keeps the same channels visible.
  const old = upgrade({ selectedAux: 4, channelOrder: [], favouritesByAux: { "4": { enabled: true, channels: [2] }, "5": { enabled: false, channels: [1] } }, view: "grid" }, [{ channel: 1 }, { channel: 2 }, { channel: 3 }]);
  assert.deepEqual(old.hiddenByAux, { "4": [1, 3] });
  assert.deepEqual([old.favouritesByAux, old.view, old.globalGroups], [{}, "list", []]);
});
