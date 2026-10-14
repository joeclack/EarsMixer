"use strict";
const adminTemplateSelect = document.getElementById("adminTemplateSelect");
const templateEditor = document.getElementById("templateEditor");
const templateNameInput = document.getElementById("templateName");
const templateAuxInput = document.getElementById("templateAux");
const templateViewInput = document.getElementById("templateView");
const templateRows = document.getElementById("templateChannels");
const templateFilterInput = document.getElementById("templateFavouritesOnly");
const templateAuthorInput = document.getElementById("templateAuthor");
let adminTemplates = [];
let templateChannels = [];
let templateAuxes = [];
let templateDraft = null;
let templateSorter = null;
let adminTemplateBusy = false;
let templateConfigSignature = "";
templateAuthorInput.value = localStorage.getItem("templateAdminName") || localStorage.getItem("deviceUsername") || "Admin";
async function adminTemplateRequest(url, options) {
  const response = await adminFetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Template request failed.");
  return body;
}
function adminTemplateMessage(text, error = false) {
  const el = document.getElementById("adminTemplateMessage"); el.textContent = text; el.classList.toggle("error", error);
}
function updateAdminTemplateControls() {
  const selected = adminTemplates.find(template => template.id === adminTemplateSelect.value);
  document.getElementById("editSavedTemplate").disabled = adminTemplateBusy || !selected || !templateChannels.length;
  document.getElementById("newTemplate").disabled = adminTemplateBusy || !templateChannels.length || !templateAuxes.length;
  document.getElementById("deleteSavedTemplate").disabled = adminTemplateBusy || !selected;
  adminTemplateSelect.disabled = adminTemplateBusy || !adminTemplates.length;
  document.getElementById("templateFields").disabled = adminTemplateBusy || !templateAuxes.length;
  if (templateSorter) templateSorter.option("disabled", adminTemplateBusy);
  document.getElementById("adminTemplateUpdated").textContent = selected ? "Created by " + (selected.createdBy || "an unnamed admin") + " · Updated " + new Date(selected.updatedAt).toLocaleString() + " by " + (selected.updatedBy || "an unnamed admin") : "";
  const name = templateNameInput.value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const existing = adminTemplates.find(template => template.name.toLowerCase() === name);
  document.getElementById("templateSaveHint").textContent = existing ? "Saving updates “" + existing.name + "”." : "";
}
async function refreshAdminTemplates(id = adminTemplateSelect.value) {
  const result = await adminTemplateRequest("/api/templates", { cache: "no-store" });
  adminTemplates = result.templates;
  adminTemplateSelect.replaceChildren(new Option(adminTemplates.length ? "Choose a template…" : "No templates yet", ""));
  for (const template of adminTemplates) adminTemplateSelect.add(new Option(template.name, template.id));
  if (id) adminTemplateSelect.value = id;
  updateAdminTemplateControls();
}
function draftAuxSettings() {
  const aux = templateAuxInput.value;
  if (!templateDraft.favouritesByAux[aux]) templateDraft.favouritesByAux[aux] = { channels: [], enabled: false };
  return templateDraft.favouritesByAux[aux];
}
function saveDraftOrder() { if (templateDraft) templateDraft.channelOrder = Array.from(templateRows.children, row => Number(row.dataset.channel)); }
function renderTemplateChannels() {
  if (!templateDraft) return;
  if (templateSorter) templateSorter.destroy();
  templateRows.replaceChildren();
  const channels = new Map(templateChannels.map(channel => [channel.channel, channel]));
  const order = [...templateDraft.channelOrder, ...channels.keys()].filter((id, index, ids) => channels.has(id) && ids.indexOf(id) === index);
  const settings = draftAuxSettings(); templateFilterInput.checked = settings.enabled;
  for (const id of order) {
    const channel = channels.get(id), row = document.createElement("div"); row.className = "template-channel"; row.dataset.channel = String(id);
    row.innerHTML = '<button type="button" class="template-drag-handle">' + appIcon("gripVertical") + '</button><span class="template-channel-name"></span><label class="template-star"><input type="checkbox">' + appIcon("star") + '</label>';
    row.querySelector(".template-channel-name").textContent = channel.label || "Channel " + id;
    const handle = row.querySelector("button"); handle.setAttribute("aria-label", "Move " + (channel.label || "Channel " + id)); handle.addEventListener("keydown", moveTemplateChannel);
    const star = row.querySelector("input"); star.checked = settings.channels.includes(id); star.setAttribute("aria-label", "Favourite " + (channel.label || "Channel " + id));
    star.addEventListener("change", () => { settings.channels = Array.from(templateRows.querySelectorAll('input:checked'), input => Number(input.closest(".template-channel").dataset.channel)); });
    templateRows.appendChild(row);
  }
  saveDraftOrder();
  templateSorter = new Sortable(templateRows, { draggable: "> .template-channel", handle: ".template-drag-handle", filter: ".template-star", preventOnFilter: false,
    animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
    direction: () => getComputedStyle(templateRows).gridTemplateColumns.split(" ").length > 1 ? "horizontal" : "vertical",
    ghostClass: "template-placeholder", dragClass: "template-drag", forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4, onEnd: saveDraftOrder });
  templateRows.classList.toggle("template-grid", templateDraft.view === "grid");
  updateTemplateSortingMode();
  updateAdminTemplateControls();
}
function updateTemplateSortingMode() {
  if (templateSorter) templateSorter.option("handle", templateDraft?.view === "grid" && window.matchMedia("(min-width: 700px)").matches ? null : ".template-drag-handle");
}
window.matchMedia("(min-width: 700px)").addEventListener("change", updateTemplateSortingMode);
function moveTemplateChannel(event) {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault(); const row = event.currentTarget.closest(".template-channel"); const rows = Array.from(templateRows.children);
  const columns = getComputedStyle(templateRows).gridTemplateColumns.split(" ").length;
  const delta = event.key === "ArrowUp" ? -columns : event.key === "ArrowDown" ? columns : event.key === "ArrowLeft" ? -1 : 1;
  const index = rows.indexOf(row) + delta; if (index < 0 || index >= rows.length) return;
  templateRows.insertBefore(row, delta > 0 ? rows[index].nextSibling : rows[index]); event.currentTarget.focus(); row.scrollIntoView({ block: "nearest" }); saveDraftOrder();
}
function showTemplateDraft(name, config) {
  templateNameInput.value = name; templateDraft = JSON.parse(JSON.stringify(config));
  templateAuxInput.replaceChildren();
  for (const aux of templateAuxes) templateAuxInput.add(new Option(aux.label || "AUX " + aux.channel, String(aux.channel)));
  if (templateAuxes.some(aux => aux.channel === templateDraft.selectedAux)) templateAuxInput.value = String(templateDraft.selectedAux);
  templateDraft.selectedAux = Number(templateAuxInput.value);
  templateViewInput.value = templateDraft.view; templateEditor.hidden = false;
  document.getElementById("templateEditorTitle").textContent = name ? "Edit template" : "New template";
  renderTemplateChannels();
}
document.addEventListener("admin-mixer-config", event => {
  const signature = JSON.stringify(event.detail); if (signature === templateConfigSignature) return;
  templateConfigSignature = signature; templateChannels = event.detail.channels; templateAuxes = event.detail.aux;
  if (templateDraft) showTemplateDraft(templateNameInput.value, templateDraft);
  updateAdminTemplateControls();
});
document.getElementById("newTemplate").addEventListener("click", () => {
  showTemplateDraft("", { selectedAux: templateAuxes[0]?.channel || null, channelOrder: [], favouritesByAux: {}, view: "list" });
  adminTemplateMessage(""); templateNameInput.focus();
});
document.getElementById("editSavedTemplate").addEventListener("click", async () => {
  if (!adminTemplateSelect.value || adminTemplateBusy) return;
  adminTemplateBusy = true; updateAdminTemplateControls();
  try { const template = await adminTemplateRequest("/api/templates/" + adminTemplateSelect.value, { cache: "no-store" }); showTemplateDraft(template.name, template.config); adminTemplateMessage(""); }
  catch (error) { adminTemplateMessage(error.message, true); }
  finally { adminTemplateBusy = false; updateAdminTemplateControls(); }
});
document.getElementById("deleteSavedTemplate").addEventListener("click", async () => {
  const selected = adminTemplates.find(template => template.id === adminTemplateSelect.value);
  if (!selected || adminTemplateBusy) return;
  if (!confirm('Delete template “' + selected.name + '”? This cannot be undone. Layouts already loaded by users will not change.')) return;
  adminTemplateBusy = true; updateAdminTemplateControls(); adminTemplateMessage("");
  try {
    await adminTemplateRequest("/api/admin/templates/" + selected.id, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
    adminTemplates = adminTemplates.filter(template => template.id !== selected.id);
    const option = Array.from(adminTemplateSelect.options).find(option => option.value === selected.id);
    if (option) option.remove();
    adminTemplateSelect.value = "";
    if (templateNameInput.value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() === selected.name.toLowerCase()) {
      templateDraft = null; templateEditor.hidden = true;
      if (templateSorter) { templateSorter.destroy(); templateSorter = null; }
    }
    adminTemplateMessage('Deleted “' + selected.name + '”.');
    try { await refreshAdminTemplates(""); }
    catch { adminTemplateMessage("Template deleted, but the list could not refresh. Reload the admin page to refresh it."); }
  } catch (error) { adminTemplateMessage(error.message, true); }
  finally { adminTemplateBusy = false; updateAdminTemplateControls(); }
});
adminTemplateSelect.addEventListener("change", updateAdminTemplateControls);
templateNameInput.addEventListener("input", updateAdminTemplateControls);
templateAuxInput.addEventListener("change", () => { templateDraft.selectedAux = Number(templateAuxInput.value); renderTemplateChannels(); });
templateViewInput.addEventListener("change", () => { templateDraft.view = templateViewInput.value; templateRows.classList.toggle("template-grid", templateDraft.view === "grid"); updateTemplateSortingMode(); });
templateFilterInput.addEventListener("change", () => { draftAuxSettings().enabled = templateFilterInput.checked; });
templateEditor.addEventListener("submit", async event => {
  event.preventDefault(); if (!templateDraft || adminTemplateBusy) return;
  adminTemplateBusy = true; updateAdminTemplateControls(); adminTemplateMessage("");
  try {
    const template = await adminTemplateRequest("/api/admin/templates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: templateNameInput.value, username: templateAuthorInput.value, config: templateDraft }) });
    localStorage.setItem("templateAdminName", templateAuthorInput.value); templateNameInput.value = template.name;
    document.getElementById("templateEditorTitle").textContent = "Edit template";
    adminTemplateMessage("Saved “" + template.name + "”.");
    try { await refreshAdminTemplates(template.id); }
    catch { adminTemplateMessage("Template saved, but the template list could not refresh. Reload the admin page to refresh it."); }
  } catch (error) { adminTemplateMessage(error.message, true); }
  finally { adminTemplateBusy = false; updateAdminTemplateControls(); }
});
updateAdminTemplateControls();
refreshAdminTemplates().catch(error => adminTemplateMessage(error.message, true));
