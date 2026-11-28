const test = require("node:test");
const assert = require("node:assert/strict");
const { readDeskLayout } = require("../lib/desk-layout.js");

const form = (channels, auxes) => ({
  auxEnabled: auxes.map(() => "true"), auxName: auxes, auxColour: auxes.map(() => "#336699"), auxIcon: auxes.map(() => ""),
  channelEnabled: channels.map((_, index) => String(index % 2 === 0)), channelName: channels,
  channelOrder: channels.map((_, index) => String(channels.length - index)), channelIcon: channels.map(() => "/images/icons/vocal.svg"),
  sectionTitle: channels.map(() => ""), channelColour: channels.map(() => "")
});

test("the desk settings form is read for desks of any size", () => {
  const channels = Array.from({ length: 256 }, (_, index) => "Ch " + (index + 1));
  const layout = readDeskLayout(form(channels, ["Drums", "Bass"]));
  assert.equal(layout.channels.length, 256);
  assert.deepEqual(layout.channels[0], { enabled: true, displayOrder: 256, title: "", colour: "", icon: "/images/icons/vocal.svg" });
  assert.equal(layout.channels[1].enabled, false);
  assert.deepEqual(layout.auxes[1], { enabled: true, colour: "#336699", icon: "" });
  assert.deepEqual(layout.auxNames, ["Drums", "Bass"]);
  assert.equal(layout.channelNames[255], "Ch 256");
});

test("forms without some fields keep what they leave out", () => {
  assert.deepEqual(readDeskLayout({}), {});
  // Forms from before channel colours keep each channel's saved colour.
  const old = form(["Kick", "Snare"], []);
  delete old.channelColour;
  const layout = readDeskLayout(old, [{ colour: "#e5484d" }, { colour: "not a colour" }]);
  assert.deepEqual(layout.channels.map(channel => channel.colour), ["#e5484d", ""]);
});

test("a malformed form is rejected as a whole", () => {
  const valid = form(["Kick", "Snare"], ["Drums"]);
  for (const change of [
    { auxEnabled: "true" },
    { auxColour: ["#336699", "#336699"] },
    { channelOrder: ["1"] },
    { sectionTitle: ["", ""], channelIcon: [{}, ""] },
    { channelName: ["Kick", 5] },
    { auxName: "Drums" },
    { channelName: ["Kick\nline"] },
    { channelName: ["x".repeat(600)] },
    { channelEnabled: Array(1025).fill("true") },
  ]) assert.equal(readDeskLayout({ ...valid, ...change }), null, JSON.stringify(change).slice(0, 60));
});
