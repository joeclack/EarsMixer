const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The config folder is read when the module loads, so load a fresh copy per folder.
function configManager(directory) {
  process.env.OSC_WEBMIXER_CONFIG_DIR = directory;
  const file = require.resolve("../lib/config/configManager.js");
  delete require.cache[file];
  return require(file);
}
const temporaryFolder = () => fs.mkdtempSync(path.join(os.tmpdir(), "earsmixer-config-"));
const damaged = (directory, name) => fs.readdirSync(directory).filter(file => file.startsWith(name + ".damaged-"));

test("a damaged settings file is set aside and the last good copy is used", () => {
  const directory = temporaryFolder();
  const config = configManager(directory);
  const first = { debug: false, server: { port: 8080 }, osc: { port: 8000 }, desk: { ip: "192.168.1.50", port: 9000 }, externalDevices: [] };
  config.saveGlobalConfig(first);
  config.saveGlobalConfig({ ...first, desk: { ip: "192.168.1.51", port: 9000 } });
  // The save before the last one is kept as the backup.
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "global.json.bak"), "utf8")).desk.ip, "192.168.1.50");

  fs.writeFileSync(path.join(directory, "global.json"), '{"server": {"port": 80');
  assert.equal(config.getGlobalConfigOrDefault().desk.ip, "192.168.1.50");
  assert.equal(damaged(directory, "global.json").length, 1);
  assert.equal(fs.readFileSync(path.join(directory, damaged(directory, "global.json")[0]), "utf8"), '{"server": {"port": 80');
});

test("with no readable copy the defaults are used and nothing is lost", () => {
  const directory = temporaryFolder();
  const config = configManager(directory);
  fs.writeFileSync(path.join(directory, "global.json"), "[]");
  fs.writeFileSync(path.join(directory, "state.json"), "\0\0\0");
  assert.equal(config.getGlobalConfigOrDefault().server.port, 80);
  assert.deepEqual(config.getCurrentStateOrDefault().channels, []);
  assert.equal(damaged(directory, "global.json").length, 1);
  assert.equal(damaged(directory, "state.json").length, 1);
});

test("a damaged presets file is not overwritten by the next preset", () => {
  const directory = temporaryFolder();
  const config = configManager(directory);
  fs.writeFileSync(path.join(directory, "presets.json"), '[{"name": "Sunday"');
  assert.deepEqual(config.getPresets(), []);
  config.saveCurrentStateAsPreset({ auxes: [], channels: [] }, "Monday");
  assert.deepEqual(config.getPresets().map(preset => preset.name), ["Monday"]);
  assert.equal(fs.readFileSync(path.join(directory, damaged(directory, "presets.json")[0]), "utf8"), '[{"name": "Sunday"');
});

test("a damaged file is not kept as the backup", () => {
  const directory = temporaryFolder();
  const config = configManager(directory);
  config.saveCurrentState({ name: "Good", auxes: [], channels: [] });
  config.saveCurrentState({ name: "Good", auxes: [], channels: [] });
  fs.writeFileSync(path.join(directory, "state.json"), "{broken");
  config.saveCurrentState({ name: "Newer", auxes: [], channels: [] });
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "state.json.bak"), "utf8")).name, "Good");
});
