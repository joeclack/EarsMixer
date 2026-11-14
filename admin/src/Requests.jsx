import { useEffect } from "preact/hooks";
import { api } from "./api.js";
import { ago } from "./format.mjs";
import { Button, Panel } from "./ui.jsx";

// Requests from musicians, shown above every page until the engineer has seen
// them. Acknowledged ones stay listed, dimmed, for ten minutes.
export function Requests({ requests, reload }) {
  const now = Date.now();
  const open = (requests || []).filter(item => !item.acknowledgedAt);
  const recent = (requests || []).filter(item => item.acknowledgedAt && now - item.acknowledgedAt < 600000);
  useEffect(() => {
    document.title = (open.length ? "(" + open.length + ") " : "") + "EarsMixer admin";
  }, [open.length]);
  if (!open.length && !recent.length) return null;
  const acknowledge = async id => { await api("/api/admin/requests/" + id + "/acknowledge", { method: "POST" }).catch(() => null); reload(); };
  const close = async id => { await api("/api/admin/requests/" + id, { method: "DELETE" }).catch(() => null); reload(); };
  const clearAll = async () => { await api("/api/admin/requests", { method: "DELETE" }).catch(() => null); reload(); };
  return <Panel className={"requests" + (open.length ? " requests-open" : "")} title={open.length ? "Musician requests" : "Recent requests"}
    meta={open.length ? open.length + " waiting" : null} actions={<Button onClick={clearAll}>Clear</Button>}>
    <ul className="request-list" aria-live="polite">
      {[...open, ...recent].map(item => <li key={item.id} className={"request" + (item.acknowledgedAt ? " request-seen" : "")}>
        <div className="grow">
          {/* Messages are typed by the musician; older quick requests show their label. */}
          <div className="wrap">{item.kind ? <><span className="strong">{item.label}</span>{item.text ? <span> — {item.text}</span> : null}</> : <span className="strong">{item.text}</span>}</div>
          <div className="muted small">{(item.name || "Unnamed device") + (item.auxLabel ? " · " + item.auxLabel : "") + " · " + ago(item.at, now)}</div>
        </div>
        {item.acknowledgedAt ? <span className="muted small">Seen</span>
          : <Button kind="primary" onClick={() => acknowledge(item.id)}>Got it</Button>}
        <button type="button" className="request-close" aria-label={"Close request from " + (item.name || "unnamed device")} onClick={() => close(item.id)}>×</button>
      </li>)}
    </ul>
  </Panel>;
}
