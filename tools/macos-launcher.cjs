"use strict";

// macOS entry point for the packaged server. The menu bar app starts this and
// sets OSC_WEBMIXER_HOME; running it by hand uses the same folder.
// Set writable paths before loading modules that capture their data directory.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = process.env.OSC_WEBMIXER_HOME ||
    path.join(os.homedir(), "Library", "Application Support", "EarsMixer");
fs.mkdirSync(root, { recursive: true });
process.env.OSC_WEBMIXER_CONFIG_DIR ||= path.join(root, "config");
process.env.OSC_WEBMIXER_DATA_DIR ||= path.join(root, "data");
process.chdir(root);
console.log("EarsMixer");
console.log("Settings and plugins: " + root);
require("../index.js");
