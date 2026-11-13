"use strict";

const channelsDiv = document.getElementById("channels");
const auxSelect = document.getElementById("aux");
const panModeButton = document.getElementById("panMode");
let panMode = false;
const sendParameter = () => panMode ? "send_pan" : "send_level";
const setAllLevelsOffButton = document.getElementById("setAllLevelsOff");
const editLayoutButton = document.getElementById("editLayout");
const layoutHint = document.getElementById("layoutHint");
const layoutEditor = document.getElementById("layoutEditor");
const doneLayoutButton = document.getElementById("doneLayout");
const emptyChannels = document.getElementById("emptyChannels");
let ws = null;
let reconnectTimer = null;
let connectionTimer = null;
let queryTimer = null;
let queryGeneration = 0;
let editingLayout = false;
let channelSorter = null;
let mixerConfigReady = false;
// Level answers received from the desk, to tell a slow desk from a frozen socket.
let levelResponses = 0;
let resumeCheck = null;
const channelElements = new Map();
const pendingWrites = new Map();
const mixerStatus = document.getElementById("mixerStatus");
const snapshotName = document.getElementById("snapshot");
const WRITE_INTERVAL_MS = 35;

const mixerControls = document.getElementById("mixerControls");
const controlsToggle = document.getElementById("controlsToggle");
const controlsFan = document.getElementById("controlsFan");
const controlsBackdrop = document.getElementById("controlsBackdrop");
let controlsOpen = false;

function setControlsOpen(open, restoreFocus = false) {
  controlsOpen = open;
  mixerControls.classList.toggle("is-open", open);
  controlsToggle.setAttribute("aria-expanded", String(open));
  controlsToggle.setAttribute("aria-label", open ? "Close mixer controls" : "Open mixer controls");
  controlsFan.inert = !open;
  controlsBackdrop.hidden = !open;
  if (restoreFocus) controlsToggle.focus();
}

controlsToggle.addEventListener("click", () => setControlsOpen(!controlsOpen));
controlsBackdrop.addEventListener("click", () => setControlsOpen(false, true));
controlsFan.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (button) setControlsOpen(false, button.id !== "editNickname");
});
document.getElementById("nicknameDialog").addEventListener("close", () => controlsToggle.focus());
document.addEventListener("focusin", event => {
  if (controlsOpen && !mixerControls.contains(event.target)) setControlsOpen(false);
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && controlsOpen) { event.preventDefault(); setControlsOpen(false, true); }
});


function setConnectionStatus(connected) {
  document.body.classList.toggle("connected", connected);
  document.body.classList.toggle("disconnected", !connected);
  updateMixStatus();
}

// Native DiGiCo sends are expressed in dB; retain v2's fader curve.
function sliderToDb(value) {
  if (!Number.isFinite(value) || value <= 0) return -150;
  return Math.max(-150, Math.min(10, Math.log10(Math.min(1, value) * 100) * 50 - 90));
}

function dbToSlider(db) {
  if (!Number.isFinite(db) || db <= -150) return 0;
  return Math.max(0, Math.min(1, Math.pow(100, (db + 90) / 100) / 100));
}

function sendOSC(address, args = []) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ address, args }));
  return true;
}

function updateMixStatus() {
  setAllLevelsOffButton.disabled = !canSetAllLevelsOff();
  if (!ws || ws.readyState !== WebSocket.OPEN) { mixerStatus.textContent = "Connecting…"; return; }
  if (!mixerConfigReady) { mixerStatus.textContent = "Loading channels…"; return; }
  if (!auxSelect.value) { mixerStatus.textContent = "No mixes enabled"; return; }
  const loaded = Array.from(channelElements.values()).filter(({ slider }) => slider.dataset.ready === "true").length;
  const total = channelElements.size;
  const refreshing = Array.from(channelElements.values()).some(({ slider }) => slider.dataset.refreshing === "true");
  mixerStatus.textContent = loaded === total ? "Connected" : (refreshing ? "Updating mix · " : "Loading mix · ") + loaded + "/" + total;
}

function updateLevel(slider, level, db = null) {
  const valid = typeof level === "number" && Number.isFinite(level);
  slider.dataset.refreshing = "false";
  if (valid) slider.dataset.valueAux = auxSelect.value;
  else delete slider.dataset.valueAux;
  const value = valid ? Math.max(0, Math.min(1, level)) : (panMode ? 0.5 : 0);
  slider.value = String(value);
  slider.style.setProperty("--value", value * 100 + "%");
  const { readout, thumb } = channelElements.get(slider.dataset.channel);
  thumb.style.setProperty("--value", value * 100 + "%");
  if (panMode) {
    const offset = Math.round(Math.abs(value * 2 - 1) * 100);
    const position = offset === 0 ? "C" : (value < 0.5 ? "L " : "R ") + offset;
    readout.textContent = valid ? position : "—";
    readout.title = valid ? "Send pan: " + position : "Waiting for the desk";
    slider.setAttribute("aria-valuetext", valid ? (offset === 0 ? "Centre" : offset + " percent " + (value < 0.5 ? "left" : "right")) : "Not loaded");
    return;
  }
  const decibels = db === null ? sliderToDb(value) : db;
  const dbText = decibels <= -150 ? "−∞" : String(Number(decibels.toFixed(1)));
  readout.textContent = valid ? Math.round(value * 100) + "% / " + dbText + " dB" : "—";
  readout.title = valid ? "Send level: " + dbText + " dB" : "Waiting for the desk";
  slider.setAttribute("aria-valuetext", valid ? Math.round(value * 100) + " percent, " + (decibels <= -150 ? "off" : dbText + " decibels") : "Not loaded");
}

function canSetAllLevelsOff() {
  return !editingLayout && ws?.readyState === WebSocket.OPEN && Boolean(auxSelect.value) && channelElements.size > 0 &&
    Array.from(channelElements.values()).every(({ slider }) => slider.dataset.ready === "true");
}

setAllLevelsOffButton.addEventListener("click", () => {
  if (!canSetAllLevelsOff()) return;
  const aux = auxSelect.value;
  const name = auxSelect.selectedOptions[0]?.textContent || "AUX " + aux;
  if (!confirm('Set all ' + channelElements.size + ' channels in “' + name + '” to off (−∞ dB)?')) return;
  if (aux !== auxSelect.value || !canSetAllLevelsOff()) return;
  clearPendingWrites();
  for (const { slider } of channelElements.values()) {
    if (sendOSC("/Input_Channels/" + slider.dataset.channel + "/Aux_Send/" + aux + "/send_level", [-150])) {
      if (!panMode) updateLevel(slider, 0, -150);
    }
  }
});

function clearPendingWrites() {
  for (const pending of pendingWrites.values()) clearTimeout(pending.timer);
  pendingWrites.clear();
  for (const { cancelDrag } of channelElements.values()) cancelDrag();
}

function flushSlider(slider) {
  const pending = pendingWrites.get(slider.dataset.channel);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingWrites.delete(slider.dataset.channel);
  if (editingLayout || slider.dataset.ready !== "true" || pending.aux !== auxSelect.value || pending.parameter !== sendParameter()) return;
  sendOSC("/Input_Channels/" + slider.dataset.channel + "/Aux_Send/" + pending.aux + "/" + pending.parameter, [pending.parameter === "send_pan" ? pending.value : sliderToDb(pending.value)]);
}

function sliderChange() {
  if (editingLayout || this.dataset.ready !== "true" || !ws || ws.readyState !== WebSocket.OPEN) return;
  const value = Number(this.value);
  updateLevel(this, value);
  let pending = pendingWrites.get(this.dataset.channel);
  if (pending) { pending.value = value; return; }
  pending = { aux: auxSelect.value, parameter: sendParameter(), value, timer: null };
  pendingWrites.set(this.dataset.channel, pending);
  pending.timer = setTimeout(() => flushSlider(this), WRITE_INTERVAL_MS);
}

function bindFaderHandle(slider, thumb) {
  let drag = null;
  function cancelDrag() {
    if (!drag) return;
    const pointerId = drag.pointerId;
    drag = null;
    thumb.classList.toggle("dragging", false);
    const pending = pendingWrites.get(slider.dataset.channel);
    if (pending) clearTimeout(pending.timer);
    pendingWrites.delete(slider.dataset.channel);
    if (thumb.hasPointerCapture(pointerId)) thumb.releasePointerCapture(pointerId);
  }
  thumb.addEventListener("pointerdown", event => {
    if (drag || event.button !== 0 || slider.disabled) return;
    const travel = slider.getBoundingClientRect().width - thumb.getBoundingClientRect().width;
    if (travel <= 0) return;
    // Preserve the grab offset: touching either edge of the handle must not jump.
    drag = { pointerId: event.pointerId, x: event.clientX, value: Number(slider.value),
      travel, aux: auxSelect.value, parameter: sendParameter(), moved: false };
    event.preventDefault();
    slider.classList.toggle("pointer-focused", true);
    slider.focus({ preventScroll: true });
    thumb.setPointerCapture(event.pointerId);
    thumb.classList.toggle("dragging", true);
  });
  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (slider.disabled || drag.aux !== auxSelect.value || drag.parameter !== sendParameter()) {
      cancelDrag();
      return;
    }
    const delta = event.clientX - drag.x;
    // Ignore the small finger movement that can accompany a tap.
    if (!drag.moved && Math.abs(delta) < 3) return;
    drag.moved = true;
    const previous = slider.value;
    slider.value = String(Math.max(0, Math.min(1, drag.value + delta / drag.travel)));
    if (slider.value !== previous) slider.dispatchEvent(new Event("input", { bubbles: true }));
  }
  thumb.addEventListener("pointermove", move);
  thumb.addEventListener("pointerup", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    move(event);
    flushSlider(slider);
    cancelDrag();
  });
  for (const type of ["pointercancel", "lostpointercapture"]) thumb.addEventListener(type, event => {
    if (drag?.pointerId === event.pointerId) cancelDrag();
  });
  slider.addEventListener("blur", cancelDrag);
  for (const type of ["keydown", "blur"]) slider.addEventListener(type, () => slider.classList.toggle("pointer-focused", false));
  return cancelDrag;
}

function requestValues({ preserveValues = false } = {}) {
  clearTimeout(queryTimer);
  const generation = ++queryGeneration;
  clearPendingWrites();
  for (const { slider, readout } of channelElements.values()) {
    slider.dataset.ready = "false";
    if (preserveValues && slider.dataset.valueAux === auxSelect.value) {
      slider.dataset.refreshing = "true";
      readout.title = "Last known level; refreshing from the desk";
      slider.setAttribute("aria-valuetext", readout.textContent + "; updating from the desk");
    } else updateLevel(slider, null);
  }
  updateLayoutInputs(); updateMixStatus();
  if (!ws || ws.readyState !== WebSocket.OPEN || !auxSelect.value) return;
  const aux = auxSelect.value;
  const responsesBefore = levelResponses;
  ws.send(JSON.stringify({ selectedAux: Number(aux) }));
  function queryMissing(attempt = 0) {
    const missing = Array.from(channelElements.values()).filter(({ slider }) => slider.dataset.ready !== "true");
    let index = 0;
    function queryNext() {
      if (generation !== queryGeneration || aux !== auxSelect.value || !ws || ws.readyState !== WebSocket.OPEN) return;
      // Safari freezes background pages; resumeMixer picks the queries up again when the page is shown.
      if (!pageVisible()) return;
      if (index < missing.length) {
        const slider = missing[index++].slider;
        if (slider.dataset.ready !== "true") sendOSC("/Input_Channels/" + slider.dataset.channel + "/Aux_Send/" + aux + "/" + sendParameter() + "/?");
        queryTimer = setTimeout(queryNext, 12);
      } else if (attempt < 2 && Array.from(channelElements.values()).some(({ slider }) => slider.dataset.ready !== "true")) {
        queryTimer = setTimeout(() => queryMissing(attempt + 1), 1000);
      } else if (Array.from(channelElements.values()).some(({ slider }) => slider.dataset.ready !== "true")) {
        // No answers at all means the socket is open in name only, which Safari leaves
        // behind after freezing the page. Reconnect; onclose starts a new connection.
        if (levelResponses === responsesBefore) ws.close();
        else mixerStatus.textContent = "Some channels unavailable · change mix to retry";
      }
    }
    queryNext();
  }
  queryMissing();
}

function updateEmptyChannels() {
  emptyChannels.hidden = channelsDiv.children.length > 0 || editingLayout;
  emptyChannels.textContent = "No channels configured for this mixer.";
}

function onMessage(event) {
  let json;
  try { json = JSON.parse(event.data); } catch { return; }
  if (!json || typeof json !== "object") return;
  // The server needs the connection PIN, or this device was signed out.
  if (json.auth === "required" || json.auth === "revoked") { requestPin(json.auth === "revoked"); return; }
  if (json.config) {
    mixerConfigReady = true;
    buildChannels(Array.isArray(json.config.channels) ? json.config.channels : []);
    updateSnapshot(json.config.snapshot);
    buildAux(Array.isArray(json.config.aux) ? json.config.aux : []);
    return;
  }
  if (typeof json.address !== "string" || !Array.isArray(json.args)) return;
  if (json.address === "/MixReload") { requestValues({ preserveValues: true }); return; }
  if (json.address === "/SnapshotName") { updateSnapshot(json.args[0]); return; }
  const levelMatch = json.address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)$/);
  if (levelMatch) {
    if (levelMatch[2] !== auxSelect.value || "send_" + levelMatch[3] !== sendParameter()) return;
    const controls = channelElements.get(levelMatch[1]);
    const db = json.args[0];
    if (!controls || typeof db !== "number" || !Number.isFinite(db)) return;
    controls.slider.dataset.ready = "true";
    levelResponses++;
    updateLevel(controls.slider, panMode ? db : dbToSlider(db), db);
    controls.slider.disabled = editingLayout || !ws || ws.readyState !== WebSocket.OPEN;
    updateMixStatus();
    return;
  }
  const channelMatch = json.address.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/name$/);
  if (channelMatch) {
    const controls = channelElements.get(channelMatch[1]);
    if (controls) {
      const name = String(json.args[0] || "Channel " + channelMatch[1]);
      controls.name.textContent = name;
      controls.name.title = name;
      controls.slider.setAttribute("aria-label", name + (panMode ? " send pan" : " send level"));
      controls.handle.setAttribute("aria-label", "Move " + name);
    }
  }
  const auxMatch = json.address.match(/^\/Aux_Outputs\/(\d+)\/Buss_Trim\/name$/);
  if (auxMatch) {
    for (const option of auxSelect.options) if (option.value === auxMatch[1]) option.textContent = String(json.args[0] || "AUX " + auxMatch[1]);
  }
}

function updateSnapshot(name) {
  snapshotName.textContent = typeof name === "string" ? name : "";
  snapshotName.title = "Desk snapshot: " + snapshotName.textContent;
  snapshotName.hidden = !snapshotName.textContent;
}

function formatColour(colour) {
  const rgb = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(colour || "");
  return rgb ? rgb.slice(1).map(value => parseInt(value, 16)).join(", ") : "239, 68, 68";
}

function buildAux(options) {
  options = options.filter(aux => aux.enabled !== false);
  const saved = localStorage.getItem("aux");
  auxSelect.replaceChildren();
  for (const aux of options) {
    const option = document.createElement("option");
    option.value = String(aux.channel);
    option.textContent = aux.label || "AUX " + aux.channel;
    option.dataset.colour = formatColour(aux.colour);
    auxSelect.appendChild(option);
  }
  auxSelect.disabled = !options.length;
  if (options.some(aux => String(aux.channel) === saved)) auxSelect.value = saved;
  if (options.length) auxSelect.dispatchEvent(new Event("change"));
  else requestValues();
}

function buildChannels(channels) {
  channels = channels.filter(channel => channel.enabled !== false).sort((a, b) => (a.order ?? a.channel) - (b.order ?? b.channel));
  if (channelSorter) channelSorter.destroy();
  clearPendingWrites();
  channelElements.clear();
  channelsDiv.replaceChildren();
  for (const channel of channels) {
    const row = document.createElement("div");
    row.className = "channel-card";
    row.dataset.channel = String(channel.channel);
    row.innerHTML = '<button type="button" class="drag-handle" title="Drag to reorder">' + appIcon("gripVertical") + '</button><div class="channel-header"><span class="channel-name"></span><div class="fader-control"><input class="fader volumeInput" type="range" min="0" max="1" step="0.001" value="0" disabled><span class="fader-thumb" aria-hidden="true"></span></div><output class="level-readout">—</output></div>';
    const name = channel.label || "Channel " + channel.channel;
    row.querySelector(".channel-name").textContent = name;
    row.querySelector(".channel-name").title = name;
    const slider = row.querySelector(".volumeInput");
    slider.dataset.channel = String(channel.channel);
    slider.dataset.ready = "false";
    slider.setAttribute("aria-label", name + (panMode ? " send pan" : " send level"));
    slider.addEventListener("input", sliderChange);
    const thumb = row.querySelector(".fader-thumb");
    const cancelDrag = bindFaderHandle(slider, thumb);
    for (const event of ["change", "keyup", "blur"]) slider.addEventListener(event, () => flushSlider(slider));
    const handle = row.querySelector(".drag-handle");
    handle.setAttribute("aria-label", "Move " + name);
    handle.addEventListener("keydown", moveChannelWithKeys);
    channelElements.set(String(channel.channel), { row, slider, thumb, cancelDrag, handle, name: row.querySelector(".channel-name"), readout: row.querySelector(".level-readout") });
    channelsDiv.appendChild(row);
  }
  restoreChannelOrder();
  channelSorter = new Sortable(channelsDiv, {
    disabled: !editingLayout, draggable: "> .channel-card", handle: ".drag-handle", direction: () => isGridLayout() ? "horizontal" : "vertical",
    animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
    ghostClass: "layout-placeholder", chosenClass: "layout-chosen", dragClass: "layout-drag",
    forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4,
    scroll: document.getElementById("channelsWrap"), forceAutoScrollFallback: true, scrollSensitivity: 70, scrollSpeed: 12,
    onEnd: saveChannelOrder,
  });
  updateSortingMode();
  updateLayoutInputs();
  updateEmptyChannels();
}

function restoreChannelOrder() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem("channelLayout") || "[]"); } catch { return; }
  if (!Array.isArray(saved)) return;
  const rows = new Map(Array.from(channelsDiv.children, row => [row.dataset.channel, row]));
  for (const id of saved) { const row = rows.get(String(id)); if (row) { channelsDiv.appendChild(row); rows.delete(String(id)); } }
  for (const row of rows.values()) channelsDiv.appendChild(row);
}

function saveChannelOrder() {
  localStorage.setItem("channelLayout", JSON.stringify(Array.from(channelsDiv.children, row => row.dataset.channel)));

}

function moveChannelWithKeys(event) {
  const grid = isGridLayout();
  const keys = grid ? ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  if (!editingLayout || !keys.includes(event.key)) return;
  event.preventDefault();
  const row = event.currentTarget.parentElement;
  const rows = Array.from(channelsDiv.children);
  const columns = grid ? getComputedStyle(channelsDiv).gridTemplateColumns.split(" ").length : 1;
  const index = rows.indexOf(row);
  const delta = event.key === "ArrowUp" ? -columns : event.key === "ArrowDown" ? columns : event.key === "ArrowLeft" ? -1 : 1;
  const target = index + delta;
  if (target < 0 || target >= rows.length) return;
  channelsDiv.insertBefore(row, delta > 0 ? rows[target].nextSibling : rows[target]);
  event.currentTarget.focus(); row.scrollIntoView({ block: "nearest" }); saveChannelOrder();
}

panModeButton.addEventListener("click", () => {
  panMode = !panMode;
  panModeButton.setAttribute("aria-pressed", String(panMode));
  document.body.classList.toggle("pan-mode", panMode);
  for (const { slider, name } of channelElements.values()) {
    slider.setAttribute("aria-label", name.textContent + (panMode ? " send pan" : " send level"));
  }
  requestValues();
});

function updateLayoutInputs() {
  setAllLevelsOffButton.disabled = !canSetAllLevelsOff();
  const connected = ws && ws.readyState === WebSocket.OPEN;
  editLayoutButton.disabled = !channelsDiv.children.length;
  panModeButton.disabled = editingLayout || !channelsDiv.children.length;
  for (const { slider } of channelElements.values()) slider.disabled = editingLayout || !connected || slider.dataset.ready !== "true";
}

auxSelect.addEventListener("change", () => {
  localStorage.setItem("aux", auxSelect.value);
  const option = auxSelect.selectedOptions[0];
  if (option) document.body.style.setProperty("--tint", option.dataset.colour);
  updateEmptyChannels(); requestValues();

});
function setEditingLayout(active) {
  clearPendingWrites();
  editingLayout = active;
  if (channelSorter) channelSorter.option("disabled", !editingLayout);
  document.body.classList.toggle("editing-layout", editingLayout);
  editLayoutButton.innerHTML = appIcon(editingLayout ? "check" : "pencil") + '<span>' + (editingLayout ? "Done" : "Edit layout") + '</span>';
  editLayoutButton.setAttribute("aria-pressed", String(editingLayout));
  layoutEditor.hidden = !editingLayout;
  updateSortingMode();
  document.getElementById("listView").disabled = editingLayout;
  document.getElementById("gridView").disabled = editingLayout;
  updateLayoutInputs(); updateEmptyChannels();
}
editLayoutButton.addEventListener("click", () => setEditingLayout(!editingLayout));
doneLayoutButton.addEventListener("click", () => {
  if (editingLayout) setEditingLayout(false);
  controlsToggle.focus();
});

// Connection PIN: shown when the server asks for it, then the connection resumes.
const pinDialog = document.getElementById("pinDialog");
const pinInput = document.getElementById("pin");
const pinError = document.getElementById("pinError");
let pinNeeded = false;
function requestPin(revoked) {
  pinNeeded = true;
  setAccessToken(null);
  clearTimeout(reconnectTimer);
  pinError.textContent = revoked ? "This device was signed out. Enter the current PIN to reconnect." : "";
  if (!pinDialog.open) { pinInput.value = ""; pinDialog.showModal(); pinInput.focus(); }
}
pinDialog.addEventListener("cancel", event => event.preventDefault());
document.getElementById("pinForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = document.getElementById("pinSubmit");
  button.disabled = true; pinError.textContent = "";
  try {
    const response = await fetch("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinInput.value, device: getDeviceId(), name: getDeviceNickname() }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { pinError.textContent = body.error || "Could not check the PIN. Try again."; pinInput.select(); return; }
    setAccessToken(body.token);
    pinNeeded = false; pinDialog.close();
    startWebsocket();
  } catch { pinError.textContent = "Could not reach the mixer. Check your Wi-Fi and try again."; }
  finally { button.disabled = false; }
});

function startWebsocket() {
  clearTimeout(reconnectTimer);
  clearTimeout(connectionTimer);
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
  const socket = ws;
  socket.onopen = () => { if (ws === socket) { clearTimeout(connectionTimer); setConnectionStatus(true); sendClientAuth(socket); sendDeviceNickname(socket); } };
  socket.onmessage = event => { if (ws === socket) onMessage(event); };
  socket.onerror = () => socket.close();
  socket.onclose = () => {
    if (ws !== socket) return;
    clearTimeout(connectionTimer); clearTimeout(queryTimer); queryGeneration++;
    mixerConfigReady = false;
    clearPendingWrites();
    for (const { slider } of channelElements.values()) { slider.dataset.ready = "false"; updateLevel(slider, null); }
    setConnectionStatus(false); updateLayoutInputs();
    // Wait for the PIN instead of reconnecting in a loop.
    if (!pinNeeded) reconnectTimer = setTimeout(startWebsocket, 2000);
  };
  // Retry a stalled handshake, including the intermittent iOS Safari failure.
  connectionTimer = setTimeout(() => { if (ws === socket && socket.readyState === WebSocket.CONNECTING) socket.close(); }, 3000);
}
startWebsocket();
document.addEventListener("device-nickname-changed", () => sendDeviceNickname(ws));

function pageVisible() { return document.visibilityState !== "hidden"; }

// Safari freezes timers and WebSocket delivery for a page that is opened or left in
// the background, which left faders disabled until the user switched apps and back.
// Whenever the page is shown or touched, reconnect a closed socket and fetch any
// levels that have not arrived. If a socket that looks open does not answer, Safari
// left it dead while frozen: close it so the normal reconnect runs.
function resumeMixer() {
  if (!pageVisible() || pinNeeded) return;
  if (!ws || ws.readyState > WebSocket.OPEN) { startWebsocket(); return; }
  if (ws.readyState !== WebSocket.OPEN || !mixerConfigReady || !auxSelect.value || editingLayout) return;
  if (!Array.from(channelElements.values()).some(({ slider }) => slider.dataset.ready !== "true")) return;
  const socket = ws, responsesBefore = levelResponses;
  requestValues({ preserveValues: true });
  clearTimeout(resumeCheck);
  resumeCheck = setTimeout(() => {
    if (ws === socket && socket.readyState === WebSocket.OPEN && levelResponses === responsesBefore && pageVisible()) socket.close();
  }, 4000);
}
document.addEventListener("visibilitychange", resumeMixer);
window.addEventListener("pageshow", resumeMixer);
window.addEventListener("focus", resumeMixer);
document.addEventListener("pointerdown", resumeMixer, { passive: true });

const listViewButton = document.getElementById("listView");
const gridViewButton = document.getElementById("gridView");
function setChannelView(view) {
  const grid = view === "grid";
  document.body.classList.toggle("grid-view", grid);
  listViewButton.setAttribute("aria-pressed", String(!grid));
  gridViewButton.setAttribute("aria-pressed", String(grid));
  updateSortingMode();
}
listViewButton.addEventListener("click", () => { localStorage.setItem("channelView", "list"); setChannelView("list"); });
gridViewButton.addEventListener("click", () => { localStorage.setItem("channelView", "grid"); setChannelView("grid"); });
setChannelView(localStorage.getItem("channelView") || "list");

function isGridLayout() {
  return document.body.classList.contains("grid-view") && window.matchMedia("(min-width: 700px)").matches;
}
function updateSortingMode() {
  if (channelSorter) channelSorter.option("handle", isGridLayout() ? null : ".drag-handle");
  layoutHint.textContent = isGridLayout()
    ? "Drag cards to reorder."
    : "Drag a handle to reorder.";
}
window.matchMedia("(min-width: 700px)").addEventListener("change", updateSortingMode);
