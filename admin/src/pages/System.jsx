import { useState } from "preact/hooks";
import { api } from "../api.js";
import { useAction } from "../hooks.js";
import { Button, Message, Panel } from "../ui.jsx";

function Password({ enabled, reload }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, message, run, setMessage } = useAction();
  const clear = () => { setCurrent(""); setNext(""); setConfirm(""); };
  const save = async event => {
    event.preventDefault();
    if (next !== confirm) { setMessage({ text: "The new passwords do not match.", error: true }); return; }
    const done = await run(() => api("/api/admin/password", { method: "PUT", body: { currentPassword: current, password: next } }),
      enabled ? "Password changed." : "Password set. The dashboard now asks for it.");
    if (done) { clear(); await reload(); }
  };
  const remove = async () => {
    if (!current) { setMessage({ text: "Enter the current password to remove it.", error: true }); return; }
    if (!window.confirm("Remove the admin password? Anyone on this network will be able to open the dashboard.")) return;
    const done = await run(() => api("/api/admin/password", { method: "DELETE", body: { currentPassword: current } }),
      "Password removed. The dashboard is now open to anyone on this network.");
    if (done) { clear(); await reload(); }
  };
  const signOut = async () => {
    if (await run(() => api("/api/admin/logout", { method: "POST" }))) window.location.replace("/admin-login.html");
  };
  return <Panel title="Admin password" className="grow-2" actions={enabled ? <Button disabled={busy} onClick={signOut}>Sign out</Button> : null}>
    <p className="muted">{enabled ? "The dashboard asks for this password." : "No password is set. Anyone on this network can open the dashboard and change settings."}</p>
    <form className="stack" onSubmit={save}>
      {enabled ? <label className="field">Current password
        <input type="password" autoComplete="current-password" maxLength={256} required value={current} onInput={event => setCurrent(event.currentTarget.value)} />
      </label> : null}
      <label className="field">New password
        <input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={next} onInput={event => setNext(event.currentTarget.value)} />
        <span>Use at least 8 characters.</span>
      </label>
      <label className="field">Confirm new password
        <input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={confirm} onInput={event => setConfirm(event.currentTarget.value)} />
      </label>
      <div className="actions">
        <Button kind="primary" type="submit" disabled={busy}>{enabled ? "Change password" : "Set password"}</Button>
        {enabled ? <Button kind="danger" disabled={busy} onClick={remove}>Remove password</Button> : null}
      </div>
    </form>
    <Message message={message} />
  </Panel>;
}

export function System({ status, reload }) {
  return <div className="row">
    <Password enabled={status.adminPasswordEnabled} reload={reload} />
    <Panel title="About" className="grow-1">
      <dl className="facts">
        <dt>Version</dt><dd className="mono">{status.version}</dd>
        <dt>Mixer link</dt><dd className="mono wrap">{status.url}</dd>
        <dt>Desk</dt><dd>{status.loaded ? (status.desk?.label || "Connected") : "Waiting for desk"}</dd>
        <dt>Snapshot</dt><dd>{status.snapshot || "—"}</dd>
        <dt>Shown</dt><dd>{status.aux.length} AUX mixes, {status.channels.length} channels</dd>
      </dl>
    </Panel>
  </div>;
}
