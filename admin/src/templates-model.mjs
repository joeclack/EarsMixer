// Pure helpers for the template editor, kept free of UI so they can be tested.
export const emptyConfig = aux => ({ selectedAux: aux, channelOrder: [], favouritesByAux: {}, hiddenByAux: {}, groupsByAux: {}, globalGroups: [], view: "list" });
export const clone = value => JSON.parse(JSON.stringify(value));

// Older templates showed only favourites on an AUX. Keep the same channels
// visible by hiding the rest; favourites and the starting view are no longer used.
export function upgrade(config, channels) {
  const next = { ...emptyConfig(config.selectedAux), ...clone(config) };
  for (const [aux, settings] of Object.entries(next.favouritesByAux || {})) {
    if (settings?.enabled && !next.hiddenByAux[aux] && channels.length)
      next.hiddenByAux[aux] = channels.map(channel => channel.channel).filter(id => !settings.channels.includes(id));
  }
  next.favouritesByAux = {}; next.view = "list";
  return next;
}
// The list a musician sees on one AUX: single channels, and groups with their members together.
export function buildItems(order, groups) {
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
export const flatten = items => items.flatMap(item => item.group ? item.members : [item.channel]);
export function move(list, from, to) {
  const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
