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
        // The bind is read fresh on each key press, so nothing to rebuild; this only exists to
        // make that deliberate rather than an omission.
        if (group === CONFIG_GROUP_KEY) {
            return;
        }
    },
};
