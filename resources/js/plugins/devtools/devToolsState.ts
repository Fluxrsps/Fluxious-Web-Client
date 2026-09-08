/**
 * Which developer tools are switched on.
 *
 * Deliberately not config. The desktop plugin's toggles are buttons in a window and reset when the
 * client restarts, and these are the same: something you turn on to look at a problem and expect to
 * be off again next time. Nothing here is written to storage.
 */
export interface DevToolsToggles {
    renderStats: boolean;
    location: boolean;
    cameraPosition: boolean;
    tileLocation: boolean;
    interacting: boolean;
}

export const toggles: DevToolsToggles = {
    renderStats: false,
    location: false,
    cameraPosition: false,
    tileLocation: false,
    interacting: false,
};

export type ToggleName = keyof DevToolsToggles;

/** The buttons the panel shows, in the order it shows them, with the desktop plugin's own labels. */
export const TOGGLE_LABELS: { key: ToggleName; label: string }[] = [
    { key: 'renderStats', label: 'Render Stats' },
    { key: 'location', label: 'Location' },
    { key: 'cameraPosition', label: 'Camera Position' },
    { key: 'tileLocation', label: 'Tile Location' },
    { key: 'interacting', label: 'Interacting' },
];

type Listener = (key: ToggleName, value: boolean) => void;

const listeners = new Set<Listener>();

export function onToggled(listener: Listener): () => void {
    listeners.add(listener);

    return () => listeners.delete(listener);
}

export function setToggle(key: ToggleName, value: boolean): void {
    toggles[key] = value;

    for (const listener of listeners) {
        listener(key, value);
    }
}

/** Puts everything back to off, for when the plugin stops. */
export function clearToggles(): void {
    for (const { key } of TOGGLE_LABELS) {
        if (toggles[key]) {
            setToggle(key, false);
        }
    }
}
