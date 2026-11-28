const fs = require("fs");
const logger = require("../logging/logger.js")
const crypto = require("crypto")

const CONFIG_DIRECTORY_PATH = process.env.OSC_WEBMIXER_CONFIG_DIR || "./config"
const GLOBAL_CONFIG_PATH = `${CONFIG_DIRECTORY_PATH}/global.json`
const CURRENT_STATE_PATH = `${CONFIG_DIRECTORY_PATH}/state.json`
const USER_PRESET_PATH = `${CONFIG_DIRECTORY_PATH}/presets.json`

/**
 * Checks if the config directory exists and creates it if not
 * @returns {boolean} Whether the config directory existed prior to executing this function.
 */
// Write to a temporary file and rename it into place, so a crash or power
// loss mid-save cannot leave a half-written settings file.
function writeAtomic(file, data) {
    keepBackup(file);
    const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, data, 'utf8');
    try {
        for (let attempt = 0; ; attempt++) {
            try { fs.renameSync(temporary, file); return; }
            catch (error) {
                // Windows can briefly refuse to replace a file another process has open.
                if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
            }
        }
    } catch (error) {
        fs.writeFileSync(file, data, 'utf8');
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Before a settings file is replaced, keep the current copy as <file>.bak, so a
// file damaged later (a crash mid-write or a bad hand edit) can be recovered.
// A copy that no longer reads is not kept, so it cannot replace a good backup.
function keepBackup(file) {
    try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.copyFileSync(file, file + '.bak');
    } catch (error) {
        if (error.code !== 'ENOENT') logger.warn(`Could not back up "${file}": ${error.message}`);
    }
}

/**
 * Read a settings file. A file that cannot be read is renamed to
 * <file>.damaged-<time>, so it is never overwritten, and the backup taken at
 * the last save is used instead. With neither, the fallback is used.
 * @template T
 * @param {string} file
 * @param {(value: unknown) => boolean} valid - whether the parsed contents can be used
 * @param {() => T} fallback - used when no copy can be read
 * @returns {T}
 */
function readSettings(file, valid, fallback) {
    for (const candidate of [file, file + '.bak']) {
        let text;
        try { text = fs.readFileSync(candidate, 'utf8'); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        try {
            const value = JSON.parse(text);
            if (!valid(value)) throw new Error('its contents are not in the expected format');
            if (candidate !== file) logger.warn(`Using the backup "${candidate}" saved before the last change.`);
            return value;
        } catch (error) {
            const aside = `${candidate}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`;
            try { fs.renameSync(candidate, aside); }
            catch (renameError) { logger.error(`Could not move "${candidate}" aside: ${renameError.message}`); }
            logger.error(`Settings file "${candidate}" could not be read (${error.message}). It was kept as "${aside}".`);
        }
    }
    return fallback();
}

function ensureConfigDirectoryExists() {
    if (!fs.existsSync(CONFIG_DIRECTORY_PATH)) {
		logger.warn(`Configuration directory "${CONFIG_DIRECTORY_PATH}" not found. Creating empty directory.`)
        fs.mkdirSync(CONFIG_DIRECTORY_PATH, { recursive: true })
		return false
    }
	return true
}

/**
 * Load global config from disk. If it doesn't exist then use default values.
 * @param {string} filename 
 * @returns {AppGlobalConfig} Global config object
 */
function getGlobalConfigOrDefault() {
    const valid = config => isObject(config) && isObject(config.server) && isObject(config.osc) && isObject(config.desk);
    return readSettings(GLOBAL_CONFIG_PATH, valid, () => {
        logger.warn(`No readable global configuration in "${GLOBAL_CONFIG_PATH}". Using default values.`)
		return {
			debug: false,
			server: {
				port: 80
			},
			osc: {
				port: 8000
			},
			desk: {
				ip: "",
				port: 9000
			},
			externalDevices: []
		};
    });
}

/**
 * 
 * @param {AppGlobalConfig} config 
 */
function saveGlobalConfig(config) {
	const data = JSON.stringify(config, null, 2);
    writeAtomic(GLOBAL_CONFIG_PATH, data);
}


/**
 * Get application save state
 * @returns {AppWebmixerPreset}
 */
function getCurrentStateOrDefault() {
	return readSettings(CURRENT_STATE_PATH, isObject, () => {
		logger.warn(`No readable current state in "${CURRENT_STATE_PATH}". Starting from a blank state.`)
		return {
            uuid: "",
            name: "Default",
            sessionName: "",
            auxes: [],
            channels: []
        };
	});
}

/**
 * Saves the current runtime state to state.json
 * @param {AppWebmixerPreset} state 
 */
function saveCurrentState(state) {
    const data = JSON.stringify(state, null, 2);
    writeAtomic(CURRENT_STATE_PATH, data);
}


/**
 * @returns {AppWebmixerPreset[]}
 */
function getPresets() {
    // A damaged presets file is set aside rather than overwritten by the next save.
    return readSettings(USER_PRESET_PATH, value => Array.isArray(value) && value.every(isObject), () => []);
}

/**
 * @param {string} uuid 
 * @returns {AppWebmixerPreset | undefined}
 */
function getPresetById(uuid) {
    return getPresets().find(p => p.uuid === uuid);
}

/**
 * @param {string} name 
 * @returns {AppWebmixerPreset | undefined}
 */
function getPresetByName(name) {
    return getPresets().find(p => p.name === name);
}

/**
 * 
 * @param {AppWebmixerPreset} preset
 * @param {string} presetName
 * @returns {AppWebmixerPreset}
 */
function saveCurrentStateAsPreset(currentState, presetName) {
	let presets = getPresets();

	if (presets.find(p => p.name === presetName) !== undefined) {
        const error = new Error(`A preset named '${presetName}' already exists.`);
        error.code = 'PRESET_EXISTS';
        throw error;
    }

	const newPreset = {
		...structuredClone(currentState),
		uuid: crypto.randomUUID(),
		name: presetName,
		lastChanged: new Date().toISOString()
	};

	presets.push(newPreset);
	savePresetsToFile(presets);
	return newPreset;
}


function savePresetsToFile(presets) {
	try {
        const data = JSON.stringify(presets, null, 2);
        writeAtomic(USER_PRESET_PATH, data);
    } catch (err) {
        logger.error(`Failed to write to ${USER_PRESET_PATH}: ${err.message}`);
        throw err;
    }
}

/**
 * Deletes a preset by its UUID
 * @param {string} uuid 
 */
function deletePreset(uuid) {
    let presets = getPresets();
    const index = presets.findIndex(p => p.uuid === uuid);

    if (index === -1) {
        const error = new Error(`Preset with UUID "${uuid}" not found.`);
        error.code = 'PRESET_NOT_FOUND';
        throw error;
    }

    presets.splice(index, 1);
    savePresetsToFile(presets);
    
    return true; 
}


module.exports = {
	readSettings,
	ensureConfigDirectoryExists,
	getGlobalConfigOrDefault,
	getCurrentStateOrDefault,
	saveGlobalConfig,
	saveCurrentState,
	getPresets,
	getPresetById,
	getPresetByName,
	saveCurrentStateAsPreset,
	deletePreset
}
