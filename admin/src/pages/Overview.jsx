import { useState } from "preact/hooks";
import { api } from "../api.js";
import { useAction } from "../hooks.js";
import { activity, ago, changeText, clientName } from "../format.mjs";
import { AuxLabel, Button, Empty, Message, Panel, Table } from "../ui.jsx";

function ConnectPanel({ status, access, reload }) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const { busy, message, run, setMessage } = useAction();
  const copy = async () => {
    try { await navigator.clipboard.writeText(status.url); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setMessage({ text: "Could not copy. Select the link and copy it.", error: true }); }
  };
  const save = async event => {
    event.preventDefault();
    const saved = await run(() => api("/api/admin/mixer-url", { method: "PUT", body: { url } }), "Mixer link and QR code updated.");
    if (saved) { setEditing(false); await reload(); }
  };
  const actions = <>
    <Button onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>
    <Button onClick={() => { setUrl(status.customMixerUrl || ""); setEditing(!editing); }}>{editing ? "Cancel" : "Change link"}</Button>
  </>;
  return <Panel title="Connect a phone" actions={actions} className="grow-2">
    <div className="connect">
      <img className="qr" src={status.qr} alt="QR code for the mixer link" width="128" height="128" />
      <dl className="facts">
        <dt>Link</dt><dd className="mono wrap">{status.url}</dd>
        <dt>PIN</dt><dd className="mono">{access?.enabled ? <span className="pin-inline">{access.pin.slice(0, 3)} {access.pin.slice(3)}</span> : "Not required"}</dd>
      </dl>
    </div>
    {editing ? <form className="inline-form" onSubmit={save}>
      <label className="field grow">Custom mixer link
        <input value={url} onInput={event => setUrl(event.currentTarget.value)} placeholder="http://192.168.1.20:8082" disabled={busy} />
        <span>Used for the link and QR code. Leave blank to use the server address.</span>
      </label>
      <Button kind="primary" type="submit" disabled={busy}>Save link</Button>
    </form> : null}
    <Message message={message} />
  </Panel>;
}

function Attention({ status, access }) {
  const items = [];
  if (status.desk && !status.desk.supported) items.push({ tone: "warn", title: status.desk.label + " detected", text: "This desk answered at the desk address, but EarsMixer cannot control X32 and M32 mixes yet.", href: "#desk-settings", link: "Desk settings" });
  else if (!status.loaded) items.push({ tone: "warn", title: "Waiting for the desk", text: "EarsMixer has not loaded channels from the desk yet. Check the desk address.", href: "#desk-settings", link: "Desk settings" });
  if (!status.adminPasswordEnabled) items.push({ tone: "warn", title: "No admin password", text: access?.enabled
    ? "Anyone on this network can open this dashboard and read the PIN."
    : "Anyone on this network can open this dashboard and change settings.", href: "#system", link: "Set password" });
  if (access && !access.enabled) items.push({ tone: "muted", title: "No connection PIN", text: "Anyone on this network can connect to the mixer.", href: "#clients", link: "Mobile access" });
  return <Panel title="Needs attention" meta={items.length ? String(items.length) : ""} flush className="grow-1">
    {items.length ? <ul className="attention">
      {items.map(item => <li key={item.title}>
        <span className={"dot dot-" + item.tone}></span>
        <div className="grow"><div className="strong">{item.title}</div><div className="muted small">{item.text}</div></div>
        <a href={item.href}>{item.link}</a>
      </li>)}
    </ul> : <Empty>Nothing needs attention.</Empty>}
  </Panel>;
}

export function Overview({ status, access, reload }) {
  const log = activity(status, 200);
  const rows = status.aux.map(aux => {
    const people = status.clients.filter(client => client.aux === aux.channel);
    return { aux, people, last: log.find(entry => entry.aux === aux.channel && entry.type !== "aux") };
  });
  const inUse = rows.filter(row => row.people.length).length;
  return <>
    <div className="row">
      <ConnectPanel status={status} access={access} reload={reload} />
      <Attention status={status} access={access} />
    </div>
    <Panel title="AUX mixes" meta={status.aux.length + " shown · " + inUse + " in use"} flush actions={<a className="panel-link" href="#live-mix">Open live mix</a>}>
      {rows.length ? <Table minWidth={620} rowKey={row => row.aux.channel} rows={rows} columns={[
        { title: "AUX mix", render: row => <AuxLabel label={row.aux.label} colour={row.aux.colour} /> },
        { title: "On this mix", render: row => row.people.length ? row.people.map(clientName).join(", ") : <span className="muted">No one</span> },
        { title: "Last change", mono: true, render: row => row.last ? changeText(row.last) : <span className="muted">—</span> },
        { title: "When", mono: true, render: row => <span className="muted">{row.last ? ago(row.last.at) : "—"}</span> },
      ]} /> : <Empty>{status.loaded ? "No AUX mixes are shown to musicians." : "Waiting for the desk…"}</Empty>}
    </Panel>
  </>;
}
