"use strict";
// Mobile access: the connection PIN and the devices that have paired with it.
const accessRequiredInput = document.getElementById("accessRequired");
const accessPinPanel = document.getElementById("accessPinPanel");
const accessDevicesEl = document.getElementById("accessDevices");
let accessBusy = false;
let accessState = null;

function accessMessage(text, error = false) {
  const el = document.getElementById("accessMessage"); el.textContent = text; el.classList.toggle("error", error);
}
async function accessRequest(url, options = {}) {
  const response = await adminFetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not update mobile access.");
  return body;
}
function formatSeen(time) {
  if (!time) return "never";
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return Math.round(seconds / 60) + " min ago";
  return new Date(time).toLocaleString();
}
function renderAccess() {
  if (!accessState) return;
  // Leave the tick box alone while a change is being saved, so it does not flicker back.
  if (!accessBusy) accessRequiredInput.checked = accessState.enabled;
  accessPinPanel.hidden = !accessState.enabled;
  document.getElementById("accessPin").textContent = accessState.pin.slice(0, 3) + " " + accessState.pin.slice(3);
  const qr = document.getElementById("accessQr");
  document.getElementById("accessQrWrap").hidden = !accessState.qr;
  if (accessState.qr && qr.src !== accessState.qr) qr.src = accessState.qr;
  for (const id of ["accessRequired", "copyAccessPin", "changeAccessPin", "revokeAllAccess"]) document.getElementById(id).disabled = accessBusy;
  accessDevicesEl.replaceChildren();
  if (!accessState.devices.length) {
    const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "No devices have connected yet.";
    accessDevicesEl.appendChild(empty); return;
  }
  for (const device of accessState.devices) {
    const row = document.createElement("div"); row.className = "access-device";
    const info = document.createElement("div");
    const name = document.createElement("div"); name.className = "access-device-name";
    name.textContent = device.name || "Unnamed device";
    const status = document.createElement("span");
    status.className = "access-device-status" + (device.online ? " online" : "");
    status.textContent = device.online ? "Connected" : accessState.enabled ? (device.paired ? "Signed in" : "Not signed in") : "Seen";
    name.appendChild(status);
    const meta = document.createElement("span"); meta.className = "access-device-meta";
    meta.textContent = "ID " + device.id.slice(0, 8) + " · Last seen " + formatSeen(device.lastSeen) + (device.lastAddress ? " from " + device.lastAddress : "");
    info.append(name, meta);
    const actions = document.createElement("div"); actions.className = "access-device-actions";
    if (device.paired) actions.appendChild(accessButton("Sign out", "Sign out " + (device.name || "this device"), () => removeDevice(device, false)));
    actions.appendChild(accessButton("Forget", "Forget " + (device.name || "this device"), () => removeDevice(device, true)));
    row.append(info, actions);
    accessDevicesEl.appendChild(row);
  }
}
function accessButton(label, aria, onClick) {
  const button = document.createElement("button"); button.type = "button"; button.textContent = label;
  button.setAttribute("aria-label", aria); button.disabled = accessBusy; button.addEventListener("click", onClick);
  return button;
}
async function runAccess(action, success) {
  if (accessBusy) return;
  accessBusy = true; renderAccess(); accessMessage("");
  try { accessState = await action(); if (success) accessMessage(success); await refreshAccess(); }
  catch (error) { accessMessage(error.message, true); }
  finally { accessBusy = false; renderAccess(); }
}
async function refreshAccess() {
  try { accessState = await accessRequest("/api/admin/access", { cache: "no-store" }); renderAccess(); }
  catch (error) { if (!accessBusy) accessMessage(error.message, true); }
}
function removeDevice(device, forget) {
  const name = device.name || "this device";
  if (forget && !confirm("Forget " + name + "? It will need the PIN again to connect.")) return;
  void runAccess(() => accessRequest("/api/admin/access/devices/" + encodeURIComponent(device.id) + (forget ? "?forget=1" : ""), { method: "DELETE", body: "{}" }),
    forget ? "Forgot " + name + "." : "Signed out " + name + ". It will need the PIN to reconnect.");
}
accessRequiredInput.addEventListener("change", () => {
  const enabled = accessRequiredInput.checked;
  if (enabled && !confirm("Require a PIN? Everyone connected now will be disconnected until they enter the PIN.")) { accessRequiredInput.checked = false; return; }
  void runAccess(() => accessRequest("/api/admin/access", { method: "PUT", body: JSON.stringify({ enabled }) }),
    enabled ? "PIN required. Share the PIN with your musicians." : "PIN turned off. Anyone on the network can connect.");
});
document.getElementById("changeAccessPin").addEventListener("click", () => {
  if (!confirm("Change the PIN? Every device will be signed out and need the new PIN.")) return;
  void runAccess(() => accessRequest("/api/admin/access/pin", { method: "POST", body: "{}" }), "New PIN created. Every device has been signed out.");
});
document.getElementById("revokeAllAccess").addEventListener("click", () => {
  if (!confirm("Sign out every device? They will need the PIN to reconnect.")) return;
  void runAccess(() => accessRequest("/api/admin/access/revoke-all", { method: "POST", body: "{}" }), "Every device has been signed out.");
});
document.getElementById("copyAccessPin").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(accessState.pin); accessMessage("PIN copied."); }
  catch { accessMessage("Could not copy the PIN. Select it and copy it instead.", true); }
});
refreshAccess();
// Keep connection status and last-seen times current while the dashboard is open.
setInterval(() => { if (!document.hidden && !accessBusy) void refreshAccess(); }, 10000);
