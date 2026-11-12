"use strict";
const nicknameDialog = document.getElementById("nicknameDialog");
const nicknameInput = document.getElementById("nickname");
const nicknameError = document.getElementById("nicknameError");
const nicknameSetupKey = "earsmixer.nickname-setup.v1";
function getDeviceNickname() {
  try { return localStorage.getItem("deviceUsername") || null; } catch { return null; }
}
// A stable ID for this browser, so the server recognises the device when its
// IP address changes. It is an identifier, not a secret; access comes from the
// token the server issues after the connection PIN is entered.
function getDeviceId() {
  try {
    let id = localStorage.getItem("earsmixer.device-id");
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      id = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("earsmixer.device-id", id);
    }
    return id;
  } catch { return null; }
}
function getAccessToken() { try { return localStorage.getItem("earsmixer.access-token") || null; } catch { return null; } }
function setAccessToken(token) {
  try { if (token) localStorage.setItem("earsmixer.access-token", token); else localStorage.removeItem("earsmixer.access-token"); } catch {}
}
// Sent first on every connection; the server asks for the PIN if it is needed.
function sendClientAuth(socket) {
  if (socket && socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ auth: { device: getDeviceId(), token: getAccessToken(), name: getDeviceNickname() } }));
}
function sendDeviceNickname(socket) {
  // Keep the existing wire field so web and native clients share the same presence protocol.
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ username: getDeviceNickname() }));
}
function updateNicknameLabel() {
  const name = getDeviceNickname();
  document.getElementById("nicknameLabel").textContent = name || "Nickname";
  document.getElementById("editNickname").setAttribute("aria-label", name ? "Edit nickname: " + name : "Set nickname");
}
function openNicknameDialog(onboarding = false) {
  nicknameInput.value = getDeviceNickname() || "";
  nicknameError.textContent = "";
  document.getElementById("skipNickname").hidden = !onboarding;
  nicknameDialog.showModal();
}
function finishNicknameSetup() {
  try { localStorage.setItem(nicknameSetupKey, "true"); } catch {}
  nicknameDialog.close();
}
function saveNickname() {
  const name = nicknameInput.value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) {
    nicknameError.textContent = "Use up to 80 characters.";
    return false;
  }
  try {
    if (name) localStorage.setItem("deviceUsername", name);
    else localStorage.removeItem("deviceUsername");
    nicknameError.textContent = "";
    updateNicknameLabel();
    document.dispatchEvent(new Event("device-nickname-changed"));
    return true;
  } catch { nicknameError.textContent = "Could not save to this device."; return false; }
}
document.getElementById("editNickname").addEventListener("click", () => openNicknameDialog());
document.getElementById("closeNickname").addEventListener("click", finishNicknameSetup);
document.getElementById("skipNickname").addEventListener("click", finishNicknameSetup);
nicknameInput.addEventListener("input", saveNickname);
nicknameDialog.addEventListener("cancel", event => { event.preventDefault(); finishNicknameSetup(); });
document.getElementById("nicknameForm").addEventListener("submit", event => {
  event.preventDefault();
  if (saveNickname()) finishNicknameSetup();
});
window.addEventListener("storage", event => {
  if (event.key === "deviceUsername" || event.key === null) {
    updateNicknameLabel();
    if (nicknameDialog.open) nicknameInput.value = getDeviceNickname() || "";
    document.dispatchEvent(new Event("device-nickname-changed"));
  }
});
// Remove obsolete selection metadata without changing the current channel layout.
try { for (const key of ["profileId", "profileName", "profilePending", "templateChoice"]) localStorage.removeItem(key); } catch {}
updateNicknameLabel();
let nicknameSetupComplete = false;
try { nicknameSetupComplete = localStorage.getItem(nicknameSetupKey) === "true"; } catch {}
if (!getDeviceNickname() && !nicknameSetupComplete) openNicknameDialog(true);
