// Levels arrive as fader positions (0..1) and pan as -1..1 with 0 in the centre.
export function levelNumber(level) {
  return Number.isFinite(level) ? Math.round(Math.max(0, Math.min(1, level)) * 100) : null;
}
export function levelText(level) {
  const value = levelNumber(level);
  return value === null ? "—" : value === 0 ? "off" : String(value);
}
export function panText(pan) {
  if (!Number.isFinite(pan)) return "";
  const amount = Math.round(Math.abs(pan) * 100);
  return amount === 0 ? "C" : (pan < 0 ? "L" : "R") + amount;
}
export function ago(time, now = Date.now()) {
  if (!time) return "never";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return seconds + " s ago";
  if (seconds < 3600) return Math.round(seconds / 60) + " min ago";
  if (seconds < 86400) return Math.round(seconds / 3600) + " h ago";
  return new Date(time).toLocaleDateString();
}
export function clock(time) {
  return new Date(time).toLocaleTimeString([], { hour12: false });
}
export function rgb(colour) {
  const parts = String(colour ?? "").split(",").map(part => Number(part.trim()));
  return parts.length === 3 && parts.every(part => Number.isFinite(part) && part >= 0 && part <= 255)
    ? "rgb(" + parts.map(Math.round).join(", ") + ")" : "rgb(100, 116, 139)";
}
// Desk levels are in dB and pan is 0..1; convert streamed values like the server does.
export function parseLiveUpdate(message) {
  if (!message || typeof message.address !== "string" || !Array.isArray(message.args)) return null;
  const match = /^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)$/.exec(message.address);
  const value = message.args[0];
  if (!match || !Number.isFinite(value)) return null;
  return {
    channel: Number(match[1]), aux: Number(match[2]), field: match[3],
    value: match[3] === "level"
      ? (value <= -150 ? 0 : Math.max(0, Math.min(1, Math.pow(100, (value + 90) / 100) / 100)))
      : Math.max(-1, Math.min(1, value * 2 - 1)),
  };
}
// Merge a run of changes to the same control into one line, newest first.
export function coalesceLog(entries) {
  const result = [];
  for (const entry of entries) {
    const previous = result[result.length - 1];
    if (previous && previous.client === entry.client && previous.type === entry.type && previous.aux === entry.aux &&
      entry.type !== "request" && (entry.type === "aux" || previous.channel === entry.channel)) {
      previous.at = entry.at; previous.to = entry.value;
      continue;
    }
    result.push({ ...entry, from: entry.previousValue ?? null, to: entry.value });
  }
  return result.reverse();
}
export function changeText(entry) {
  if (entry.type === "aux") return "Opened " + (entry.auxLabel || "AUX " + entry.aux);
  if (entry.type === "request") return "Asked: " + entry.label + (entry.text ? " — " + entry.text : "");
  const name = entry.channelLabel || "Channel " + entry.channel;
  if (entry.type === "mute") return name + (entry.to ? " unmuted" : " muted");
  const show = entry.type === "level" ? levelText : value => panText(value) || "C";
  const changed = entry.from !== null && Math.abs(entry.from - entry.to) > 0.005;
  return name + (entry.type === "pan" ? " pan " : " ") + (changed ? show(entry.from) + " → " + show(entry.to) : show(entry.to));
}
// Every client's log as one list, newest first.
export function activity(status, limit = 30) {
  const all = [];
  for (const client of [...(status?.clients || []), ...(status?.disconnectedClients || [])]) {
    const name = client.username || client.deviceName || "Unnamed device";
    const entries = (client.log || []).map(entry => ({ ...entry, client: client.id, name }));
    all.push(...coalesceLog(entries));
  }
  return all.sort((a, b) => b.at - a.at).slice(0, limit);
}
export function clientName(client) {
  return client.username || client.deviceName || "Unnamed device";
}
