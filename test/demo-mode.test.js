"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const WebSocket = require("ws");
const { demoRequested, prepareDemo, DEMO_FLAG, DEMO_OSC_PORT, DEMO_DESK_PORT } = require("../lib/demo-mode.js");

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "earsmixer-demo-mode-"));
}

test("demo mode is requested by OSC_WEBMIXER_DEMO=1 or the demo-mode file", () => {
  const home = tempHome();
  assert.equal(demoRequested(home, {}), false);
  assert.equal(demoRequested(home, { OSC_WEBMIXER_DEMO: "0" }), false);
  assert.equal(demoRequested(home, { OSC_WEBMIXER_DEMO: "1" }), true);
  fs.writeFileSync(path.join(home, DEMO_FLAG), "");
  assert.equal(demoRequested(home, {}), true);
});

test("demo settings are separate, use the real web port and leave real settings untouched", () => {
  const home = tempHome();
  const realConfigDir = path.join(home, "config");
  fs.mkdirSync(realConfigDir);
  const realConfig = { server: { port: 8123, name: "Front of house" }, osc: { port: 8000 }, desk: { ip: "10.0.0.5", port: 9000 }, externalDevices: [{ ip: "10.0.0.9" }] };
  fs.writeFileSync(path.join(realConfigDir, "global.json"), JSON.stringify(realConfig));
  const env = { OSC_WEBMIXER_CONFIG_DIR: realConfigDir, OSC_WEBMIXER_DATA_DIR: path.join(home, "data"), OSC_WEBMIXER_OSC_PORT: "8000" };

  const result = prepareDemo(home, realConfigDir, env);
  const demo = JSON.parse(fs.readFileSync(path.join(home, "demo", "config", "global.json"), "utf8"));
  assert.deepEqual(demo.server, { name: "EarsMixer Demo", port: 8123 });
  assert.deepEqual(demo.desk, { ip: "127.0.0.1", port: DEMO_DESK_PORT });
  assert.deepEqual(demo.osc, { port: DEMO_OSC_PORT });
  assert.deepEqual(demo.externalDevices, []);
  assert.equal(env.OSC_WEBMIXER_DEMO, "1");
  assert.equal(env.OSC_WEBMIXER_CONFIG_DIR, path.join(home, "demo", "config"));
  assert.equal(env.OSC_WEBMIXER_DATA_DIR, path.join(home, "demo", "data"));
  assert.equal(env.OSC_WEBMIXER_OSC_PORT, undefined);
  assert.equal(result.deskPort, DEMO_DESK_PORT);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(realConfigDir, "global.json"), "utf8")), realConfig);

  // A name set in the demo's admin is kept; the port still follows the real server.
  demo.server.name = "Rehearsal demo";
  fs.writeFileSync(path.join(home, "demo", "config", "global.json"), JSON.stringify(demo));
  realConfig.server.port = 8124;
  fs.writeFileSync(path.join(realConfigDir, "global.json"), JSON.stringify(realConfig));
  prepareDemo(home, realConfigDir, { OSC_WEBMIXER_CONFIG_DIR: realConfigDir });
  const again = JSON.parse(fs.readFileSync(path.join(home, "demo", "config", "global.json"), "utf8"));
  assert.deepEqual(again.server, { name: "Rehearsal demo", port: 8124 });
});

async function freePort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(check, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for " + description);
}

test("the packaged launcher runs a full mixer against the demo desk", { timeout: 40000 }, async () => {
  const home = tempHome();
  const webPort = await freePort();
  fs.mkdirSync(path.join(home, "config"));
  fs.writeFileSync(path.join(home, "config", "global.json"), JSON.stringify({ server: { port: webPort }, osc: { port: 8000 }, desk: { ip: "10.0.0.5", port: 9000 }, externalDevices: [] }));
  let output = "";
  const child = spawn(process.execPath, [path.join(__dirname, "..", "tools", "macos-launcher.cjs")], {
    env: { ...process.env, OSC_WEBMIXER_HOME: home, OSC_WEBMIXER_DEMO: "1", OSC_WEBMIXER_DISCOVERY: "0",
      OSC_WEBMIXER_CONFIG_DIR: "", OSC_WEBMIXER_DATA_DIR: "", OSC_WEBMIXER_WEB_PORT: "", OSC_WEBMIXER_OSC_PORT: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  try {
    const status = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${webPort}/api/local/status`);
      const body = await response.json();
      return body.desk.connected ? body : null;
    }, "the server to load the demo desk");
    assert.equal(status.demo, true);
    assert.equal(status.desk.address, "127.0.0.1");

    const socket = new WebSocket(`ws://127.0.0.1:${webPort}/`);
    const messages = [];
    socket.on("message", data => messages.push(JSON.parse(data)));
    await once(socket, "open");
    const { config } = await waitFor(async () => messages.find(message => message.config), "the mix config");
    assert.equal(config.channels.length, 20);
    assert.equal(config.aux.length, 8);
    socket.close();

    // Real settings were not modified.
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, "config", "global.json"), "utf8")).desk.ip, "10.0.0.5");
    assert.match(output, /Demo mode: using the built-in demo desk/);
  } catch (error) {
    error.message += "\n--- launcher output ---\n" + output.slice(-3000);
    throw error;
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
});
