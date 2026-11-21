"use strict";

const { CHANNEL_COLOUR_VALUES } = require("./channel-colours");

// The native desk uses dB for levels and 0..1 for pan. The custom dashboard uses
// slider positions for levels and -1..1 (centre = 0) for pan.
function dbToSlider(db) {
  if (!Number.isFinite(db)) return null;
  if (db <= -150) return 0;
  return Math.max(0, Math.min(1, Math.pow(100, (db + 90) / 100) / 100));
}
function panToCentered(pan) {
  return Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan * 2 - 1)) : null;
}
function colourToRGB(colour) {
  const match = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(colour || "");
  return match ? match.slice(1).map(value => parseInt(value, 16)).join(", ") : "100, 116, 139";
}
// A saved channel colour is one of the palette's colours, or "" when none is chosen.
function channelColour(colour) {
  const value = typeof colour === "string" ? colour.toLowerCase() : "";
  return CHANNEL_COLOUR_VALUES.includes(value) ? value : "";
}
module.exports = { dbToSlider, panToCentered, colourToRGB, channelColour };
