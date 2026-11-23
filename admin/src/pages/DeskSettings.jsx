import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api.js";
import { useAction } from "../hooks.js";
import { clientName } from "../format.mjs";
import { iconPath, instrumentIcons } from "../icons.js";
import { CHANNEL_COLOURS, CHANNEL_NEUTRALS, channelColourName } from "../../../lib/channel-colours.js";
import { arrowMove, useSortable } from "../sortable.js";
import { move } from "../templates-model.mjs";
import { Button, Empty, Grip, Message, Panel } from "../ui.jsx";

const sections = [["connection", "Connection"], ["aux", "AUX mixes"], ["channels", "Channels"], ["links", "Linked channels"], ["external", "External devices"], ["presets", "Presets"]];
const validPort = value => /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 65535;

async function loadSettings() {
  const [config, aux, channels] = await Promise.all([api("/config"), api("/aux"), api("/channels")]);
  return {
    serverName: config.server.name || "", serverIp: config.server.ip, serverPort: String(config.server.port), oscPort: String(config.osc.port),
    deskIp: config.desk.ip || "", deskPort: String(config.desk.port || 9000), debug: config.debug === true,
    externals: (config.externalDevices || []).map(device => ({ name: device.name, ip: device.ip, port: String(device.port), broadcast: !!device.broadcast, loopback: !!device.loopback })),
    aux: aux.map((entry, index) => ({ number: index + 1, enabled: entry.enabled, name: entry.name, colour: entry.colour, icon: entry.icon || "" })),
    channels: channels.map((entry, index) => ({ number: index + 1, enabled: entry.enabled, name: entry.name, order: entry.order, title: entry.title || "", colour: entry.colour || "", icon: entry.icon || "" }))
      .sort((a, b) => a.order - b.order),
  };
}
// The settings route takes the same form fields the desk settings page has always sent.
function formBody(form) {
  const body = new URLSearchParams();
  body.set("server_name", form.serverName.trim());
  body.set("server_port", form.serverPort); body.set("osc_port", form.oscPort);
  body.set("desk_ip", form.deskIp.trim()); body.set("desk_port", form.deskPort);
  if (form.debug) body.set("debug", "debug");
  for (const device of form.externals) {
    body.append("externalName[]", device.name); body.append("externalIP[]", device.ip.trim()); body.append("externalReceive[]", device.port);
    body.append("externalBroadcast[]", String(device.broadcast)); body.append("externalLoopback[]", String(device.loopback));
  }
  for (const aux of form.aux) {
    body.append("auxEnabled[]", String(aux.enabled)); body.append("auxName[]", aux.name);
    body.append("auxColour[]", aux.colour); body.append("auxIcon[]", aux.icon);
  }
  // Channels are sent in desk order; channelOrder carries each one's place in the list.
  const position = new Map(form.channels.map((channel, index) => [channel.number, index + 1]));
  for (const channel of [...form.channels].sort((a, b) => a.number - b.number)) {
    body.append("channelEnabled[]", String(channel.enabled)); body.append("channelName[]", channel.name);
    body.append("channelOrder[]", String(position.get(channel.number))); body.append("channelIcon[]", channel.icon);
    body.append("sectionTitle[]", channel.title); body.append("channelColour[]", channel.colour);
  }
  return body;
}

function IconPicker({ value, label, onChange }) {
  const dialog = useRef(null);
  const choose = icon => { onChange(icon); dialog.current.close(); };
  return <>
    <button type="button" className="icon-button" aria-label={label + (value ? "" : ", none chosen")} onClick={() => dialog.current.showModal()}>
      {value ? <img src={value} alt="" width="24" height="24" /> : <span className="muted small">None</span>}
    </button>
    <dialog ref={dialog} className="icon-dialog" aria-label={label}>
      <div className="panel-head"><h2>Choose an icon</h2><Button onClick={() => choose("")}>No icon</Button><Button onClick={() => dialog.current.close()}>Close</Button></div>
      <div className="icon-grid">
        {instrumentIcons.map(name => <button type="button" key={name} aria-label={name.replace(/[-_]/g, " ")} aria-pressed={value.endsWith(iconPath(name)) ? "true" : "false"} onClick={() => choose(iconPath(name))}>
          <img src={iconPath(name)} alt="" width="36" height="36" loading="lazy" />
        </button>)}
      </div>
    </dialog>
  </>;
}
// Channel colours come from a fixed palette: each colour's light, main and dark
// versions in a column, with white and black in a last column.
function ColourPicker({ value, label, onChange }) {
  const dialog = useRef(null);
  const choose = colour => { onChange(colour); dialog.current.close(); };
  const currentName = channelColourName(value);
  const swatch = hex => <button type="button" key={hex} className="colour-swatch" style={{ background: hex }} aria-label={channelColourName(hex)} title={channelColourName(hex)}
    aria-pressed={value === hex ? "true" : "false"} onClick={() => choose(hex)} />;
  return <>
    <button type="button" className={"colour-button" + (value ? "" : " colour-unset")} style={value ? { background: value } : undefined}
      aria-label={label + ", " + (currentName || "none chosen")} title={currentName || "No colour"} onClick={() => dialog.current.showModal()} />
    <dialog ref={dialog} className="icon-dialog colour-dialog" aria-label={label}>
      <div className="panel-head"><h2>Choose a colour</h2><Button onClick={() => choose("")}>No colour</Button><Button onClick={() => dialog.current.close()}>Close</Button></div>
      <div className="colour-grid">
        {CHANNEL_COLOURS.map(colour => <div key={colour.name} className="colour-column">
          {[colour.light, colour.main, colour.dark].map(swatch)}
          <span className="small muted">{colour.name}</span>
        </div>)}
        <div className="colour-column">
          {CHANNEL_NEUTRALS.map(colour => swatch(colour.value))}
          <span className="small muted">Mono</span>
        </div>
      </div>
    </dialog>
  </>;
}
function Check({ checked, label, onChange }) {
  return <input type="checkbox" checked={checked} aria-label={label} onChange={event => onChange(event.currentTarget.checked)} />;
}
function Field({ label, hint, className = "", ...props }) {
  return <label className={"field " + className}>{label}<input {...props} />{hint ? <span>{hint}</span> : null}</label>;
}

function Presets({ onLoaded, disabled }) {
  const [presets, setPresets] = useState(null);
  const [name, setName] = useState("");
  const { busy, message, run } = useAction();
  const refresh = () => api("/api/presets").then(setPresets);
  useEffect(() => { void run(refresh); }, []);
  const save = async event => {
    event.preventDefault();
    if (await run(() => api("/api/presets/save-current-state", { method: "POST", body: { name: name.trim() } }), "Preset saved.")) { setName(""); await refresh(); }
  };
  const load = async preset => {
    if (!window.confirm("Load preset “" + preset.name + "”? It replaces which AUX mixes and channels are shown, and reconnects every device.")) return;
    if (await run(() => api("/api/presets/" + encodeURIComponent(preset.uuid) + "/load", { method: "POST" }), "Loaded “" + preset.name + "”.")) await onLoaded();
  };
  const remove = async preset => {
    if (!window.confirm("Delete preset “" + preset.name + "”?")) return;
    if (await run(() => api("/api/presets/" + encodeURIComponent(preset.uuid), { method: "DELETE" }), "Deleted “" + preset.name + "”.")) await refresh();
  };
  return <Panel title="Presets" flush>
    <p className="hint">A preset stores which AUX mixes and channels are shown, with their colours, icons and order. It saves the settings currently in use, not unsaved edits.</p>
    <form className="inline-form padded" onSubmit={save}>
      <Field label="New preset name" className="grow" value={name} maxLength={80} required onInput={event => setName(event.currentTarget.value)} />
      <Button kind="primary" type="submit" disabled={busy || disabled || !name.trim()}>Save preset</Button>
    </form>
    <div className="message-row"><Message message={message} /></div>
    {presets === null ? <Empty>Loading…</Empty> : presets.length ? <ul className="preset-list">
      {presets.map(preset => <li key={preset.uuid}>
        <span className="grow"><span className="strong">{preset.name}</span><br /><span className="muted small mono">{preset.lastChanged ? new Date(preset.lastChanged).toLocaleString() : ""}</span></span>
        <Button disabled={busy || disabled} onClick={() => load(preset)}>Load</Button>
        <a className="button button-plain" href={"/api/presets/" + encodeURIComponent(preset.uuid) + "/download"}>Download</a>
        <Button kind="danger" disabled={busy} onClick={() => remove(preset)}>Delete</Button>
      </li>)}
    </ul> : <Empty>No presets yet.</Empty>}
  </Panel>;
}

// A link's suggested name: the first channel's name without a trailing left or right, so "Gtr 1 L" becomes "Gtr 1".
const pairName = label => label.replace(/[\s_-]+\(?(?:l|r|left|right)\)?$/i, "").trim() || label;

function LinkedChannels({ disabled }) {
  const [data, setData] = useState(null);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [name, setName] = useState("");
  const [named, setNamed] = useState(false);
  const { busy, message, run } = useAction();
  const refresh = () => api("/api/admin/links").then(setData);
  useEffect(() => { void run(refresh); }, []);
  const linked = new Set((data?.links || []).flatMap(link => link.channels));
  const free = (data?.channels || []).filter(channel => !linked.has(channel.channel));
  const label = number => data?.channels.find(channel => channel.channel === Number(number))?.label ?? "";
  const chooseFirst = value => { setFirst(value); if (!named) setName(value ? pairName(label(value)) : ""); };
  const create = async event => {
    event.preventDefault();
    if (await run(() => api("/api/admin/links", { method: "POST", body: { name: name.trim(), channels: [Number(first), Number(second)] } }),
      "Linked. Both channels now share the same level, and devices are reconnecting.")) {
      setFirst(""); setSecond(""); setName(""); setNamed(false); await refresh();
    }
  };
  const remove = async link => {
    if (!window.confirm("Unlink “" + link.name + "”? Musicians get a fader for each channel again, starting at their current levels. Devices reconnect for a moment.")) return;
    if (await run(() => api("/api/admin/links/" + encodeURIComponent(link.id), { method: "DELETE" }), "Unlinked “" + link.name + "”.")) await refresh();
  };
  const option = channel => <option key={channel.channel} value={channel.channel}>{String(channel.channel).padStart(2, "0")} {channel.label}</option>;
  return <Panel title="Linked channels" meta={data ? data.links.length + " linked" : ""} flush>
    <p className="hint">Link two channels, such as a guitar’s left and right, and musicians get one fader for both. Linking sets both channels to the level halfway between them in every mix, then keeps their levels and mutes together. Pan stays separate, so a stereo pair keeps its left and right.</p>
    <form className="inline-form padded" onSubmit={create}>
      <label className="field grow">First channel<select value={first} required disabled={disabled} onChange={event => chooseFirst(event.currentTarget.value)}>
        <option value="">Choose…</option>{free.map(option)}</select></label>
      <label className="field grow">Second channel<select value={second} required disabled={disabled} onChange={event => setSecond(event.currentTarget.value)}>
        <option value="">Choose…</option>{free.filter(channel => channel.channel !== Number(first)).map(option)}</select></label>
      <Field label="Name musicians see" className="grow" value={name} maxLength={40} required placeholder="Guitar 1" disabled={disabled}
        onInput={event => { setName(event.currentTarget.value); setNamed(true); }} />
      <Button kind="primary" type="submit" disabled={busy || disabled || !first || !second || !name.trim()}>Link channels</Button>
    </form>
    {disabled ? <p className="hint">Save or discard your other changes first.</p> : null}
    <div className="message-row"><Message message={message} /></div>
    {data === null ? <Empty>Loading…</Empty> : data.links.length ? <ul className="preset-list">
      {data.links.map(link => <li key={link.id}>
        <span className="grow"><span className="strong">{link.name}</span><br />
          <span className="muted small">{link.channels.map((channel, index) => String(channel).padStart(2, "0") + " " + link.labels[index]).join(" + ")}</span></span>
        <Button kind="danger" disabled={busy || disabled} onClick={() => remove(link)}>Unlink</Button>
      </li>)}
    </ul> : <Empty>{data.channels.length ? "No linked channels." : "Waiting for the desk to report its channels."}</Empty>}
  </Panel>;
}

export function DeskSettings({ status, reload }) {
  const [section, setSection] = useState(() => sessionStorage.getItem("adminDeskSection") || "connection");
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState("");
  const { busy, message, run, setMessage } = useAction();
  const channelList = useRef(null);
  const load = async () => { const next = await loadSettings(); setForm(next); setSaved(JSON.stringify(next)); };
  useEffect(() => { void run(load); }, []);
  // Pick up channels and AUX mixes once the desk has loaded, unless there are edits to keep.
  const dirty = form !== null && JSON.stringify(form) !== saved;
  useEffect(() => { if (form && !dirty && status.loaded && !form.channels.length) void load().catch(() => {}); }, [status.loaded]);
  const moveChannel = (from, to) => setForm(current => ({ ...current, channels: move(current.channels, from, to) }));
  useSortable(channelList, ".grip-top", moveChannel, !!form && section === "channels" && form.channels.length > 0);
  const choose = id => { sessionStorage.setItem("adminDeskSection", id); setSection(id); };
  if (!form) return <Panel title="Desk settings"><Empty>{message.text || "Loading…"}</Empty></Panel>;

  const set = patch => setForm(current => ({ ...current, ...patch }));
  const setRow = (key, index, patch) => setForm(current => ({ ...current, [key]: current[key].map((row, at) => at === index ? { ...row, ...patch } : row) }));
  const setAll = (key, change) => setForm(current => ({ ...current, [key]: current[key].map(row => ({ ...row, enabled: change(row.enabled) })) }));
  const problem = () => {
    if (new TextEncoder().encode(form.serverName.trim()).length > 63) return ["connection", "Shorten the server name. Some characters, such as emoji, count as more than one."];
    if (!form.deskIp.trim()) return ["connection", "Enter the desk's IP address."];
    if (![form.serverPort, form.oscPort, form.deskPort].every(validPort)) return ["connection", "Ports must be numbers between 1 and 65535."];
    const device = form.externals.find(entry => !entry.name.trim() || !entry.ip.trim() || !validPort(entry.port));
    if (device) return ["external", "Each external device needs a name, an address and a port between 1 and 65535."];
    return null;
  };
  const save = async () => {
    const issue = problem();
    if (issue) { choose(issue[0]); setMessage({ text: issue[1], error: true }); return; }
    await run(async () => {
      const response = await fetch("/admin", { method: "POST", cache: "no-store", body: formBody(form) });
      if (response.status === 401) { window.location.replace("/admin-login.html#desk-settings"); throw new Error("Enter the admin password to continue."); }
      const text = await response.text();
      // A new web port moves the dashboard; the server answers with the new address.
      const redirect = /document\.location\.href="([^"]+)"/.exec(text);
      if (redirect) { window.location.href = redirect[1]; return; }
      let body = {};
      try { body = JSON.parse(text); } catch {}
      if (!response.ok) throw new Error(body.error || "Could not save the settings. Try again.");
      await load(); await reload();
    }, "Settings saved. Devices are reconnecting.");
  };
  const peopleOn = number => status.clients.filter(client => client.aux === number).map(clientName).join(", ");
  const shown = rows => rows.filter(row => row.enabled).length + " of " + rows.length + " shown";
  const selectionActions = key => <>
    <Button onClick={() => setAll(key, () => !form[key].every(row => row.enabled))}>{form[key].every(row => row.enabled) ? "Show none" : "Show all"}</Button>
    <Button onClick={() => setAll(key, enabled => !enabled)}>Invert</Button>
  </>;
  const waiting = <Empty>{status.loaded ? "The desk reported none." : "Waiting for the desk. Check the connection settings."}</Empty>;

  return <div className="row">
    <nav className="panel sub-nav" aria-label="Desk settings sections">
      {sections.map(([id, title]) => <button type="button" key={id} className={id === section ? "selected" : ""} aria-current={id === section ? "true" : undefined} onClick={() => choose(id)}>{title}</button>)}
    </nav>
    <div className="column grow-4">
      {section === "connection" ? <Panel title="Connection">
        <div className="field-row">
          <Field label="Server name" className="grow" value={form.serverName} maxLength={63} placeholder="Computer name" onInput={event => set({ serverName: event.currentTarget.value })}
            hint="The name the app shows when it finds this server, such as Stage Left. Leave blank to use the computer name." />
        </div>
        <div className="field-row">
          <Field label="Desk IP address" className="grow" value={form.deskIp} required inputMode="decimal" onInput={event => set({ deskIp: event.currentTarget.value })}
            hint="On the console: Setup › External Control › DiGiCo iPad." />
          <Field label="Desk receive port" className="port" value={form.deskPort} inputMode="numeric" onInput={event => set({ deskPort: event.currentTarget.value })} />
          <Field label="OSC receive port" className="port" value={form.oscPort} inputMode="numeric" onInput={event => set({ oscPort: event.currentTarget.value })} hint="The desk sends to this port." />
          <Field label="Web port" className="port" value={form.serverPort} inputMode="numeric" onInput={event => set({ serverPort: event.currentTarget.value })} />
        </div>
        <div className="desk-state">
          <span className={"dot dot-" + (status.loaded ? "ok" : "warn")}></span>
          <span className="grow">{status.loaded ? "Desk is answering. " + form.channels.length + " channels and " + form.aux.length + " AUX outputs loaded." : "Waiting for the desk to answer at " + (form.deskIp || "the address above") + "."}</span>
          <span className="muted small mono">This server: {form.serverIp}</span>
        </div>
        <label className="check"><Check checked={form.debug} label="Log debug messages" onChange={debug => set({ debug })} /><span>Log debug messages</span></label>
      </Panel> : null}

      {section === "aux" ? <Panel title="AUX mixes" meta={shown(form.aux)} flush actions={selectionActions("aux")}>
        {form.aux.length ? <div className="table-scroll"><table style={{ minWidth: "680px" }}>
          <thead><tr><th scope="col">Shown</th><th scope="col">No.</th><th scope="col">Name</th><th scope="col">Colour</th><th scope="col">Icon</th><th scope="col">In use by</th></tr></thead>
          <tbody>{form.aux.map((aux, index) => <tr key={aux.number} className={aux.enabled ? "" : "row-off"}>
            <td><Check checked={aux.enabled} label={"Show AUX " + aux.number} onChange={enabled => setRow("aux", index, { enabled })} /></td>
            <td className="mono muted">{String(aux.number).padStart(2, "0")}</td>
            <td><input className="cell-input" value={aux.name} aria-label={"AUX " + aux.number + " name"} onInput={event => setRow("aux", index, { name: event.currentTarget.value })} /></td>
            <td><input type="color" value={aux.colour} aria-label={"AUX " + aux.number + " colour"} onInput={event => setRow("aux", index, { colour: event.currentTarget.value })} /></td>
            <td><IconPicker value={aux.icon} label={"AUX " + aux.number + " icon"} onChange={icon => setRow("aux", index, { icon })} /></td>
            <td>{peopleOn(aux.number) || <span className="muted">{aux.enabled ? "No one" : "Not shown to musicians"}</span>}</td>
          </tr>)}</tbody>
        </table></div> : waiting}
      </Panel> : null}

      {section === "channels" ? <Panel title="Channels" meta={shown(form.channels)} flush actions={selectionActions("channels")}>
        <p className="hint">Drag a handle to set the order musicians see. Arrow keys on a handle also move a channel. A section title starts a new heading in the browser mixer. A colour from the palette marks the channel in the mobile app.</p>
        {form.channels.length ? <ul className="desk-channels" ref={channelList}>
          {form.channels.map((channel, index) => <li key={channel.number} className={channel.enabled ? "" : "row-off"}>
            <button type="button" className="grip grip-top" aria-label={"Move channel " + channel.number + ". Use the up and down arrow keys."} onKeyDown={event => arrowMove(event, index, form.channels.length, moveChannel)}><Grip /></button>
            <span className="number">{String(channel.number).padStart(2, "0")}</span>
            <Check checked={channel.enabled} label={"Show channel " + channel.number} onChange={enabled => setRow("channels", index, { enabled })} />
            <input className="cell-input" value={channel.name} aria-label={"Channel " + channel.number + " name"} onInput={event => setRow("channels", index, { name: event.currentTarget.value })} />
            <input className="cell-input" value={channel.title} placeholder="Section title" aria-label={"Channel " + channel.number + " section title"} onInput={event => setRow("channels", index, { title: event.currentTarget.value })} />
            <span className="channel-style">
              <ColourPicker value={channel.colour} label={"Channel " + channel.number + " colour"} onChange={colour => setRow("channels", index, { colour })} />
              <IconPicker value={channel.icon} label={"Channel " + channel.number + " icon"} onChange={icon => setRow("channels", index, { icon })} />
            </span>
          </li>)}
        </ul> : waiting}
      </Panel> : null}

      {section === "external" ? <Panel title="External devices" flush actions={<Button onClick={() => set({ externals: [...form.externals, { name: "", ip: "", port: "", broadcast: true, loopback: false }] })}>Add device</Button>}>
        <p className="hint">Other OSC devices, such as a lighting desk, that should receive level changes or send their own.</p>
        {form.externals.length ? <div className="table-scroll"><table style={{ minWidth: "720px" }}>
          <thead><tr><th scope="col">Name</th><th scope="col">Address</th><th scope="col">Port</th><th scope="col">Receives changes</th><th scope="col">Echo own changes</th><th scope="col"></th></tr></thead>
          <tbody>{form.externals.map((device, index) => <tr key={index}>
            <td><input className="cell-input" value={device.name} maxLength={80} aria-label="Device name" onInput={event => setRow("externals", index, { name: event.currentTarget.value })} /></td>
            <td><input className="cell-input mono" value={device.ip} aria-label="Device address" onInput={event => setRow("externals", index, { ip: event.currentTarget.value })} /></td>
            <td><input className="cell-input mono port-input" value={device.port} inputMode="numeric" aria-label="Device port" onInput={event => setRow("externals", index, { port: event.currentTarget.value })} /></td>
            <td><Check checked={device.broadcast} label={"Send changes to " + (device.name || "this device")} onChange={broadcast => setRow("externals", index, { broadcast })} /></td>
            <td><Check checked={device.loopback} label={"Echo changes back to " + (device.name || "this device")} onChange={loopback => setRow("externals", index, { loopback })} /></td>
            <td><Button kind="danger" aria-label={"Remove " + (device.name || "this device")} onClick={() => set({ externals: form.externals.filter((_, at) => at !== index) })}>Remove</Button></td>
          </tr>)}</tbody>
        </table></div> : <Empty>No external devices.</Empty>}
      </Panel> : null}

      {section === "links" ? <LinkedChannels disabled={dirty} /> : null}

      {section === "presets" ? <Presets disabled={dirty} onLoaded={async () => { await load(); await reload(); }} /> : null}

      {dirty || message.text ? <div className={"save-bar" + (dirty ? " save-bar-dirty" : "")} role="status">
        <span className={"grow" + (message.error ? " message-error" : "")}>{message.text || <><span className="strong">Unsaved changes.</span> Saving reconnects every device for a moment.</>}</span>
        {dirty ? <><Button disabled={busy} onClick={() => { setForm(JSON.parse(saved)); setMessage({ text: "", error: false }); }}>Discard</Button>
          <Button kind="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save and reconnect"}</Button></> : null}
      </div> : null}
    </div>
  </div>;
}
