/**
 * Fluxious: the client's own plugin.
 *
 * Marked `core`, so it sorts to the top of the plugin list and cannot be switched off — what it
 * carries is client behaviour rather than an optional extra, and a player who disabled it would
 * lose the only way back to a hidden side panel.
 *
 * First thing it owns: hiding and showing that panel, from a toolbar button or a keybind.
 */
import type { ConfigReader, FluxPlugin, PluginContext } from '../types';
import { addNavigation, removeNavigation, type NavigationButton } from '../ui/clientToolbar';
import { isTypingTarget, matchesKeybind, parseKeybind } from '../ui/keybind';
import { setSidebarHidden, toggleSidebar } from '../ui/sidebarState';
import { CONFIG_GROUP_KEY, fluxiousConfig } from './fluxiousConfig';

/** Arrow pointing at the edge the panel disappears towards. */
const HIDE_ICON =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#c8c8c8" stroke-width="1.6">
            <path d="M6 3l5 5-5 5M13 2v12"/>
         </svg>`,
    );

let config: ConfigReader | null = null;

const navButton: NavigationButton = {
    tooltip: 'Hide side panel',
    icon: HIDE_ICON,
    // Highest, so it sits at the very foot of the strip, furthest from the panel buttons.
    priority: 100,
    onClick: () => setSidebarHidden(true),
};

/**
 * Hands the player's interface size to the canvas, which resizes itself to suit.
 *
 * The canvas reads the stored value itself for the very first frame — it is sized before any plugin
 * has started — so this matters for a change made while the client is running. Called on start-up
 * too, so the one path is exercised either way rather than only when someone touches the setting.
 */
function applyUiScale(): void {
    window.WebCanvas.setUiScalePercent?.(config?.number('uiScale') ?? 100);
}

function onKeyDown(event: KeyboardEvent): void {
    // Never while the player is writing: a note containing the shortcut letter would otherwise
    // close the panel out from under them.
    if (isTypingTarget(event.target)) {
        return;
    }

    const bind = parseKeybind(config?.string('toggleSidebar') ?? '');

    if (matchesKeybind(event, bind)) {
        // Both, and in the capture phase: preventDefault suppresses the browser's own action for
        // the combination, stopPropagation keeps it away from the game's key handling. Neither is
        // enough for an Alt combination on Windows, where the menu accelerator wins regardless —
        // which is why the default is a function key.
        event.preventDefault();
        event.stopPropagation();
        toggleSidebar();
    }
}

export const fluxiousPlugin: FluxPlugin = {
    descriptor: {
        name: 'Fluxious',
        description: 'Client behaviour: side panel visibility and shortcuts',
        tags: ['client', 'panel'],
        enabledByDefault: true,
        core: true,
    },

    config: fluxiousConfig,

    startUp(context: PluginContext) {
        config = context.config;
        applyUiScale();
        addNavigation(navButton);
        // On the window rather than the panel: the shortcut has to work while the game canvas has
        // focus, which is where a player's keyboard usually is. In the capture phase so it is seen
        // before the client's own key handling claims it.
        window.addEventListener('keydown', onKeyDown, true);
    },

    shutDown() {
        window.removeEventListener('keydown', onKeyDown, true);
        removeNavigation(navButton);

        // Leaving the panel hidden with nothing left to show it again would strand the player.
        setSidebarHidden(false);
        config = null;
    },

    onConfigChanged(group) {
        // The keybind is read fresh on each key press, so nothing to rebuild for that one. The
        // interface size is different: the canvas has to be resized for it to mean anything.
        if (group === CONFIG_GROUP_KEY) {
            applyUiScale();
        }
    },
};
