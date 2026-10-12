"use strict";
const templateDialog = profileDialog;
const savedTemplateSelect = document.getElementById("savedTemplate");
const templateMessage = document.getElementById("templateMessage");
let clientTemplates = [];
let templateBusy = false;
let templateLoading = false;
let templateConfigReady = mixerConfigReady;
let templateOnboarding = false;
let templateChoice = null;
try {
  const saved = JSON.parse(localStorage.getItem("templateChoice") || "null");
  if (saved?.type === "fresh" || (saved?.type === "template" && typeof saved.id === "string" && typeof saved.name === "string")) templateChoice = saved;
} catch { /* Ask again if the stored choice is invalid. */ }
for (const key of ["profileId", "profileName", "profilePending"]) localStorage.removeItem(key);
function updateTemplateControls() {
  const selected = clientTemplates.find(template => template.id === savedTemplateSelect.value);
  document.getElementById("templateUpdated").textContent = selected ? "Updated " + new Date(selected.updatedAt).toLocaleString() + (selected.updatedBy ? " by " + selected.updatedBy : "") : "";
  savedTemplateSelect.disabled = templateBusy || !clientTemplates.length;
  document.getElementById("loadTemplate").disabled = templateBusy || !selected || !templateConfigReady;
  document.getElementById("startFresh").disabled = templateLoading;
  document.getElementById("closeProfile").disabled = templateLoading;
}
async function openTemplateDialog(onboarding = false) {
  templateOnboarding = onboarding;
  document.getElementById("closeProfile").hidden = onboarding;
  document.getElementById("usernameForm").hidden = onboarding;
  document.getElementById("profileTemplates").hidden = false;
  document.getElementById("profileTitle").textContent = onboarding ? "Choose a layout" : "Your profile";
  if (!templateDialog.open) templateDialog.showModal();
  templateMessage.textContent = ""; templateMessage.classList.remove("error");
  document.getElementById("retryTemplates").hidden = true;
  templateBusy = true; updateTemplateControls();
  try {
    const response = await fetch("/api/templates", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load templates. Retry or start fresh.");
    clientTemplates = (await response.json()).templates;
    savedTemplateSelect.replaceChildren(new Option(clientTemplates.length ? "Choose a template…" : "No templates available yet", ""));
    for (const template of clientTemplates) savedTemplateSelect.add(new Option(template.name, template.id));
    if (templateChoice?.type === "template") savedTemplateSelect.value = templateChoice.id;
  } catch (error) { templateMessage.textContent = error.message; templateMessage.classList.add("error"); document.getElementById("retryTemplates").hidden = false; }
  finally { templateBusy = false; updateTemplateControls(); }
}
function applyLocalTemplate(config) {
  if (editingLayout) editLayoutButton.click();
  const keys = [];
  for (let index = 0; index < localStorage.length; index++) { const key = localStorage.key(index); if (/^aux[1-9]\d*fav(?:Checked)?$/.test(key)) keys.push(key); }
  for (const key of keys) localStorage.removeItem(key);
  for (const [aux, settings] of Object.entries(config.favouritesByAux)) {
    localStorage.setItem("aux" + aux + "fav", settings.channels.join(","));
    localStorage.setItem("aux" + aux + "favChecked", String(settings.enabled));
  }
  localStorage.setItem("channelLayout", JSON.stringify(config.channelOrder));
  const rows = new Map(Array.from(channelsDiv.children, row => [row.dataset.channel, row]));
  for (const id of defaultChannelOrder) if (rows.has(id)) channelsDiv.appendChild(rows.get(id));
  restoreChannelOrder();
  localStorage.setItem("channelView", config.view); setChannelView(config.view);
  const available = Array.from(auxSelect.options).some(option => Number(option.value) === config.selectedAux);
  if (available) auxSelect.value = String(config.selectedAux);
  auxSelect.dispatchEvent(new Event("change"));
}
function finishTemplateChoice(choice) {
  templateChoice = choice; localStorage.setItem("templateChoice", JSON.stringify(choice));
  templateOnboarding = false; templateDialog.close();
}
document.addEventListener("profile-opened", () => openTemplateDialog());
document.getElementById("retryTemplates").addEventListener("click", () => openTemplateDialog(templateOnboarding));
templateDialog.addEventListener("cancel", event => { if (templateOnboarding || templateLoading) event.preventDefault(); });
savedTemplateSelect.addEventListener("change", updateTemplateControls);
document.getElementById("loadTemplate").addEventListener("click", async () => {
  if (templateBusy || !savedTemplateSelect.value || !templateConfigReady) return;
  templateBusy = true; templateLoading = true; updateTemplateControls();
  try {
    const response = await fetch("/api/templates/" + savedTemplateSelect.value, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load this template. Retry or choose another.");
    const template = await response.json();
    applyLocalTemplate(template.config);
    finishTemplateChoice({ type: "template", id: template.id, name: template.name });
  } catch (error) { templateMessage.textContent = error.message; templateMessage.classList.add("error"); }
  finally { templateBusy = false; templateLoading = false; updateTemplateControls(); }
});
document.getElementById("startFresh").addEventListener("click", () => {
  if (templateLoading) return;
  const firstAux = auxSelect.options[0]?.value;
  applyLocalTemplate({ selectedAux: firstAux ? Number(firstAux) : null, channelOrder: [], favouritesByAux: {}, view: "list" });
  finishTemplateChoice({ type: "fresh" });
});
document.addEventListener("mixer-config-ready", () => { templateConfigReady = true; updateTemplateControls(); });
document.addEventListener("device-username-ready", () => { if (!templateChoice && !templateDialog.open) openTemplateDialog(true); });
if (!profileDialog.open && !templateChoice) openTemplateDialog(true);
