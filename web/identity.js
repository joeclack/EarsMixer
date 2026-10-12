"use strict";
const profileDialog = document.getElementById("profileDialog");
const usernameInput = document.getElementById("deviceUsername");
let usernameOnboarding = false;
function getDeviceUsername() { return localStorage.getItem("deviceUsername") || null; }
function sendDeviceUsername(socket) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ username: getDeviceUsername() }));
}
function updateUsernameLabel() {
  const name = getDeviceUsername();
  document.getElementById("deviceUsernameLabel").textContent = name || "Profile";
  document.getElementById("editUsername").setAttribute("aria-label", name ? "Open profile for " + name : "Open profile");
}
function finishUsernameChoice() { usernameOnboarding = false; profileDialog.close(); document.dispatchEvent(new Event("device-username-ready")); }
function prepareUsernameForm() {
  usernameInput.value = getDeviceUsername() || "";
  document.getElementById("usernameError").textContent = "";
  document.getElementById("usernameSaved").hidden = true;
  document.getElementById("skipUsername").hidden = !usernameOnboarding;
}
function openUsernameDialog() {
  usernameOnboarding = true; prepareUsernameForm();
  document.getElementById("profileTitle").textContent = "What should we call you?";
  document.getElementById("usernameForm").hidden = false;
  document.getElementById("profileTemplates").hidden = true;
  document.getElementById("closeProfile").hidden = false;
  profileDialog.showModal();
}
document.getElementById("editUsername").addEventListener("click", () => {
  usernameOnboarding = false; prepareUsernameForm();
  document.getElementById("usernameForm").hidden = false;
  document.getElementById("profileTemplates").hidden = false;
  document.getElementById("profileTitle").textContent = "Your profile";
  profileDialog.showModal(); document.dispatchEvent(new Event("profile-opened"));
});
document.getElementById("closeProfile").addEventListener("click", () => { if (usernameOnboarding) finishUsernameChoice(); else profileDialog.close(); });
document.getElementById("skipUsername").addEventListener("click", finishUsernameChoice);
usernameInput.addEventListener("input", () => { document.getElementById("usernameSaved").hidden = true; document.getElementById("usernameError").textContent = ""; });
profileDialog.addEventListener("cancel", event => { if (usernameOnboarding) { event.preventDefault(); finishUsernameChoice(); } });
document.getElementById("usernameForm").addEventListener("submit", event => {
  event.preventDefault();
  const name = usernameInput.value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) {
    document.getElementById("usernameError").textContent = "Use a username between 1 and 80 characters."; return;
  }
  localStorage.setItem("deviceUsername", name); updateUsernameLabel();
  document.getElementById("usernameError").textContent = "";
  if (usernameOnboarding) finishUsernameChoice();
  else { const saved = document.getElementById("usernameSaved"); saved.textContent = "Username saved."; saved.hidden = false; }
  document.dispatchEvent(new Event("device-username-changed"));
});
window.addEventListener("storage", event => {
  if (event.key === "deviceUsername" || event.key === null) { updateUsernameLabel(); document.dispatchEvent(new Event("device-username-changed")); }
});
updateUsernameLabel();
if (!getDeviceUsername()) openUsernameDialog();
