import { rgb } from "./format.js";

const paths = {
  overview: <><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>,
  live: <><line x1="6" y1="4" x2="6" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="18" y1="4" x2="18" y2="20" /><rect x="4" y="8" width="4" height="3" /><rect x="10" y="13" width="4" height="3" /><rect x="16" y="6" width="4" height="3" /></>,
  clients: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.500 6.500-5.500s5.900 1.900 6.500 5.500" /><path d="M16 4.800a3.500 3.500 0 0 1 0 6.400" /><path d="M18.500 14.800c1.700.800 2.700 2.500 3 5.200" /></>,
  templates: <><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="9" x2="9" y2="20" /></>,
  desk: <><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="9" cy="7" r="2.500" /><circle cx="15" cy="17" r="2.500" /></>,
  system: <><rect x="3" y="4" width="18" height="12" rx="2" /><line x1="8" y1="20" x2="16" y2="20" /><line x1="12" y1="16" x2="12" y2="20" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1" /><path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" /></>,
};
export function Icon({ name, size = 16 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{paths[name]}</svg>;
}
export function Grip() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="6" r="1.7" /><circle cx="9" cy="12" r="1.7" />
    <circle cx="15" cy="12" r="1.7" /><circle cx="9" cy="18" r="1.7" /><circle cx="15" cy="18" r="1.7" />
  </svg>;
}
export function Panel({ title, meta, actions, flush, className = "", children }) {
  return <section className={"panel " + className}>
    <div className="panel-head">
      <h2>{title}</h2>
      {meta ? <span className="panel-meta">{meta}</span> : null}
      {actions}
    </div>
    <div className={flush ? "" : "panel-body"}>{children}</div>
  </section>;
}
export function Button({ kind = "plain", children, ...props }) {
  return <button type="button" className={"button button-" + kind} {...props}>{children}</button>;
}
export function Tag({ tone = "muted", children }) {
  return <span className={"tag tag-" + tone}>{children}</span>;
}
export function AuxLabel({ label, colour }) {
  return <span className="aux-label"><span className="aux-swatch" style={{ background: rgb(colour) }}></span>{label}</span>;
}
export function Message({ message }) {
  return <p className={"message" + (message?.error ? " message-error" : "")} role="status" aria-live="polite">{message?.text || ""}</p>;
}
export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}
// columns: [{ title, mono, render(row) }]
export function Table({ columns, rows, minWidth = 560, rowKey }) {
  return <div className="table-scroll">
    <table style={{ minWidth: minWidth + "px" }}>
      <thead><tr>{columns.map(column => <th scope="col" key={column.title}>{column.title}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={rowKey ? rowKey(row) : index}>
        {columns.map(column => <td key={column.title} className={column.mono ? "mono" : ""}>{column.render(row)}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}
