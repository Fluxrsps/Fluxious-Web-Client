/**
 * The sidebar registry, ported from `ClientToolbar` / `NavigationButton` / `PluginPanel`.
 *
 * A plugin adds a button in `startUp` and removes it in `shutDown` — the same two calls the
 * desktop plugins make. A button carrying a `panel` opens that panel; one carrying only `onClick`
 * performs an action.
 *
 * On desktop those two land in different places: panel buttons in the sidebar, action buttons in
 * the title bar. There is no title bar here, so action buttons sit at the bottom of the same
 * strip. Registration is identical either way, which is what lets a plugin be ported without
 * knowing where its button ends up.
 *
 * A panel mounts into a plain element rather than being a Vue component. Plugins are ordinary
 * TypeScript modules and should not have to import the page's UI framework to put a text box on
 * the screen; `mount`/`unmount` is the same contract Swing gives `PluginPanel`.
 */

export interface PluginPanel {
    /** Build the panel's DOM inside `host`. Called each time the panel becomes visible. */
    mount(host: HTMLElement): void;
    /** Tear down listeners and timers. Called when the panel is hidden or the plugin stops. */
    unmount?(): void;
}

export interface NavigationButton {
    /** Shown on hover, and used as the panel's heading. Also breaks ties in the ordering. */
    tooltip: string;
    /** Icon shown in the strip: any URL, including a data URI. */
    icon: string;
    /** Lower sorts earlier, matching `NavigationButton.COMPARATOR`. */
    priority: number;
    /** Present for a panel button; absent for an action button. */
    panel?: PluginPanel;
    /** Present for an action button; run on left click. */
    onClick?: () => void;
    /** Right-click menu entries, in insertion order. */
    popup?: Record<string, () => void>;
}

const navigations: NavigationButton[] = [];

type ToolbarListener = () => void;
const listeners = new Set<ToolbarListener>();

export function onToolbarChanged(listener: ToolbarListener): () => void {
    listeners.add(listener);

    return () => listeners.delete(listener);
}

function announce(): void {
    for (const listener of listeners) {
        listener();
    }
}

/** Priority then tooltip, the order `NavigationButton.COMPARATOR` gives. */
function compare(a: NavigationButton, b: NavigationButton): number {
    return a.priority - b.priority || a.tooltip.localeCompare(b.tooltip);
}

export function addNavigation(button: NavigationButton): void {
    if (navigations.includes(button)) {
        return;
    }

    navigations.push(button);
    navigations.sort(compare);
    announce();
}

export function removeNavigation(button: NavigationButton): void {
    const index = navigations.indexOf(button);

    if (index < 0) {
        return;
    }

    navigations.splice(index, 1);

    // A panel being removed while open would otherwise leave its listeners attached to an element
    // the sidebar is about to discard.
    button.panel?.unmount?.();
    announce();
}

export function listNavigations(): NavigationButton[] {
    return [...navigations];
}

/** Buttons that open a panel; the top group of the strip. */
export function listPanelNavigations(): NavigationButton[] {
    return navigations.filter((button) => button.panel);
}

/** Buttons that just do something; the bottom group, standing in for the title bar. */
export function listActionNavigations(): NavigationButton[] {
    return navigations.filter((button) => !button.panel && button.onClick);
}
