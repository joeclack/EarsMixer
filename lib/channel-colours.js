"use strict";

// The colours a channel can be given: each main colour with a lighter and a
// darker version, plus white and black. The admin page offers only these, and
// the server keeps only these, so every desk shows the same set.
const CHANNEL_COLOURS = [
  { name: "Red", light: "#ff9592", main: "#e5484d", dark: "#b3262b" },
  { name: "Orange", light: "#ffa366", main: "#f76b15", dark: "#c2500a" },
  { name: "Yellow", light: "#ffe58a", main: "#f5c518", dark: "#b88a00" },
  { name: "Green", light: "#7fdba6", main: "#30a46c", dark: "#1d7a4c" },
  { name: "Teal", light: "#6fd8c8", main: "#12a594", dark: "#0b7a6d" },
  { name: "Blue", light: "#80c4ff", main: "#0090ff", dark: "#0063b8" },
  { name: "Purple", light: "#c49bf0", main: "#8e4ec6", dark: "#6a3399" },
  { name: "Pink", light: "#f59bcf", main: "#d6409f", dark: "#a02a76" },
  { name: "Grey", light: "#c4c7cf", main: "#80838d", dark: "#50535b" },
];
const CHANNEL_NEUTRALS = [{ name: "White", value: "#ffffff" }, { name: "Black", value: "#000000" }];

const CHANNEL_COLOUR_VALUES = [
  ...CHANNEL_COLOURS.flatMap(colour => [colour.light, colour.main, colour.dark]),
  ...CHANNEL_NEUTRALS.map(colour => colour.value),
];

// The name an admin sees for a palette value, such as "Light red" or "Black".
function channelColourName(value) {
  const neutral = CHANNEL_NEUTRALS.find(colour => colour.value === value);
  if (neutral) return neutral.name;
  const colour = CHANNEL_COLOURS.find(entry => [entry.light, entry.main, entry.dark].includes(value));
  if (!colour) return "";
  return value === colour.main ? colour.name : (value === colour.light ? "Light " : "Dark ") + colour.name.toLowerCase();
}

module.exports = { CHANNEL_COLOURS, CHANNEL_NEUTRALS, CHANNEL_COLOUR_VALUES, channelColourName };
