"use strict";
// The AUX mixes and channels part of the desk settings form: which are shown to
// musicians, with their order, section titles, colours, icons and desk names.
// The whole form is read before anything is applied, so a malformed save
// changes nothing.
const { channelColour } = require('./mix-values.js');

// More than any DiGiCo desk has.
const MAX_ENTRIES = 1024;
const MAX_TEXT = 512;
const CONTROL = /[\x00-\x1f\x7f]/;

class InvalidLayout extends Error {}

// A list of short strings from the form, or undefined when the form left it out.
function strings(body, name, length) {
	const value = body[name];
	if(value === undefined) return undefined;
	if(!Array.isArray(value) || value.length > MAX_ENTRIES || (length !== undefined && value.length !== length) ||
		!value.every(entry => typeof entry === 'string' && entry.length <= MAX_TEXT && !CONTROL.test(entry)))
		throw new InvalidLayout(name);
	return value;
}

/**
 * Read the layout fields of a desk settings form.
 * @param {Record<string, unknown>} body - the parsed form
 * @param {{ colour?: string }[]} [previousChannels] - saved channels, whose colours forms from before channel colours keep
 * @returns {{ auxes?: object[], channels?: object[], auxNames?: string[], channelNames?: string[] } | null}
 *   null when any field is malformed. A field group the form left out is left out here too.
 */
function readDeskLayout(body, previousChannels = []) {
	try {
		const layout = {};
		const auxEnabled = strings(body, 'auxEnabled');
		const auxColour = strings(body, 'auxColour', auxEnabled?.length);
		const auxIcon = strings(body, 'auxIcon', auxEnabled?.length);
		if(auxEnabled && auxColour && auxIcon)
			layout.auxes = auxEnabled.map((enabled, index) => ({ enabled: enabled === 'true', colour: auxColour[index], icon: auxIcon[index] }));

		const channelEnabled = strings(body, 'channelEnabled');
		const length = channelEnabled?.length;
		const channelOrder = strings(body, 'channelOrder', length);
		const channelIcon = strings(body, 'channelIcon', length);
		const sectionTitle = strings(body, 'sectionTitle', length);
		const colours = strings(body, 'channelColour', length);
		if(channelEnabled && channelOrder && channelIcon)
			layout.channels = channelEnabled.map((enabled, index) => ({
				enabled: enabled === 'true',
				displayOrder: parseInt(channelOrder[index]) || index,
				title: sectionTitle ? sectionTitle[index] : '',
				// Forms from before channel colours keep each channel's saved colour.
				colour: channelColour(colours ? colours[index] : previousChannels?.[index]?.colour),
				icon: channelIcon[index]
			}));

		const auxNames = strings(body, 'auxName');
		const channelNames = strings(body, 'channelName');
		if(auxNames) layout.auxNames = auxNames;
		if(channelNames) layout.channelNames = channelNames;
		return layout;
	} catch(error) {
		if(error instanceof InvalidLayout) return null;
		throw error;
	}
}

module.exports = { readDeskLayout, MAX_ENTRIES };
