"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const mixerSource = fs.readFileSync(path.join(__dirname, "../web/mixer.js"), "utf8");

// Represent the controls needed to verify native data and cross-script behavior.
// Full rendering still needs a browser check.
class Control {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.style = { setProperty() {} };
    this.classList = { contains: () => false, toggle() {} };
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
  }
  set innerHTML(markup) {
    if (!markup.includes("channel-header")) return;
    this.controls = new Map([".channel-name", ".volumeInput", ".level-readout", ".drag-handle", 'input[name="fav[]"]'].map(selector => [selector, new Control()]));
  }
  querySelector(selector) { return this.controls?.get(selector) || null; }
  querySelectorAll(selector) {
    const favourite = selector.includes("fav[]");
    const controls = this.children.map(row => row.querySelector(favourite ? 'input[name="fav[]"]' : ".volumeInput"));
    return controls.filter(control => control && (!selector.includes(":checked") || control.checked));
  }
  appendChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    this.children.push(child);
    if (this.tagName === "SELECT" && !this.value) this.value = child.value;
    return child;
  }
  replaceChildren() { this.children = []; this.value = ""; }
  get options() { return this.children; }
  get selectedOptions() { return this.children.filter(option => option.value === this.value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener.call(this, event); }
  focus() {}
}

function createMixer(source = mixerSource) {
  const controls = new Map();
  const storage = new Map();
  const timers = new Map();
  let now = 0;
  let nextTimerId = 0;
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    constructor() { this.readyState = Socket.OPEN; this.sent = []; }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const document = {
    body: new Control(),
    fullscreenElement: null,
    getElementById(id) {
      if (!controls.has(id)) controls.set(id, new Control(id === "aux" ? "select" : "div"));
      return controls.get(id);
    },
    createElement: tag => new Control(tag),
    addEventListener() {},
    dispatchEvent() {},
  };
  const context = vm.createContext({
    document,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
      key: index => [...storage.keys()][index] ?? null,
      get length() { return storage.size; },
    },
    WebSocket: Socket,
    Sortable: class { destroy() {} option() {} },
    Event: class { constructor(type) { this.type = type; } },
    location: { protocol: "http:", host: "localhost" },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
    appIcon: () => "",
    sendDeviceUsername() {},
    setTimeout(callback, delay = 0) { const id = ++nextTimerId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const run = code => vm.runInContext(code, context);
  run(source);
  const message = json => run("onMessage({data:" + JSON.stringify(JSON.stringify(json)) + "})");
  const slider = id => run('channelElements.get("' + id + '").slider');
  const socket = () => run("ws");
  function tick(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const next = Array.from(timers).filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].due; next[1].callback();
    }
    now = target;
  }
  message({ config: {
    snapshot: "Test cue",
    channels: [{ channel: 65, label: "Guitar", enabled: true, order: 2 }, { channel: 2, label: "Vocal", enabled: true, order: 1 }, { channel: 3, label: "Hidden", enabled: false }],
    aux: [{ channel: 2, label: "Joe", enabled: true, colour: "#123456" }, { channel: 4, label: "Band", enabled: true, colour: "#ff0000" }, { channel: 1, label: "Hidden", enabled: false }],
  } });
  const level = (channel, aux, db) => message({ address: `/Input_Channels/${channel}/Aux_Send/${aux}/send_level`, args: [db] });
  return { controls, run, message, slider, socket, tick, level, writes: () => socket().sent.filter(message => /\/send_level$/.test(message.address || "")) };
}

test("production minified mixer supports personal templates without writing desk values", () => {
  const mixer = createMixer(fs.readFileSync(path.join(__dirname, "../web/mixer.min.js"), "utf8"));
  mixer.run("var profileDialog = document.getElementById('profileDialog'); localStorage.setItem('templateChoice', JSON.stringify({type:'fresh'}));");
  mixer.run(fs.readFileSync(path.join(__dirname, "../web/templates.js"), "utf8"));
  mixer.run("applyLocalTemplate({selectedAux:4,channelOrder:[65,2],favouritesByAux:{4:{channels:[65],enabled:true}},view:'grid'})");
  assert.deepEqual(mixer.controls.get("channels").children.map(row => row.dataset.channel), ["65", "2"]);
  assert.equal(mixer.controls.get("aux").value, "4");
  assert.equal(mixer.controls.get("gridView").attributes["aria-pressed"], "true");
  assert.equal(mixer.run("localStorage.getItem('aux4fav')"), "65");
  assert.equal(mixer.run("localStorage.getItem('aux4favChecked')"), "true");
  assert.equal(mixer.writes().length, 0);
  assert.equal(mixer.socket().sent.at(-2)?.selectedAux, 4);
});

test("mixer filters enabled controls, sorts configured order and queries actual channel IDs", () => {
  const mixer = createMixer();
  assert.deepEqual(mixer.controls.get("channels").children.map(row => row.dataset.channel), ["2", "65"]);
  assert.deepEqual(mixer.controls.get("aux").options.map(option => option.value), ["2", "4"]);
  assert.deepEqual(mixer.socket().sent[0], { selectedAux: 2 });
  mixer.tick(30);
  assert.deepEqual(mixer.socket().sent.filter(message => message.address).map(message => message.address), [
    "/Input_Channels/2/Aux_Send/2/send_level/?", "/Input_Channels/65/Aux_Send/2/send_level/?",
  ]);
  assert.equal(mixer.controls.get("snapshot").textContent, "Test cue");
});

test("each fader waits for its own finite value and ignores responses for another AUX", () => {
  const mixer = createMixer();
  assert.equal(mixer.slider(2).disabled, true);
  assert.equal(mixer.slider(65).disabled, true);
  mixer.level(2, 2, -20);
  assert.equal(mixer.slider(2).disabled, false);
  assert.equal(mixer.slider(65).disabled, true);
  mixer.level(65, 4, 0);
  mixer.level(65, 2, "0");
  assert.equal(mixer.slider(65).disabled, true);
  mixer.level(65, 2, -150);
  assert.equal(mixer.slider(65).disabled, false);
  assert.equal(mixer.slider(65).value, "0");
});

test("native fader curve preserves dB values and the off endpoint", () => {
  const mixer = createMixer();
  for (const db of [-80, -40, -20, 0, 10]) assert.ok(Math.abs(mixer.run(`sliderToDb(dbToSlider(${db}))`) - db) < 1e-8);
  assert.equal(mixer.run("sliderToDb(0)"), -150);
  assert.equal(mixer.run("dbToSlider(-150)"), 0);
  assert.equal(mixer.run("sliderToDb(1)"), 10);
});

test("slider readouts display native dB, off and local drag values", () => {
  for (const source of [mixerSource, fs.readFileSync(path.join(__dirname, "../web/mixer.min.js"), "utf8")]) {
    const mixer = createMixer(source);
    const readout = mixer.controls.get("channels").children[0].querySelector(".level-readout");
    assert.equal(readout.textContent, "—");
    mixer.level(2, 2, -3);
    assert.equal(readout.textContent, "55% / -3 dB");
    assert.equal(mixer.slider(2).attributes["aria-valuetext"], "55 percent, -3 decibels");
    mixer.level(2, 2, -150);
    assert.equal(readout.textContent, "0% / −∞ dB");
    mixer.level(2, 2, 10);
    assert.equal(readout.textContent, "100% / 10 dB");
    mixer.slider(2).value = "0.5";
    mixer.slider(2).dispatchEvent({ type: "input" });
    assert.equal(readout.textContent, "50% / -5.1 dB");
  }
});

test("slider traffic is coalesced and release flushes the final value immediately", () => {
  const mixer = createMixer();
  mixer.level(65, 2, 0);
  const slider = mixer.slider(65);
  for (const value of ["0.2", "0.3", "0.4"]) { slider.value = value; slider.dispatchEvent({ type: "input" }); }
  mixer.tick(34);
  assert.equal(mixer.writes().length, 0);
  mixer.tick(1);
  assert.equal(mixer.writes().length, 1);
  assert.equal(mixer.writes()[0].address, "/Input_Channels/65/Aux_Send/2/send_level");
  assert.ok(Math.abs(mixer.writes()[0].args[0] - mixer.run("sliderToDb(0.4)")) < 1e-8);
  slider.value = "1"; slider.dispatchEvent({ type: "input" }); slider.dispatchEvent({ type: "pointerup" });
  assert.equal(mixer.writes().length, 2);
  assert.equal(mixer.writes()[1].args[0], 10);
  mixer.tick(100);
  assert.equal(mixer.writes().length, 2);
});

test("switching AUX cancels old queries and pending writes, then disables faders", () => {
  const mixer = createMixer();
  mixer.level(65, 2, 0);
  const slider = mixer.slider(65);
  slider.value = "0.5"; slider.dispatchEvent({ type: "input" });
  const aux = mixer.controls.get("aux"); aux.value = "4"; aux.dispatchEvent({ type: "change" });
  mixer.tick(100);
  assert.equal(mixer.writes().length, 0);
  assert.equal(slider.disabled, true);
  assert.equal(mixer.socket().sent.some(message => message.address === "/Input_Channels/65/Aux_Send/2/send_level/?"), false);
  assert.equal(mixer.socket().sent.some(message => message.address === "/Input_Channels/65/Aux_Send/4/send_level/?"), true);
  mixer.level(65, 2, 0);
  assert.equal(slider.disabled, true);
  mixer.level(65, 4, -20);
  assert.equal(slider.disabled, false);
});

test("disconnect clears pending writes and invalidates loaded values", () => {
  const mixer = createMixer();
  mixer.level(65, 2, 0);
  const slider = mixer.slider(65);
  slider.value = "0.5"; slider.dispatchEvent({ type: "input" });
  mixer.socket().close();
  mixer.tick(100);
  assert.equal(mixer.writes().length, 0);
  assert.equal(slider.disabled, true);
  assert.equal(slider.dataset.ready, "false");
});

test("a snapshot mix reload invalidates faders and requeries the selected AUX without rebuilding the layout", () => {
  const mixer = createMixer();
  mixer.tick(30);
  mixer.level(2, 2, -20); mixer.level(65, 2, 0);
  const slider = mixer.slider(65);
  slider.value = "0.5"; slider.dispatchEvent({ type: "input" });
  const rows = [...mixer.controls.get("channels").children];
  const previousValues = [mixer.slider(2).value, slider.value];
  const previousReadouts = rows.map(row => row.querySelector('.level-readout').textContent);
  mixer.socket().sent.length = 0;
  mixer.message({ address: "/MixReload", args: [] });
  assert.equal(mixer.slider(2).disabled, true);
  assert.equal(slider.disabled, true);
  assert.equal(slider.dataset.ready, "false");
  assert.deepEqual([mixer.slider(2).value, slider.value], previousValues);
  assert.deepEqual(rows.map(row => row.querySelector('.level-readout').textContent), previousReadouts);
  assert.equal(mixer.controls.get("mixerStatus").textContent, "Updating mix · 0/2");
  assert.deepEqual(mixer.controls.get("channels").children, rows);
  assert.deepEqual(mixer.socket().sent[0], { selectedAux: 2 });
  mixer.tick(100);
  assert.equal(mixer.writes().length, 0);
  assert.deepEqual(mixer.socket().sent.filter(message => message.address).map(message => message.address), [
    "/Input_Channels/2/Aux_Send/2/send_level/?", "/Input_Channels/65/Aux_Send/2/send_level/?",
  ]);
  mixer.level(65, 2, -10);
  assert.equal(slider.disabled, false);
  assert.equal(mixer.slider(2).disabled, true);
  assert.equal(mixer.slider(2).value, previousValues[0]);
  mixer.message({ address: "/MixReload", args: [] });
  assert.equal(mixer.slider(2).value, previousValues[0]);
  const aux = mixer.controls.get('aux'); aux.value = '4'; aux.dispatchEvent({ type: 'change' });
  assert.equal(mixer.slider(2).value, '0');
  assert.equal(slider.value, '0');
  assert.equal(mixer.controls.get('mixerStatus').textContent, 'Loading mix · 0/2');
});
