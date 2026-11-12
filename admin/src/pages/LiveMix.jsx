import { useState } from "preact/hooks";
import { useLiveLevels } from "../hooks.js";
import { activity, changeText, clientName, clock, levelNumber, levelText, panText, rgb } from "../format.mjs";
import { AuxLabel, Empty, Panel, Table, Tag } from "../ui.jsx";

function Bar({ value, colour, tall }) {
  const number = levelNumber(value);
  return <span className={"bar" + (tall ? " bar-tall" : "")}>
    <span style={{ width: (number || 0) + "%", background: number ? colour : "transparent" }}></span>
  </span>;
}

export function LiveMix({ status, selectedAux, onSelect, reload }) {
  const read = useLiveLevels(status.mixLevels, true, reload);
  const [showAll, setShowAll] = useState(false);
  if (!status.aux.length || !status.channels.length) return <Panel title="Send matrix"><Empty>{status.loaded ? "No AUX mixes or channels are shown to musicians." : "Waiting for the desk…"}</Empty></Panel>;
  const selected = status.aux.find(aux => aux.channel === selectedAux) || status.aux[0];
  const levels = aux => status.mixLevels[aux.channel] || [];
  const people = aux => status.clients.filter(client => client.aux === aux.channel);
  const detail = levels(selected);
  const log = activity(status, 200).filter(entry => entry.aux === selected.channel).slice(0, 12);
  return <div className="row">
    <Panel title="Send matrix" flush className="grow-3" actions={<span className="muted small">Levels 0–100 · select a mix to inspect</span>}>
      <div className="table-scroll">
        <table className="matrix" style={{ minWidth: 220 + status.aux.length * 110 + "px" }}>
          <thead><tr>
            <th scope="col" className="sticky">Channel</th>
            {status.aux.map(aux => <th scope="col" key={aux.channel} className={aux === selected ? "selected" : ""}>
              <button type="button" className="matrix-aux" aria-pressed={aux === selected ? "true" : "false"} onClick={() => onSelect(aux.channel)}>
                <AuxLabel label={aux.label} colour={aux.colour} />
                <span className="muted small">{people(aux).map(clientName).join(", ") || "No one"}</span>
              </button>
            </th>)}
          </tr></thead>
          <tbody>{status.channels.map(channel => <tr key={channel.channel}>
            <th scope="row" className="sticky"><span className="number">{String(channel.channel).padStart(2, "0")}</span>{channel.label}</th>
            {status.aux.map(aux => {
              const entry = levels(aux).find(item => item.channel === channel.channel);
              const value = entry ? read(aux.channel, entry, "level") : null;
              return <td key={aux.channel} className={aux === selected ? "selected" : ""}>
                <span className="cell"><Bar value={value} colour={rgb(aux.colour)} /><span className={"cell-value" + (levelNumber(value) ? "" : " muted")}>{levelText(value)}</span></span>
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </Panel>
    <div className="column grow-1">
      <Panel title="Selected mix" meta="live" flush>
        <div className="selected-head">
          <AuxLabel label={selected.label} colour={selected.colour} />
          <Tag>{selected.stereo ? "Stereo" : "Mono"}</Tag>
          <span className="muted small">{people(selected).map(clientName).join(", ") || "No one connected"}</span>
        </div>
        <ul className="strips">
          {(showAll ? detail : detail.slice(0, 8)).map(entry => <li key={entry.channel}>
            <span className="strip-main"><span className="strip-name">{entry.label}</span><Bar tall value={read(selected.channel, entry, "level")} colour={rgb(selected.colour)} /></span>
            <span className="mono strip-value">{levelText(read(selected.channel, entry, "level"))}</span>
            <span className="mono muted strip-pan">{selected.stereo ? panText(read(selected.channel, entry, "pan")) : ""}</span>
          </li>)}
        </ul>
        {detail.length > 8 ? <div className="panel-foot"><button type="button" className="button button-plain" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : "Show all " + detail.length + " channels"}</button></div> : null}
      </Panel>
      <Panel title="Recent changes" flush>
        {log.length ? <Table minWidth={300} rows={log} columns={[
          { title: "Time", mono: true, render: entry => clock(entry.at) },
          { title: "Device", render: entry => entry.name },
          { title: "Change", mono: true, render: entry => changeText(entry) },
        ]} /> : <Empty>No changes on this mix yet.</Empty>}
      </Panel>
    </div>
  </div>;
}
