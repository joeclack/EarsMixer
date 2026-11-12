import { api } from "../api.js";
import { useAction } from "../hooks.js";
import { activity, ago, changeText, clock } from "../format.js";
import { AuxLabel, Button, Empty, Message, Panel, Table, Tag } from "../ui.jsx";

export function Clients({ status, access, reloadAccess }) {
  const { busy, message, run, setMessage } = useAction();
  const act = (request, success) => run(async () => { await request(); await reloadAccess(); }, success);
  const toggle = event => {
    const enabled = event.currentTarget.checked;
    if (enabled && !window.confirm("Require a PIN? Everyone connected now will be disconnected until they enter the PIN.")) { event.currentTarget.checked = false; return; }
    void act(() => api("/api/admin/access", { method: "PUT", body: { enabled } }), enabled ? "PIN required. Share it with your musicians." : "PIN no longer required.");
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(access.pin); setMessage({ text: "PIN copied.", error: false }); }
    catch { setMessage({ text: "Could not copy. The PIN is " + access.pin + ".", error: true }); }
  };
  const changePin = () => {
    if (window.confirm("Change the PIN? Every device will be signed out and will need the new PIN.")) void act(() => api("/api/admin/access/pin", { method: "POST" }), "PIN changed. Every device was signed out.");
  };
  const revokeAll = () => {
    if (window.confirm("Sign out all devices? They will need the PIN to reconnect.")) void act(() => api("/api/admin/access/revoke-all", { method: "POST" }), "All devices signed out.");
  };
  const remove = (device, forget) => {
    const name = device.name || "this device";
    if (forget && !window.confirm("Forget " + name + "? It will need the PIN again to connect.")) return;
    void act(() => api("/api/admin/access/devices/" + encodeURIComponent(device.id) + (forget ? "?forget=1" : ""), { method: "DELETE" }),
      forget ? "Forgot " + name + "." : "Signed out " + name + ". It will need the PIN to reconnect.");
  };
  if (!access) return <Panel title="Mobile access"><Empty>Loading…</Empty></Panel>;

  // Known devices, plus connections that did not identify a device.
  const sockets = status.clients;
  const rows = access.devices.map(device => ({ device, client: sockets.find(client => client.deviceId === device.id) }));
  for (const client of sockets) if (!client.deviceId) rows.push({ device: null, client });
  const auxOf = client => status.aux.find(aux => aux.channel === client?.aux);
  const statusTag = row => row.client || row.device?.online ? <Tag tone="ok">Connected</Tag>
    : !access.enabled ? <Tag>Seen</Tag> : row.device.paired ? <Tag>Signed in</Tag> : <Tag tone="warn">Needs PIN</Tag>;
  const connected = rows.filter(row => row.client || row.device?.online).length;
  const log = activity(status, 30);
  return <>
    <Panel title="Mobile access" actions={access.enabled ? <Button kind="danger" disabled={busy} onClick={revokeAll}>Sign out all devices</Button> : null}>
      <div className="access">
        <label className="check grow">
          <input type="checkbox" checked={access.enabled} disabled={busy} onChange={toggle} />
          <span><span className="strong">Require a PIN to connect</span><br /><span className="muted small">Devices enter it once and stay signed in until you change it.</span></span>
        </label>
        {access.enabled ? <div className="pin-box">
          <span className="eyebrow">PIN</span>
          <output className="pin" aria-live="polite">{access.pin.slice(0, 3)} {access.pin.slice(3)}</output>
          <Button disabled={busy} onClick={copy}>Copy</Button>
          <Button disabled={busy} onClick={changePin}>Change PIN</Button>
        </div> : null}
      </div>
      <Message message={message} />
    </Panel>
    <Panel title="Devices" meta={rows.length + " known · " + connected + " connected"} flush>
      {rows.length ? <Table minWidth={860} rowKey={row => row.device?.id || "socket-" + row.client.id} rows={rows} columns={[
        { title: "Device", render: row => row.device?.name || row.client?.username || <span className="muted">Unnamed device</span> },
        { title: "Status", render: statusTag },
        { title: "AUX mix", render: row => auxOf(row.client) ? <AuxLabel label={auxOf(row.client).label} colour={auxOf(row.client).colour} /> : <span className="muted">—</span> },
        { title: "Address", mono: true, render: row => (row.client?.address || row.device?.lastAddress || "—").replace(/^::ffff:/, "") },
        { title: "Device ID", mono: true, render: row => row.device ? row.device.id.slice(0, 8) : <span className="muted">none</span> },
        { title: "Last seen", mono: true, render: row => row.client ? "now" : ago(row.device.lastSeen) },
        { title: "", render: row => row.device ? <span className="actions">
          {row.device.paired ? <Button disabled={busy} aria-label={"Sign out " + (row.device.name || "this device")} onClick={() => remove(row.device, false)}>Sign out</Button> : null}
          <Button disabled={busy} aria-label={"Forget " + (row.device.name || "this device")} onClick={() => remove(row.device, true)}>Forget</Button>
        </span> : null },
      ]} /> : <Empty>No devices have connected yet.</Empty>}
      <p className="panel-note">Each device is recognised by an ID its app creates, so it stays the same when its IP address changes.</p>
    </Panel>
    <Panel title="Activity" flush>
      {log.length ? <Table rows={log} columns={[
        { title: "Time", mono: true, render: entry => clock(entry.at) },
        { title: "Device", render: entry => entry.name },
        { title: "AUX mix", render: entry => entry.auxLabel || "AUX " + entry.aux },
        { title: "Change", mono: true, render: entry => changeText(entry) },
      ]} /> : <Empty>No changes yet.</Empty>}
    </Panel>
  </>;
}
