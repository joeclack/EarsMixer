"use strict";

// Working out which kind of desk is at the configured address. A DiGiCo desk
// answers /Console/Channels/? on its configured port. A Behringer X32 or Midas
// M32 answers /xinfo on port 10023, replying to the port the question came from.
const X32_PORT = 10023;
const X32_PROBE = { address: "/xinfo", args: [] };

/**
 * Identify the desk from one of its messages.
 * @param {{address: string, args?: any[]}} msg
 * @returns {{type: 'digico'}|{type: 'x32', name: string, model: string, firmware: string}|null}
 */
function identifyDesk(msg) {
  if (!msg || typeof msg.address !== "string") return null;
  if (msg.address === "/xinfo") {
    // /xinfo answers with: IP address, console name, model, firmware version.
    const [, name, model, firmware] = (msg.args || []).map(value => typeof value === "string" ? value : "");
    if (!model) return null;
    return { type: "x32", name: name || "", model, firmware: firmware || "" };
  }
  if (msg.address.startsWith("/Console/")) return { type: "digico" };
  return null;
}

/** A short name for the detected desk, for logs and the dashboard. */
function deskLabel(desk) {
  if (!desk) return "";
  if (desk.type === "digico") return "DiGiCo";
  return (/^M32/i.test(desk.model) ? "Midas " : "Behringer ") + desk.model;
}

module.exports = { X32_PORT, X32_PROBE, identifyDesk, deskLabel };
