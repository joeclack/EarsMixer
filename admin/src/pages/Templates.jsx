import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api } from "../api.js";
import { useAction } from "../hooks.js";
import { Button, Empty, Grip, Icon, Message, Panel, Tag } from "../ui.jsx";

const emptyConfig = aux => ({ selectedAux: aux, channelOrder: [], favouritesByAux: {}, hiddenByAux: {}, groupsByAux: {}, globalGroups: [], view: "list" });
const clone = value => JSON.parse(JSON.stringify(value));

// Older templates showed only favourites on an AUX. Keep the same channels
// visible by hiding the rest; favourites and the starting view are no longer used.
function upgrade(config, channels) {
  const next = { ...emptyConfig(config.selectedAux), ...clone(config) };
  for (const [aux, settings] of Object.entries(next.favouritesByAux || {})) {
    if (settings?.enabled && !next.hiddenByAux[aux] && channels.length)
      next.hiddenByAux[aux] = channels.map(channel => channel.channel).filter(id => !settings.channels.includes(id));
  }
  next.favouritesByAux = {}; next.view = "list";
  return next;
}
// The list a musician sees on one AUX: single channels, and groups with their members together.
function buildItems(order, groups) {
  const groupOf = new Map();
  for (const group of groups) for (const member of group.members) groupOf.set(member, group);
  const items = [], seen = new Set();
  for (const id of order) {
    const group = groupOf.get(id);
    if (!group) items.push({ key: "c" + id, channel: id });
    else if (!seen.has(group.id)) { seen.add(group.id); items.push({ key: "g" + group.id, group, members: order.filter(member => group.members.includes(member)) }); }
  }
  return items;
}
const flatten = items => items.flatMap(item => item.group ? item.members : [item.channel]);
function move(list, from, to) {
  const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
// Drag to reorder with SortableJS. The library moves the DOM node itself, so put
// it back and let the state change draw the new order.
function useSortable(ref, handle, onMove, enabled) {
  const callback = useRef(onMove);
  callback.current = onMove;
  useEffect(() => {
    if (!enabled || !ref.current || !window.Sortable) return undefined;
    const sortable = new window.Sortable(ref.current, {
      handle, draggable: "> li", animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 150,
      ghostClass: "drag-ghost", forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4,
      onEnd(event) {
        const { from, item, oldIndex, newIndex } = event;
        if (oldIndex === newIndex) return;
        item.remove(); from.insertBefore(item, from.children[oldIndex] || null);
        callback.current(oldIndex, newIndex);
      },
    });
    return () => sortable.destroy();
  }, [enabled, handle]);
}
function arrowMove(event, index, length, onMove) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  const to = index + (event.key === "ArrowUp" ? -1 : 1);
  if (to >= 0 && to < length) onMove(index, to);
}

function ChannelRow({ channel, hidden, onHidden, inside, handleClass, onKey }) {
  const name = channel.label || "Channel " + channel.channel;
  return <li className={"channel-row" + (inside ? " channel-inside" : "")} data-id={channel.channel}>
    {inside ? <span className="rail" aria-hidden="true"></span> : null}
    <button type="button" className={"grip " + handleClass} aria-label={"Move " + name + ". Use the up and down arrow keys."} onKeyDown={onKey}><Grip /></button>
    <span className="number">{String(channel.channel).padStart(2, "0")}</span>
    <span className={"channel-name" + (hidden ? " muted" : "")}>{name}</span>
    <label className="visible-toggle"><input type="checkbox" checked={!hidden} onChange={event => onHidden(!event.currentTarget.checked)} />{hidden ? "Hidden" : "Visible"}</label>
  </li>;
}
function GroupBlock({ item, scope, channels, hidden, onHidden, onMoveMember, onKey }) {
  const list = useRef(null);
  useSortable(list, ".grip-inner", onMoveMember, true);
  const name = item.group.name.trim() || "Untitled group";
  return <li className="group-block" data-id={"g" + item.group.id}>
    <div className="group-row">
      <button type="button" className="grip grip-top" aria-label={"Move group " + name + ". Use the up and down arrow keys."} onKeyDown={onKey}><Grip /></button>
      <span className="group-icon"><Icon name="link" /></span>
      <span className="strong grow">{name}</span>
      <Tag>{scope}</Tag>
      <span className="mono muted small">{item.members.length} channels</span>
    </div>
    <ul ref={list}>
      {item.members.map((id, index) => <ChannelRow key={id} inside channel={channels.get(id)} hidden={hidden.includes(id)} onHidden={value => onHidden(id, value)}
        handleClass="grip-inner" onKey={event => arrowMove(event, index, item.members.length, onMoveMember)} />)}
    </ul>
  </li>;
}

function GroupEditor({ group, scope, channels, order, taken, onChange, onDelete }) {
  return <div className="group-card">
    <div className="group-card-head">
      <label className="grow"><span className="sr-only">Group name</span>
        <input value={group.name} maxLength={80} placeholder="Group name (optional)" onInput={event => onChange({ ...group, name: event.currentTarget.value })} />
      </label>
      <Tag>{scope}</Tag>
      <Button kind="danger" aria-label={"Delete group " + (group.name || "untitled")} onClick={onDelete}>Delete</Button>
    </div>
    <div className="chips">
      {order.map(id => {
        const on = group.members.includes(id), disabled = !on && taken.has(id);
        return <label key={id} className={"chip" + (on ? " chip-on" : "") + (disabled ? " chip-disabled" : "")} title={disabled ? "Already in another group" : undefined}>
          <input type="checkbox" checked={on} disabled={disabled}
            onChange={event => onChange({ ...group, members: event.currentTarget.checked ? [...group.members, id] : group.members.filter(member => member !== id) })} />
          {channels.get(id).label || "Channel " + id}
        </label>;
      })}
    </div>
    {group.members.length < 2 ? <p className="warning">Choose at least two channels.</p> : null}
  </div>;
}

export function Templates({ status }) {
  const [templates, setTemplates] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState("");
  const { busy, message, run, setMessage } = useAction();
  const topList = useRef(null);
  const refresh = async () => { const result = await api("/api/templates"); setTemplates(result.templates); return result.templates; };
  useEffect(() => { refresh().catch(error => setMessage({ text: error.message, error: true })); }, []);

  const channels = useMemo(() => new Map(status.channels.map(channel => [channel.channel, channel])), [status.channels]);
  const aux = draft ? String(draft.selectedAux) : "";
  const order = draft ? [...draft.channelOrder, ...channels.keys()].filter((id, index, ids) => channels.has(id) && ids.indexOf(id) === index) : [];
  const auxGroups = draft ? draft.groupsByAux[aux] || [] : [];
  const visibleGroups = draft ? [...draft.globalGroups, ...auxGroups] : [];
  const items = buildItems(order, visibleGroups);
  const hidden = draft ? draft.hiddenByAux[aux] || [] : [];
  const setOrder = next => setDraft(current => ({ ...current, channelOrder: next }));
  const moveItem = (from, to) => setOrder(flatten(move(items, from, to)));
  const moveMember = (item, from, to) => setOrder(flatten(items.map(entry => entry === item ? { ...entry, members: move(entry.members, from, to) } : entry)));
  useSortable(topList, ".grip-top", moveItem, !!draft);

  const setHidden = (id, value) => setDraft(current => {
    const list = (current.hiddenByAux[aux] || []).filter(entry => entry !== id);
    return { ...current, hiddenByAux: { ...current.hiddenByAux, [aux]: value ? [...list, id] : list } };
  });
  const allGroups = draft ? [...draft.globalGroups, ...Object.values(draft.groupsByAux).flat()] : [];
  const taken = (group, global) => new Set((global ? allGroups : visibleGroups).filter(entry => entry.id !== group.id).flatMap(entry => entry.members));
  const updateGroups = (global, change) => setDraft(current => global
    ? { ...current, globalGroups: change(current.globalGroups) }
    : { ...current, groupsByAux: { ...current.groupsByAux, [aux]: change(current.groupsByAux[aux] || []) } });
  const addGroup = global => updateGroups(global, list => [...list, { id: Math.max(0, ...allGroups.map(group => group.id)) + 1, name: "", members: [] }]);

  const open = async id => {
    const template = await run(() => api("/api/templates/" + id));
    if (!template) return;
    const config = upgrade(template.config, status.channels);
    if (!status.aux.some(entry => entry.channel === config.selectedAux)) config.selectedAux = status.aux[0]?.channel ?? null;
    setSelectedId(id); setName(template.name); setDraft(config); setSaved(JSON.stringify([template.name, config]));
  };
  const create = () => {
    const config = emptyConfig(status.aux[0]?.channel ?? null);
    setSelectedId(""); setName(""); setDraft(config); setSaved(""); setMessage({ text: "", error: false });
  };
  const save = async event => {
    event.preventDefault();
    const incomplete = allGroups.find(group => group.members.length < 2);
    if (incomplete) { setMessage({ text: "Group “" + (incomplete.name.trim() || "Untitled") + "” needs at least two channels, or delete it.", error: true }); return; }
    const config = clone({ ...draft, channelOrder: order });
    for (const [key, list] of Object.entries(config.hiddenByAux)) if (!list.length) delete config.hiddenByAux[key];
    for (const [key, list] of Object.entries(config.groupsByAux)) if (!list.length) delete config.groupsByAux[key];
    const template = await run(() => api("/api/admin/templates", { method: "PUT", body: { name, config } }));
    if (!template) return;
    setMessage({ text: "Saved “" + template.name + "”.", error: false });
    setSelectedId(template.id); setName(template.name); setSaved(JSON.stringify([template.name, draft]));
    await refresh().catch(() => setMessage({ text: "Template saved, but the list could not refresh. Reload the page.", error: true }));
  };
  const remove = async () => {
    const template = templates?.find(entry => entry.id === selectedId);
    if (!template || !window.confirm("Delete template “" + template.name + "”? This cannot be undone. Layouts already loaded by musicians will not change.")) return;
    const done = await run(() => api("/api/admin/templates/" + template.id, { method: "DELETE" }), "Deleted “" + template.name + "”.");
    if (!done) return;
    setDraft(null); setSelectedId(""); await refresh().catch(() => {});
  };

  const ready = status.channels.length > 0 && status.aux.length > 0;
  const dirty = draft && JSON.stringify([name, draft]) !== saved;
  const selectedAux = status.aux.find(entry => String(entry.channel) === aux);
  const visibleCount = order.length - order.filter(id => hidden.includes(id)).length;
  return <div className="row">
    <Panel title="Saved templates" flush className="templates-list" actions={<Button disabled={!ready || busy} onClick={create}>New</Button>}>
      {templates === null ? <Empty>Loading…</Empty> : templates.length ? <ul className="select-list">
        {templates.map(template => <li key={template.id}>
          <button type="button" className={template.id === selectedId ? "selected" : ""} disabled={!ready || busy} onClick={() => open(template.id)}>
            <span className="grow">{template.name}</span>
            <span className="mono muted small">{new Date(template.updatedAt).toLocaleDateString([], { day: "numeric", month: "short" })}</span>
          </button>
        </li>)}
      </ul> : <Empty>No templates yet.</Empty>}
      {!ready ? <p className="panel-note">{status.loaded ? "Show at least one AUX mix and channel to edit templates." : "Waiting for the desk…"}</p> : null}
      {!draft ? <Message message={message} /> : null}
    </Panel>
    {draft ? <form className="panel grow-4" onSubmit={save}>
      <div className="panel-head">
        <h2>{selectedId ? name || "Edit template" : "New template"}</h2>
        {dirty ? <span className="panel-meta">unsaved changes</span> : null}
        {selectedId ? <Button kind="danger" disabled={busy} onClick={remove}>Delete</Button> : null}
        <Button kind="primary" type="submit" disabled={busy}>Save template</Button>
      </div>
      <div className="editor-fields">
        <label className="field grow">Template name
          <input value={name} maxLength={80} required placeholder="e.g. Drums" onInput={event => setName(event.currentTarget.value)} />
        </label>
        <label className="field grow">Starting AUX mix
          <select value={aux} onChange={event => setDraft({ ...draft, selectedAux: Number(event.currentTarget.value) })}>
            {status.aux.map(entry => <option key={entry.channel} value={String(entry.channel)}>{entry.label || "AUX " + entry.channel}</option>)}
          </select>
        </label>
      </div>
      <div className="message-row"><Message message={message} /></div>
      <div className="editor-columns">
        <div className="editor-column">
          <div className="sub-head"><h3>Channels on {selectedAux?.label || "this mix"}</h3><span className="mono muted small">{visibleCount} visible · {order.length - visibleCount} hidden</span></div>
          <p className="hint">Drag a group to move it with its channels. Channels in a group reorder inside it.</p>
          <ul className="channel-list" ref={topList}>
            {items.map((item, index) => item.group
              ? <GroupBlock key={item.key} item={item} scope={draft.globalGroups.includes(item.group) ? "All mixes" : "This mix"} channels={channels} hidden={hidden} onHidden={setHidden}
                  onMoveMember={(from, to) => moveMember(item, from, to)} onKey={event => arrowMove(event, index, items.length, moveItem)} />
              : <ChannelRow key={item.key} channel={channels.get(item.channel)} hidden={hidden.includes(item.channel)} onHidden={value => setHidden(item.channel, value)}
                  handleClass="grip-top" onKey={event => arrowMove(event, index, items.length, moveItem)} />)}
          </ul>
        </div>
        <div className="editor-column">
          <div className="sub-head"><h3>Channel groups</h3>
            <Button onClick={() => addGroup(false)}>Add to this mix</Button>
            <Button onClick={() => addGroup(true)}>Add to all mixes</Button>
          </div>
          <div className="groups">
            <p className="muted small">Grouped channels move together on one fader in the app. A channel can be in one group only.</p>
            {visibleGroups.length ? null : <p className="muted small">No groups on this mix.</p>}
            {auxGroups.map(group => <GroupEditor key={group.id} group={group} scope="This mix" channels={channels} order={order} taken={taken(group, false)}
              onChange={next => updateGroups(false, list => list.map(entry => entry.id === group.id ? next : entry))}
              onDelete={() => updateGroups(false, list => list.filter(entry => entry.id !== group.id))} />)}
            {draft.globalGroups.map(group => <GroupEditor key={group.id} group={group} scope="All mixes" channels={channels} order={order} taken={taken(group, true)}
              onChange={next => updateGroups(true, list => list.map(entry => entry.id === group.id ? next : entry))}
              onDelete={() => updateGroups(true, list => list.filter(entry => entry.id !== group.id))} />)}
          </div>
        </div>
      </div>
    </form> : <Panel title="Template" className="grow-4"><Empty>Choose a template to edit, or create a new one.</Empty></Panel>}
  </div>;
}
