"use strict";

// Run the real v2 server against a mock on loopback, with its own saved settings.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const configDirectory = process.env.OSC_WEBMIXER_DEV_CONFIG_DIR || path.join(root, "config", "demo");
function port(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a port between 1 and 65535.`);
  return value;
}
const webPort = port("OSC_WEBMIXER_DEV_WEB_PORT", 8082);
const oscPort = port("OSC_WEBMIXER_DEV_OSC_PORT", 8012);
const deskPort = port("OSC_WEBMIXER_DEV_DESK_PORT", 9012);
if (oscPort === deskPort) throw new Error("The mock desk and server need different UDP ports.");
const bindAddress = process.env.OSC_WEBMIXER_DEV_BIND_ADDRESS || '127.0.0.1';
const url = process.env.OSC_WEBMIXER_PUBLIC_URL || `http://127.0.0.1:${webPort}`;

fs.mkdirSync(configDirectory, { recursive: true });
fs.writeFileSync(path.join(configDirectory, "global.json"), JSON.stringify({
  debug: false,
  server: { port: webPort },
  osc: { port: oscPort },
  desk: { ip: "127.0.0.1", port: deskPort },
  externalDevices: []
}, null, 2) + "\n");

const children = new Set();
let stopping = false;
let serverStarted = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  clearTimeout(startupTimeout);
  for (const child of children) child.kill();
}
function launch(script, args, options = {}) {
  const child = spawn(process.execPath, [script, ...args], { cwd: root, ...options });
  children.add(child);
  child.once("error", error => { console.error(error.message); stop(1); });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${script} stopped (${signal || code}). Stopping demo.`);
      stop(code || 1);
    }
  });
  return child;
}
const startupTimeout = setTimeout(() => {
  console.error("The mock desk did not start within 10 seconds.");
  stop(1);
}, 10000);

console.log(`Demo mixer: ${url}\nAdmin: ${url}/admin\n20 channels / 8 AUXes. Ctrl+C stops both processes.`);
const mock = launch("tools/mock-desk.js", [
  "--host", "127.0.0.1", "--port", String(deskPort), "--reply-port", String(oscPort),
  "--channels", "20", "--auxes", "8",
  ...(process.env.OSC_WEBMIXER_DEV_LIVE_SNAPSHOTS === '1' ? ['--live'] : []),
  ...(process.env.OSC_WEBMIXER_DEV_DROP_QUERY_ONCE ? ['--drop-query-once', process.env.OSC_WEBMIXER_DEV_DROP_QUERY_ONCE] : [])
], { stdio: ["ignore", "pipe", "inherit"] });
let mockOutput = "";
mock.stdout.on("data", chunk => {
  if (process.env.OSC_WEBMIXER_DEV_VERBOSE === "1") process.stdout.write(chunk);
  mockOutput = (mockOutput + chunk).slice(-8192);
  if (!serverStarted && mockOutput.includes("Mock DiGiCo desk listening")) {
    serverStarted = true;
    clearTimeout(startupTimeout);
    launch("index.js", [], {
      stdio: "inherit",
      env: {
        ...process.env,
        OSC_WEBMIXER_CONFIG_DIR: configDirectory,
        OSC_WEBMIXER_DATA_DIR: process.env.OSC_WEBMIXER_DATA_DIR || path.join(configDirectory, "data"),
        OSC_WEBMIXER_BIND_ADDRESS: bindAddress,
        OSC_WEBMIXER_PUBLIC_URL: url
      }
    });
  }
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
// Tests use IPC because Windows cannot deliver POSIX signals to child processes.
process.on("message", message => {
  if (message?.type === "stop") {
    stop();
    if (process.connected) process.disconnect();
  }
});
