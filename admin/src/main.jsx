import { render } from "preact";
import { useState } from "preact/hooks";
import "./styles.css";
import { useHashPage, usePolled } from "./hooks.js";
import { Icon } from "./ui.jsx";
import { Overview } from "./pages/Overview.jsx";
import { LiveMix } from "./pages/LiveMix.jsx";
import { Clients } from "./pages/Clients.jsx";
import { Templates } from "./pages/Templates.jsx";
import { DeskSettings } from "./pages/DeskSettings.jsx";
import { System } from "./pages/System.jsx";

const pages = {
  overview: { title: "Overview", text: "Desk, access and who is on each mix.", icon: "overview" },
  "live-mix": { title: "Live mix", text: "Every musician's sends at a glance. Read only.", icon: "live" },
  clients: { title: "Clients", text: "Who can connect and what they changed.", icon: "clients" },
  templates: { title: "Templates", text: "Starting layouts musicians can load in the app.", icon: "templates" },
  "desk-settings": { title: "Desk settings", text: "How EarsMixer reaches the desk and what musicians can see.", icon: "desk" },
  system: { title: "System", text: "Admin password and version.", icon: "system" },
};
const nav = [
  ["Monitor", ["overview", "live-mix"]],
  ["Access", ["clients"]],
  ["Setup", ["templates", "desk-settings", "system"]],
];

function StatusCell({ label, value, tone }) {
  return <div className="status-cell">
    <span className="eyebrow">{label}</span>
    <span className="status-value">{tone ? <span className={"dot dot-" + tone}></span> : null}{value}</span>
  </div>;
}

function App() {
  const page = useHashPage(Object.keys(pages), "overview");
  const [selectedAux, setSelectedAux] = useState(() => Number(sessionStorage.getItem("adminSelectedAux")) || null);
  const selectAux = aux => { sessionStorage.setItem("adminSelectedAux", String(aux)); setSelectedAux(aux); };
  const status = usePolled(() => "/api/admin/status" + (page === "live-mix" && selectedAux ? "?aux=" + selectedAux : ""), 2000, [page, selectedAux]);
  const access = usePolled("/api/admin/access", 5000);
  const data = status.data;
  let host = "";
  try { host = data ? new URL(data.url).host : ""; } catch { host = data?.url || ""; }
  return <div className="shell">
    <nav className="sidebar" aria-label="Admin">
      <div className="brand">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <line x1="5" y1="4" x2="5" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="19" y1="4" x2="19" y2="20" />
          <line x1="2.5" y1="9" x2="7.5" y2="9" /><line x1="9.5" y1="15" x2="14.5" y2="15" /><line x1="16.5" y1="7" x2="21.5" y2="7" />
        </svg>
        <span>EarsMixer</span>
      </div>
      <div className="nav-groups">
        {nav.map(([section, items]) => <div className="nav-group" key={section}>
          <div className="eyebrow nav-title">{section}</div>
          {items.map(id => <a key={id} href={"#" + id} className={"nav-item" + (id === page ? " active" : "")} aria-current={id === page ? "page" : undefined}>
            <Icon name={pages[id].icon} /><span>{pages[id].title}</span>
          </a>)}
        </div>)}
      </div>
      <div className="version mono">{data ? "v" + data.version : ""}</div>
    </nav>
    <div className="content">
      <div className="status-strip" role="status" aria-label="System status">
        <StatusCell label="Desk" value={!data ? "…" : data.loaded ? (data.desk?.label || "Connected") : "Waiting for desk"} tone={!data ? null : data.loaded ? "ok" : "warn"} />
        <StatusCell label="Snapshot" value={data?.snapshot || "—"} />
        <StatusCell label="Devices" value={data ? data.connections + " connected" : "…"} />
        <StatusCell label="Access" value={!access.data ? "…" : access.data.enabled ? "PIN required" : "Open"} tone={access.data?.enabled ? "accent" : null} />
        <StatusCell label="Server" value={host || "…"} />
      </div>
      <main>
        <header className="page-head">
          <h1>{pages[page].title}</h1>
          <p className="muted">{pages[page].text}</p>
        </header>
        {status.error && data ? <p className="banner" role="alert">Connection to the server lost. Reconnecting…</p> : null}
        {!data ? <p className="empty">{status.error || "Loading…"}</p>
          : page === "overview" ? <Overview status={data} access={access.data} reload={status.reload} />
          : page === "live-mix" ? <LiveMix status={data} selectedAux={selectedAux} onSelect={selectAux} reload={status.reload} />
          : page === "clients" ? <Clients status={data} access={access.data} reloadAccess={access.reload} />
          : page === "templates" ? <Templates status={data} />
          : page === "desk-settings" ? <DeskSettings status={data} reload={status.reload} />
          : <System status={data} reload={status.reload} />}
      </main>
    </div>
  </div>;
}

render(<App />, document.getElementById("app"));
