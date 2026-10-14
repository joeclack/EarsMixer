"use strict";

// Set writable paths before loading modules that capture their data directory.
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.OSC_WEBMIXER_HOME || path.join(process.env.LOCALAPPDATA || require("node:os").homedir(), "EarsMixer");
fs.mkdirSync(root, { recursive: true });
process.env.OSC_WEBMIXER_CONFIG_DIR ||= path.join(root, "config");
process.env.OSC_WEBMIXER_DATA_DIR ||= path.join(root, "data");
process.chdir(root);
console.log("EarsMixer");
console.log("Settings and plugins: " + root);
console.log("Open http://localhost/admin (include the port if you change it in Desk settings).");
if (!process.env.OSC_WEBMIXER_SERVICE) console.log("Keep this window open while using the mixer. Press Ctrl+C to stop.\n");
require("../index.js");
