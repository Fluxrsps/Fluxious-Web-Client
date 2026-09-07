/**
 * Whether the sidebar is showing.
 *
 * Shared because two very different things drive it: a plugin, which is plain TypeScript, and the
 * sidebar component, which is Vue. Neither should import the other, so the state lives here and
 * both subscribe — the same shape as `clientToolbar`.
 *
 * The hidden state is also published as a class on the document element, because `#game-host`
 * reserves the strip's width in CSS and has to give that space back when the strip goes away.
 */

const HIDDEN_CLASS = 'flx-sidebar-hidden';

/**
 * Set while a panel is open, so `#game-host` can give up the panel's width as well as the strip's.
 *
 * The chrome is fixed to the viewport edge, so without this the game canvas keeps its full width
 * and the panel simply covers 240px of it. The client sizes itself from `#game-host`, so insetting
 * that element makes the game resize instead of being obscured.
 */
const PANEL_OPEN_CLASS = 'flx-panel-open';

let hidden = false;
let panelOpen = false;

type Listener = (hidden: boolean) => void;
const listeners = new Set<Listener>();

/** Notified whenever the chrome changes width, whichever half of it moved. */
type LayoutListener = () => void;
const layoutListeners = new Set<LayoutListener>();

export function isSidebarHidden(): boolean {
    return hidden;
}

export function isPanelOpen(): boolean {
    return panelOpen;
}

export function onSidebarLayoutChanged(listener: LayoutListener): () => void {
    layoutListeners.add(listener);

    return () => layoutListeners.delete(listener);
}

function announceLayout(): void {
    for (const listener of layoutListeners) {
        listener();
    }
}

export function onSidebarVisibilityChanged(listener: Listener): () => void {
    listeners.add(listener);

    return () => listeners.delete(listener);
}

export function setSidebarHidden(next: boolean): void {
    if (hidden === next) {
        return;
    }

    hidden = next;
    document.documentElement.classList.toggle(HIDDEN_CLASS, hidden);

    for (const listener of listeners) {
        listener(hidden);
    }

    announceLayout();
}

export function toggleSidebar(): void {
    setSidebarHidden(!hidden);
}

/** Tells the layout whether a panel is open, so the game can be given the remaining width. */
export function setSidebarPanelOpen(open: boolean): void {
    if (panelOpen === open) {
        return;
    }

    panelOpen = open;
    document.documentElement.classList.toggle(PANEL_OPEN_CLASS, open);
    announceLayout();
}
