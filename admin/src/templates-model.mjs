// Pure helpers for the template editor, kept free of UI so they can be tested.
// A template is one channel layout for any mix: an order, one hidden list and
// all-mix groups. It never chooses a starting AUX; the per-mix fields stay empty.
export const emptyConfig = () => ({ selectedAux: null, channelOrder: [], favouritesByAux: {}, hidden: [], hiddenByAux: {}, groupsByAux: {}, globalGroups: [], view: "list" });
export const clone = value => JSON.parse(JSON.stringify(value));

// Older templates showed only favourites on an AUX. Keep the same channels
// visible by hiding the rest; favourites and the starting view are no longer used.
// The server already turns per-mix layouts into one layout; a favourites-only
// template becomes a hidden list from its first mix with favourites on.
export function upgrade(config, channels) {
  const next = { ...emptyConfig(), ...clone(config), selectedAux: null };
  if (!next.hidden.length && channels.length) {
    const favourites = Object.entries(next.favouritesByAux || {}).sort(([a], [b]) => a - b).find(([, settings]) => settings?.enabled)?.[1];
    if (favourites) next.hidden = channels.map(channel => channel.channel).filter(id => !favourites.channels.includes(id));
  }
  next.favouritesByAux = {}; next.hiddenByAux = {}; next.groupsByAux = {}; next.view = "list";
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
