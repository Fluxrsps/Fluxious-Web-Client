/**
 * Keyboard shortcuts, standing in for RuneLite's `Keybind`.
 *
 * A bind is stored as a readable string — "Alt+H", "Shift+F1" — rather than a key code, so it
 * survives being read or edited by hand in the config, and so the settings panel can show it
 * without a lookup table.
 */

export interface Keybind {
    key: string;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
}

/** A pressed combo, as a bind. Single letters are upper-cased so Shift does not change the name. */
export function keybindFromEvent(event: KeyboardEvent): Keybind {
    return {
        key: event.key.length === 1 ? event.key.toUpperCase() : event.key,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
    };
}

/** Modifier order is fixed so the same combo always stores as the same string. */
export function formatKeybind(source: KeyboardEvent | Keybind): string {
    const bind = source instanceof KeyboardEvent ? keybindFromEvent(source) : source;
    const parts: string[] = [];

    if (bind.ctrl) {
        parts.push('Ctrl');
    }
    if (bind.alt) {
        parts.push('Alt');
    }
    if (bind.shift) {
        parts.push('Shift');
    }

    // Modifiers arrive as key presses of their own while a combo is being typed; a bind of
    // "Alt+Alt" is not something anyone means.
    if (!bind.key || ['Control', 'Alt', 'Shift', 'Meta'].includes(bind.key)) {
        return '';
    }

    parts.push(bind.key);

    return parts.join('+');
}

export function parseKeybind(value: string): Keybind | null {
    if (!value) {
        return null;
    }

    const parts = value.split('+').filter(Boolean);
    const key = parts.pop();

    if (!key) {
        return null;
    }

    return {
        key,
        ctrl: parts.includes('Ctrl'),
        alt: parts.includes('Alt'),
        shift: parts.includes('Shift'),
    };
}

/**
 * Whether an event is this bind.
 *
 * Compares the modifiers exactly, so "H" does not fire on "Alt+H" — a shortcut that triggers on a
 * superset of itself would collide with every other bind sharing its letter.
 */
export function matchesKeybind(event: KeyboardEvent, bind: Keybind | null): boolean {
    if (!bind) {
        return false;
    }

    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;

    return (
        key === bind.key &&
        event.ctrlKey === bind.ctrl &&
        event.altKey === bind.alt &&
        event.shiftKey === bind.shift
    );
}

/**
 * Whether a key event belongs to something the player is typing into.
 *
 * A shortcut must not fire while a note is being written, which is the same reason RuneLite gates
 * its keybinds on the client having focus rather than a text field.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    return (
        target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
    );
}
