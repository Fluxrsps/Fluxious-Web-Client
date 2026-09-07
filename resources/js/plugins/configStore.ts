/**
 * Settings storage for plugins — the part `ConfigManager` plays on desktop.
 *
 * Values live in `localStorage` under `flux.config.<group>.<keyName>`, one key per setting rather
 * than a serialised blob per group. That way a setting added to a group later simply falls back to
 * its declared default, instead of being missing from a stored object that was written before it
 * existed.
 *
 * Enabled/disabled state is stored the same way, under a reserved group, so the plugin list and
 * the settings panels share one persistence path.
 */
import type { ConfigGroup, ConfigItem, ConfigReader, ConfigValue } from './types';

const PREFIX = 'flux.config';

/** Reserved group holding each plugin's enabled state. Not shown in any settings panel. */
const ENABLED_GROUP = 'pluginsEnabled';

type ConfigListener = (group: string, keyName: string) => void;

const listeners = new Set<ConfigListener>();

function storageKey(group: string, keyName: string): string {
    return `${PREFIX}.${group}.${keyName}`;
}

function readRaw(group: string, keyName: string): string | null {
    try {
        return window.localStorage.getItem(storageKey(group, keyName));
    } catch {
        // Private browsing and blocked storage both throw rather than returning null. A plugin
        // running on defaults is a far better outcome than a page that fails to boot.
        return null;
    }
}

function writeRaw(group: string, keyName: string, value: string): void {
    try {
        window.localStorage.setItem(storageKey(group, keyName), value);
    } catch {
        // Same reasoning: the setting applies for this session and is simply not remembered.
    }
}

/**
 * Raw string storage, for state that has no config schema behind it.
 *
 * Overlay positions use this: they are written by dragging rather than by a settings control, so
 * there is no `ConfigItem` describing them, but they belong in the same store as everything else a
 * player has changed — one place to look, one place to clear.
 */
export function readRawPreference(group: string, keyName: string): string | null {
    return readRaw(group, keyName);
}

export function writeRawPreference(group: string, keyName: string, value: string): void {
    writeRaw(group, keyName, value);
    announce(group, keyName);
}

export function onConfigChanged(listener: ConfigListener): () => void {
    listeners.add(listener);

    return () => listeners.delete(listener);
}

function announce(group: string, keyName: string): void {
    for (const listener of listeners) {
        listener(group, keyName);
    }
}

function itemOf(config: ConfigGroup, keyName: string): ConfigItem | undefined {
    return config.items.find((item) => item.keyName === keyName);
}

/** Current value, falling back to the declared default when nothing valid is stored. */
export function readValue(config: ConfigGroup, keyName: string): ConfigValue {
    const item = itemOf(config, keyName);

    if (!item) {
        throw new Error(`Unknown config item ${config.group}.${keyName}`);
    }

    const raw = readRaw(config.group, keyName);

    if (raw === null) {
        return item.defaultValue;
    }

    if (item.type === 'boolean') {
        return raw === 'true';
    }

    if (item.type === 'number') {
        const parsed = Number(raw);

        // A stored value that is not a number at all means something else wrote this key; the
        // default is a better answer than NaN reaching a plugin's drawing code.
        return Number.isFinite(parsed) ? parsed : item.defaultValue;
    }

    if (item.type === 'enum') {
        return item.options.some((option) => option.value === raw) ? raw : item.defaultValue;
    }

    return raw;
}

export function writeValue(config: ConfigGroup, keyName: string, value: ConfigValue): void {
    writeRaw(config.group, keyName, String(value));
    announce(config.group, keyName);
}

/** Restores one setting to its declared default. */
export function resetValue(config: ConfigGroup, keyName: string): void {
    try {
        window.localStorage.removeItem(storageKey(config.group, keyName));
    } catch {
        // Nothing was persisted, so there is nothing to undo.
    }

    announce(config.group, keyName);
}

/**
 * A typed view over one group, handed to a plugin as `context.config`.
 *
 * The three accessors assert the shape the plugin already knows it declared, which keeps call
 * sites free of casts: `config.boolean('drawFps')` rather than a union that must be narrowed.
 */
export function readerFor(config: ConfigGroup): ConfigReader {
    return {
        boolean: (keyName) => Boolean(readValue(config, keyName)),
        number: (keyName) => Number(readValue(config, keyName)),
        string: (keyName) => String(readValue(config, keyName)),
    };
}

/** Reserved group holding pinned plugins. RuneLite calls these pinned; the control is a star. */
const FAVOURITE_GROUP = 'pluginsFavourite';

export function isPluginFavourite(pluginName: string): boolean {
    return readRaw(FAVOURITE_GROUP, pluginName) === 'true';
}

export function setPluginFavourite(pluginName: string, favourite: boolean): void {
    writeRaw(FAVOURITE_GROUP, pluginName, String(favourite));
    announce(FAVOURITE_GROUP, pluginName);
}

export function isPluginEnabled(pluginName: string, enabledByDefault: boolean): boolean {
    const raw = readRaw(ENABLED_GROUP, pluginName);

    return raw === null ? enabledByDefault : raw === 'true';
}

export function setPluginEnabled(pluginName: string, enabled: boolean): void {
    writeRaw(ENABLED_GROUP, pluginName, String(enabled));
    announce(ENABLED_GROUP, pluginName);
}
