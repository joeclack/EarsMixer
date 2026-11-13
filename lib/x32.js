"use strict";

// Behringer X32 / Midas M32 mode. The rest of the server, the browser mixer and
// the phone app use DiGiCo-style messages (dB levels, /Input_Channels/...).
// This module translates between those and the X32's own OSC messages, so the
// two desk types differ only where the server talks to the desk.
//
// How an X32 appears to musicians:
//   channels 1-32   input channels          /ch/01 ... /ch/32
//   channels 33-40  aux inputs 1-8          /auxin/01 ... /auxin/08
//   AUX mixes 1-16  mix buses               /bus/01 ... /bus/16
// A linked bus pair is one stereo mix on its odd bus; the even bus is not offered.
// Scenes take the place of DiGiCo snapshots.
const CHANNELS = 32, AUX_INS = 8, BUSES = 16;
const INPUT_COUNT = CHANNELS + AUX_INS;
const SCENE_ADDRESS = "/-show/prepos/current";
/** The desk stops sending changes unless it hears /xremote at least every 10 seconds. */
const KEEP_ALIVE = { address: "/xremote", args: [] };
const KEEP_ALIVE_INTERVAL = 8000;

const pad = (number, length = 2) => String(number).padStart(length, "0");
const clamp = value => Math.max(0, Math.min(1, value));

/** X32 fader position (0..1) to dB. The fader law is four straight segments. */
function faderToDb(fader) {
  if (!Number.isFinite(fader) || fader <= 0) return -150;
  const f = Math.min(1, fader);
  const db = f >= 0.5 ? f * 40 - 30 : f >= 0.25 ? f * 80 - 50 : f >= 0.0625 ? f * 160 - 70 : f * 480 - 90;
  return Math.round(db * 10) / 10;
}
/** dB to X32 fader position (0..1). -90 dB and below is off. */
function dbToFader(db) {
  if (!Number.isFinite(db) || db <= -90) return 0;
  if (db >= 10) return 1;
  return db < -60 ? (db + 90) / 480 : db < -30 ? (db + 70) / 160 : db < -10 ? (db + 50) / 80 : (db + 30) / 40;
}

/** The X32 address prefix for a musician-facing channel number, or null. */
function inputPrefix(channel) {
  if (!Number.isInteger(channel) || channel < 1 || channel > INPUT_COUNT) return null;
  return channel <= CHANNELS ? "/ch/" + pad(channel) : "/auxin/" + pad(channel - CHANNELS);
}
const defaultName = (kind, number) => (kind === "ch" ? "Ch " : kind === "auxin" ? "Aux " : "Bus ") + number;

/**
 * Translate a DiGiCo-style message into the X32 message to send to the desk.
 * Queries end in /? on DiGiCo; on the X32 a query is the address with no arguments.
 * @param {{address: string, args?: any[]}} msg
 * @param {number} scene - the current scene index, for the scene name query
 * @returns {{address: string, args: any[]}|null} null when the X32 has no equivalent
 */
function toDesk(msg, scene = -1) {
  if (!msg || typeof msg.address !== "string") return null;
  const query = msg.address.endsWith("/?");
  const address = query ? msg.address.slice(0, -2) : msg.address;
  const args = query ? [] : msg.args || [];
  let match;
  if ((match = /^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)$/.exec(address))) {
    const prefix = inputPrefix(Number(match[1])), bus = Number(match[2]);
    // Pan belongs to the odd bus of a linked pair.
    if (!prefix || bus < 1 || bus > BUSES || (match[3] === "pan" && bus % 2 === 0)) return null;
    const target = prefix + "/mix/" + pad(bus) + "/" + match[3];
    if (!args.length) return { address: target, args: [] };
    if (!Number.isFinite(args[0])) return null;
    return { address: target, args: [match[3] === "level" ? dbToFader(args[0]) : clamp(args[0])] };
  }
  if ((match = /^\/Input_Channels\/(\d+)\/Channel_Input\/name$/.exec(address)) || (match = /^\/Aux_Outputs\/(\d+)\/Buss_Trim\/name$/.exec(address))) {
    const number = Number(match[1]);
    const prefix = address.startsWith("/Aux_Outputs/") ? (number >= 1 && number <= BUSES ? "/bus/" + pad(number) : null) : inputPrefix(number);
    if (!prefix) return null;
    // Names on the desk hold 12 characters.
    return { address: prefix + "/config/name", args: args.length ? [String(args[0]).slice(0, 12)] : [] };
  }
  if (query && address === "/Snapshots/Current_Snapshot") return { address: SCENE_ADDRESS, args: [] };
  if (query && address === "/Snapshots/names") {
    return Number.isInteger(scene) && scene >= 0 && scene <= 999 ? { address: "/-show/showfile/scene/" + pad(scene, 3) + "/name", args: [] } : null;
  }
  return null;
}

/**
 * Translate a message from the X32 into the DiGiCo-style message the rest of
 * the server works with.
 * @returns {{address: string, args: any[]}|null} null for messages EarsMixer does not use
 */
function fromDesk(msg) {
  if (!msg || typeof msg.address !== "string") return null;
  const value = (msg.args || [])[0];
  let match;
  if ((match = /^\/(ch|auxin)\/(\d\d)\/mix\/(\d\d)\/(level|pan)$/.exec(msg.address))) {
    const number = Number(match[2]), bus = Number(match[3]);
    const channel = match[1] === "ch" ? number : CHANNELS + number;
    if (number < 1 || number > (match[1] === "ch" ? CHANNELS : AUX_INS) || bus < 1 || bus > BUSES || !Number.isFinite(value)) return null;
    return { address: "/Input_Channels/" + channel + "/Aux_Send/" + bus + "/send_" + match[4], args: [match[4] === "level" ? faderToDb(value) : clamp(value)] };
  }
  if ((match = /^\/(ch|auxin|bus)\/(\d\d)\/config\/name$/.exec(msg.address))) {
    const number = Number(match[2]);
    if (number < 1 || number > (match[1] === "ch" ? CHANNELS : match[1] === "auxin" ? AUX_INS : BUSES) || typeof value !== "string") return null;
    const name = value.trim() || defaultName(match[1], number);
    if (match[1] === "bus") return { address: "/Aux_Outputs/" + number + "/Buss_Trim/name", args: [name] };
    return { address: "/Input_Channels/" + (match[1] === "ch" ? number : CHANNELS + number) + "/Channel_Input/name", args: [name] };
  }
  if (msg.address === SCENE_ADDRESS && Number.isInteger(value)) return { address: "/Snapshots/Current_Snapshot", args: [value] };
  if ((match = /^\/-show\/showfile\/scene\/(\d{3})\/name$/.exec(msg.address)) && typeof value === "string") {
    return { address: "/Snapshots/name", args: [Number(match[1]), value] };
  }
  return null;
}

/** The address that reports whether a bus pair is linked. Pair 0 is buses 1-2. */
const linkAddress = pair => "/config/buslink/" + (pair * 2 + 1) + "-" + (pair * 2 + 2);
/** Read a bus link message: which pair, and whether it is linked. */
function linkPair(msg) {
  const match = /^\/config\/buslink\/(\d+)-(\d+)$/.exec(msg?.address || "");
  if (!match) return null;
  const first = Number(match[1]), value = (msg.args || [])[0];
  if (first % 2 !== 1 || first > BUSES || Number(match[2]) !== first + 1 || !Number.isFinite(value)) return null;
  return { pair: (first - 1) / 2, linked: value !== 0 };
}
/** The address of the first bus pair whose link state is not known yet, or null. */
function missingLink(links) {
  for (let pair = 0; pair < BUSES / 2; pair++) if (!links.has(pair)) return linkAddress(pair);
  return null;
}
/**
 * The DiGiCo-style AUX modes for the 16 buses: 1 mono, 2 stereo, and 0 for the
 * even bus of a linked pair, which is not offered as a mix of its own.
 */
function busModes(links) {
  return Array.from({ length: BUSES }, (_, index) => !links.get(Math.floor(index / 2)) ? 1 : index % 2 === 0 ? 2 : 0);
}

module.exports = { CHANNELS, AUX_INS, BUSES, INPUT_COUNT, KEEP_ALIVE, KEEP_ALIVE_INTERVAL, faderToDb, dbToFader, toDesk, fromDesk, linkAddress, linkPair, missingLink, busModes };
