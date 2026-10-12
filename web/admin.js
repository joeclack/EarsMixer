"use strict";

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("content");
const errorEl = document.getElementById("error");
const connectionsEl = document.getElementById("connections");
const authStatusEl = document.getElementById("authStatus");
const auxCountEl = document.getElementById("auxCount");
const channelCountEl = document.getElementById("channelCount");
const mixerUrlEl = document.getElementById("mixerUrl");
const copyUrlBtn = document.getElementById("copyUrl");
const qrCodeEl = document.getElementById("qrCode");
const auxTableEl = document.getElementById("auxTable");
const channelTableEl = document.getElementById("channelTable");
const clientsListEl = document.getElementById("clientsList");
const noClientsEl = document.getElementById("noClients");
const disconnectedSectionEl = document.getElementById("disconnectedSection");
const disconnectedClientsListEl = document.getElementById(
  "disconnectedClientsList",
);
const auxMenuEl = document.getElementById("auxMenu");
const liveMixPanelEl = document.getElementById("liveMixPanel");
const liveMixFoldEl = document.getElementById("liveMixFold");
const liveMixSummaryEl = document.getElementById("liveMixSummary");
const liveMixHintEl = document.getElementById("liveMixHint");
const liveMixTitleEl = document.getElementById("liveMixTitle");
const liveMixChannelsEl = document.getElementById("liveMixChannels");
const panToggleEl = document.getElementById("panToggle");
const panToggleLabelEl = document.getElementById("panToggleLabel");
const sidebarNavEl = document.getElementById("sidebarNav");
const sidebarToggleEl = document.getElementById("sidebarToggle");
const pageTitleEl = document.getElementById("pageTitle");
const pageEls = document.querySelectorAll(".page");
const navItemEls = document.querySelectorAll(".nav-item");

const pageTitles = {
  overview: "Overview",
  "live-mix": "Live mix",
  clients: "Clients",
  templates: "Templates",
  config: "Config",
  "desk-settings": "Desk settings",
};

const logIcons = { aux: appIcon("headphones"), level: appIcon("volume2"), pan: appIcon("moveHorizontal") };

const foldableOpen = new Map();

let statusLoading = false;
let currentUrl = "";
let auxOptions = [];
let mixLevels = {};
let selectedAux = sessionStorage.getItem("adminSelectedAux");
let showPan = sessionStorage.getItem("adminShowPan") === "true";
let currentPage =
  window.location.hash.replace("#", "") ||
  sessionStorage.getItem("adminPage") ||
  "overview";

function showPage(page) {
  if (!pageTitles[page]) {
    page = "overview";
  }

  if (page === "clients") {
    for (const key of foldableOpen.keys()) {
      if (key.startsWith("adminClientFold-")) {
        foldableOpen.delete(key);
      }
    }
    [clientsListEl, disconnectedClientsListEl].forEach((container) => {
      container.querySelectorAll(".client-fold").forEach((el) => {
        el.open = false;
      });
    });
  }

  currentPage = page;
  sessionStorage.setItem("adminPage", page);
  window.location.hash = page;

  pageTitleEl.textContent = pageTitles[page];

  pageEls.forEach((el) => {
    el.classList.toggle("active", el.dataset.page === page);
  });

  navItemEls.forEach((el) => {
    el.classList.toggle("active", el.dataset.page === page);
  });

  closeAdminNavigation();
  document.dispatchEvent(new CustomEvent("admin-page-changed", { detail: { page } }));
  if (page === "live-mix") void loadStatus();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function safeColour(value) {
  const components = String(value ?? "").split(",").map(part => Number(part.trim()));
  return components.length === 3 && components.every(component => Number.isFinite(component) && component >= 0 && component <= 255)
    ? components.map(Math.round).join(", ") : "100, 116, 139";
}

function levelPercentage(value) {
  return Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 100) : 0;
}

function formatTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatLevel(level) {
  if (!Number.isFinite(level)) {
    return "—";
  }
  return `${levelPercentage(level)}%`;
}

function formatPan(pan) {
  if (!Number.isFinite(pan)) {
    return "";
  }
  if (pan === 0) {
    return "C";
  }
  return pan < 0 ? `L ${Math.abs(Math.round(pan * 100))}` : `R ${Math.round(pan * 100)}`;
}

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

function restoreFoldable(el, storageKey) {
  el.open = foldableOpen.get(storageKey) ?? false;
}

const boundFoldables = new WeakSet();

function bindFoldable(el, storageKey) {
  restoreFoldable(el, storageKey);

  if (boundFoldables.has(el)) {
    return;
  }

  boundFoldables.add(el);
  el.addEventListener("toggle", () => {
    foldableOpen.set(storageKey, el.open);
  });
}

function coalesceClientLog(log) {
  if (!log?.length) {
    return [];
  }

  const coalesced = [];

  for (const entry of log) {
    const previous = coalesced[coalesced.length - 1];
    const sameGroup =
      previous &&
      previous.type === entry.type &&
      previous.aux === entry.aux &&
      (entry.type === "aux" || previous.channel === entry.channel);

    if (sameGroup) {
      previous.at = entry.at;
      previous.toValue = entry.value;
      previous.count += 1;
      continue;
    }

    coalesced.push({
      ...entry,
      fromValue:
        entry.previousValue != null ? entry.previousValue : entry.value,
      toValue: entry.value,
      count: 1,
    });
  }

  return coalesced.reverse();
}

function formatLogValue(type, value) {
  if (type === "level") {
    return formatLevel(value);
  }
  if (type === "pan") {
    return formatPan(value) || "C";
  }
  return escapeHtml(value);
}

function formatLogEntryText(entry) {
  const auxName = escapeHtml(entry.auxLabel || `AUX ${entry.aux}`);
  const channelName = escapeHtml(entry.channelLabel || `Ch ${entry.channel}`);

  if (entry.type === "aux") {
    return `<strong>${auxName}</strong>`;
  }

  const fromValue = entry.fromValue;
  const toValue = entry.toValue ?? entry.value;
  const hasRange =
    fromValue != null && Math.abs(fromValue - toValue) > 0.005;

  const changed = hasRange
    ? `${formatLogValue(entry.type, fromValue)} → ${formatLogValue(entry.type, toValue)}`
    : formatLogValue(entry.type, toValue);

  const suffix =
    entry.count > 1 && !hasRange
      ? `<span class="log-count">${entry.count} changes</span>`
      : "";

  if (entry.type === "level") {
    return `<strong>${channelName}</strong> · ${changed} · ${auxName}${suffix}`;
  }

  return `<strong>${channelName}</strong> · ${changed} · ${auxName}${suffix}`;
}

function renderClientLog(log) {
  const entries = coalesceClientLog(log);

  if (!entries.length) {
    return '<p class="muted">No changes yet.</p>';
  }

  return `<ol class="client-log">
    ${entries
      .map(
        (entry) => `<li class="log-entry log-entry-${["aux", "level", "pan"].includes(entry.type) ? entry.type : "unknown"}">
          <span class="log-icon-wrap">${logIcons[entry.type] || ""}</span>
          <time>${escapeHtml(formatClock(entry.at))}</time>
          <span class="log-text">${formatLogEntryText(entry)}</span>
        </li>`,
      )
      .join("")}
  </ol>`;
}

function renderClientLevels(levels) {
  if (!levels || levels.length === 0) {
    return '<p class="muted">No AUX selected yet.</p>';
  }

  const activeLevels = levels.filter((entry) => entry.level != null);
  if (activeLevels.length === 0) {
    return '<p class="muted">Waiting for desk values…</p>';
  }

  return `<table class="client-levels">
    <thead>
      <tr>
        <th>Channel</th>
        <th>Label</th>
        <th>Level</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${activeLevels
        .map((entry) => {
          const panText = formatPan(entry.pan);
          return `<tr>
            <td>${escapeHtml(entry.channel)}</td>
            <td>${escapeHtml(entry.label || "—")}</td>
            <td>${formatLevel(entry.level)}${panText ? ` · ${panText}` : ""}</td>
            <td class="level-cell">
              <div class="level-bar">
                <div class="level-bar-fill" style="width: ${levelPercentage(entry.level)}%"></div>
              </div>
            </td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;
}

function escapeClientName(value) {
  return escapeHtml(value);
}
function renderClientCard(client, disconnected = false) {
  const auxName =
    client.auxLabel ||
    (client.aux != null ? `AUX ${client.aux}` : "No AUX selected");
  const auxColour = client.auxColour
    ? `style="--client-tint: ${safeColour(client.auxColour)}"`
    : "";
  const statusText = disconnected
    ? `Disconnected ${formatTime(client.disconnectedAt)}`
    : `Active ${formatTime(client.lastActivity)}`;

  return `<article class="client-card${disconnected ? " client-card-disconnected" : ""}" data-client-id="${escapeHtml(client.id)}" ${auxColour}>
    <div class="client-header">
      <div>
        <strong>${escapeClientName(client.username || `Client ${client.id}`)}</strong>
        <span class="muted">${client.username ? `Client ${escapeHtml(client.id)} · ` : ""}${escapeHtml(client.address || "Unknown address")}</span>
      </div>
      <div class="client-meta">
        <span class="client-aux">${escapeHtml(auxName)}</span>
        <span class="muted">${statusText}</span>
      </div>
    </div>
    <details class="foldable client-fold" data-section="mix">
      <summary>Current mix</summary>
      <div class="foldable-body">
        ${renderClientLevels(client.levels)}
      </div>
    </details>
    <details class="foldable client-fold" data-section="log">
      <summary>Changelog (${coalesceClientLog(client.log || []).length})</summary>
      <div class="foldable-body">
        ${renderClientLog(client.log)}
      </div>
    </details>
  </article>`;
}

function bindClientFoldables(container) {
  container.querySelectorAll(".client-fold").forEach((el) => {
    const clientId = el.closest(".client-card")?.dataset.clientId;
    const section = el.dataset.section;
    bindFoldable(el, `adminClientFold-${clientId}-${section}`);
  });
}

function renderClients(connected, disconnected) {
  noClientsEl.hidden = connected.length > 0;
  clientsListEl.innerHTML = connected.map((client) => renderClientCard(client)).join("");
  bindClientFoldables(clientsListEl);

  if (!disconnected.length) {
    disconnectedSectionEl.hidden = true;
    disconnectedClientsListEl.innerHTML = "";
    return;
  }

  disconnectedSectionEl.hidden = false;
  disconnectedClientsListEl.innerHTML = disconnected
    .map((client) => renderClientCard(client, true))
    .join("");
  bindClientFoldables(disconnectedClientsListEl);
}

function getAuxLabel(aux) {
  return aux.label || `AUX ${aux.channel}`;
}

function renderAuxMenu() {
  const signature = JSON.stringify(auxOptions.map(aux => [aux.channel, getAuxLabel(aux)]));
  if (auxMenuEl.dataset.options !== signature) {
    auxMenuEl.replaceChildren();
    for (const aux of auxOptions) {
      const option = document.createElement("option");
      option.value = String(aux.channel); option.textContent = getAuxLabel(aux);
      auxMenuEl.appendChild(option);
    }
    auxMenuEl.dataset.options = signature;
  }
  auxMenuEl.value = selectedAux || "";
  auxMenuEl.disabled = !auxOptions.length;
}

function renderLiveMixChannels(levels, stereo) {
  if (!levels) {
    liveMixChannelsEl.innerHTML = '<p class="muted">Waiting for desk values…</p>';
    return;
  }

  const visibleLevels = levels.filter((entry) => entry.level != null);
  if (!visibleLevels.length) {
    liveMixChannelsEl.innerHTML = '<p class="muted">Waiting for desk values…</p>';
    return;
  }

  liveMixChannelsEl.innerHTML = visibleLevels
    .map((entry) => {
      const levelPercent = levelPercentage(entry.level);
      const panStyle =
        Number.isFinite(entry.pan) ? `${Math.round((Math.max(-1, Math.min(1, entry.pan)) + 1) * 50)}%` : "50%";

      return `<div class="live-channel">
        <label class="mixer-fader volume" style="--value: ${levelPercent}%">
          <span>${escapeHtml(entry.label || `Ch ${entry.channel}`)}</span>
          <span class="level-readout">${levelPercent}%</span>
          <div class="fader-track" role="meter" aria-label="Send level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${levelPercent}"><div class="fader-fill"></div><div class="fader-thumb"></div></div>
        </label>
        ${
          stereo
            ? `<label class="mixer-fader pan-display${showPan ? "" : " hidden"}" style="--value: ${panStyle}">
          <span>${escapeHtml(entry.label || `Ch ${entry.channel}`)}</span>
          <div class="pan-track"></div>
          <span class="pan-readout">${formatPan(entry.pan)}</span>
        </label>`
            : ""
        }
      </div>`;
    })
    .join("");
}

function renderLiveMix() {
  const aux = auxOptions.find(
    (entry) => String(entry.channel) === String(selectedAux),
  );

  if (!aux) {
    liveMixFoldEl.hidden = true;
    liveMixHintEl.hidden = false;
    return;
  }

  liveMixHintEl.hidden = true;
  liveMixFoldEl.hidden = false;
  restoreFoldable(liveMixFoldEl, "adminLiveMixFold");
  liveMixTitleEl.textContent = getAuxLabel(aux);
  liveMixSummaryEl.textContent = `Live sends · ${getAuxLabel(aux)}`;
  document.body.style.setProperty("--live-tint", safeColour(aux.colour));

  panToggleLabelEl.hidden = !aux.stereo;
  panToggleEl.checked = showPan && aux.stereo;

  renderLiveMixChannels(mixLevels[aux.channel], aux.stereo);
}

function selectAux(channel) {
  selectedAux = String(channel);
  sessionStorage.setItem("adminSelectedAux", selectedAux);
  renderAuxMenu();
  renderLiveMix();
  if (currentPage === "live-mix") void loadStatus();
}

function renderStatus(data) {
  loadingEl.hidden = true;
  errorEl.hidden = true;
  contentEl.hidden = false;
  setAdminConnection(true, data.loaded);
  const deskStatus = document.getElementById("deskStatus");
  deskStatus.textContent = data.loaded ? "Desk discovered. Mix values load when an AUX is selected." : "Waiting for desk discovery. Check the connection in Desk settings.";
  const deskSnapshot = document.getElementById("deskSnapshot");
  deskSnapshot.hidden = data.snapshot == null || data.snapshot === "";
  deskSnapshot.textContent = deskSnapshot.hidden ? "" : "Snapshot: " + String(data.snapshot);

  currentUrl = data.url;
  connectionsEl.textContent = String(data.connections);
  authStatusEl.textContent = data.adminPasswordEnabled ? "Enabled" : "Disabled";
  renderAdminPassword(!!data.adminPasswordEnabled);
  auxCountEl.textContent = String(data.aux.length);
  channelCountEl.textContent = String(data.channels.length);

  auxOptions = data.aux || [];
  mixLevels = data.mixLevels || {};

  if (
    selectedAux &&
    !auxOptions.some((entry) => String(entry.channel) === String(selectedAux))
  ) {
    selectedAux = null;
    sessionStorage.removeItem("adminSelectedAux");
  }

  if (!selectedAux && auxOptions.length) {
    selectedAux = String(auxOptions[0].channel);
    sessionStorage.setItem("adminSelectedAux", selectedAux);
  }

  renderAuxMenu();
  renderLiveMix();

  renderClients(data.clients || [], data.disconnectedClients || []);
  document.dispatchEvent(new CustomEvent("admin-mixer-config", { detail: { channels: data.channels, aux: data.aux } }));

  mixerUrlEl.href = data.url;
  mixerUrlEl.textContent = data.url;
  qrCodeEl.src = data.qr;

  auxTableEl.innerHTML = data.aux
    .map(
      (aux) => `<tr>
        <td><span class="colour-dot" style="background: rgb(${safeColour(aux.colour)})"></span>${escapeHtml(aux.channel)}</td>
        <td>${escapeHtml(aux.label || "—")}</td>
        <td>${aux.stereo ? "Yes" : "No"}</td>
      </tr>`,
    )
    .join("");

  channelTableEl.innerHTML = data.channels
    .map(
      (channel) => `<tr>
        <td>${escapeHtml(channel.channel)}</td>
        <td>${escapeHtml(channel.label || "—")}</td>
      </tr>`,
    )
    .join("");
}

async function loadStatus() {
  if (statusLoading) return;
  statusLoading = true;
  try {
    const query = currentPage === "live-mix" && selectedAux ? "?aux=" + encodeURIComponent(selectedAux) : "";
    const response = await adminFetch("/api/admin/status" + query);
    if (!response.ok) {
      throw new Error("Request failed");
    }
    renderStatus(await response.json());
  } catch {
    loadingEl.hidden = true;
    contentEl.hidden = true;
    errorEl.hidden = false;
    setAdminConnection(false);
  } finally {
    statusLoading = false;
  }
}

copyUrlBtn.addEventListener("click", async () => {
  if (!currentUrl) {
    return;
  }

  try {
    await navigator.clipboard.writeText(currentUrl);
    copyUrlBtn.innerHTML = appIcon("check") + " Copied";
    setTimeout(() => {
      copyUrlBtn.innerHTML = appIcon("copy") + " Copy";
    }, 1500);
  } catch {
    copyUrlBtn.innerHTML = appIcon("x") + " Copy failed";
    setTimeout(() => {
      copyUrlBtn.innerHTML = appIcon("copy") + " Copy";
    }, 1500);
  }
});

auxMenuEl.addEventListener("change", () => selectAux(auxMenuEl.value));

panToggleEl.addEventListener("change", () => {
  showPan = panToggleEl.checked;
  sessionStorage.setItem("adminShowPan", String(showPan));
  renderLiveMix();
});

sidebarNavEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button) {
    return;
  }
  showPage(button.dataset.page);
});

sidebarToggleEl.addEventListener("click", () => {
  const open = document.body.classList.toggle("sidebar-open");
  document.getElementById("sidebarBackdrop").hidden = !open;
  sidebarToggleEl.setAttribute("aria-expanded", String(open));
});

window.addEventListener("hashchange", () => {
  const page = window.location.hash.replace("#", "");
  if (page && page !== currentPage) {
    showPage(page);
  }
});

showPage(currentPage);
bindFoldable(liveMixFoldEl, "adminLiveMixFold");
loadStatus();
setInterval(loadStatus, 2000);
window.addEventListener("pageshow", event => {
  if (event.persisted) { contentEl.hidden = true; void loadStatus(); }
});

function setAdminConnection(connected, deskReady = true) {
  const status = document.getElementById("adminConnection");
  status.classList.toggle("online", connected && deskReady);
  status.lastElementChild.textContent = connected ? (deskReady ? "Connected" : "Waiting for desk…") : "Reconnecting…";
}
function closeAdminNavigation() {
  document.body.classList.remove("sidebar-open");
  document.getElementById("sidebarBackdrop").hidden = true;
  sidebarToggleEl.setAttribute("aria-expanded", "false");
}
document.getElementById("sidebarBackdrop").addEventListener("click", closeAdminNavigation);
document.addEventListener("keydown", event => { if (event.key === "Escape") closeAdminNavigation(); });
const adminListView = document.getElementById("adminListView");
const adminGridView = document.getElementById("adminGridView");
function setAdminView(view) {
  const grid = view === "grid";
  document.body.classList.toggle("grid-view", grid);
  adminListView.setAttribute("aria-pressed", String(!grid)); adminGridView.setAttribute("aria-pressed", String(grid));
}
adminListView.addEventListener("click", () => { localStorage.setItem("adminChannelView", "list"); setAdminView("list"); });
adminGridView.addEventListener("click", () => { localStorage.setItem("adminChannelView", "grid"); setAdminView("grid"); });
setAdminView(localStorage.getItem("adminChannelView") || "list");

document.addEventListener("desk-settings-saved", () => { void loadStatus(); });
