/**
 * Developer Tools, following `DevToolsPlugin.java`.
 *
 * The desktop plugin opens a window of toggle buttons and draws what they ask for; this contributes
 * a sidebar panel instead and draws the same things. The toggles are held in memory rather than in
 * config, as the original's are — they are for looking at a problem now, not for remembering.
 *
 * It also owns the renderer's statistics overlay. That one is not drawn here — it belongs to the
 * page, next to the backend it reports on — so the toggle becomes a call to show or hide it.
 */
import { overlayManager } from '../overlay/OverlayManager';
import type { FluxPlugin } from '../types';
import { addNavigation, removeNavigation, type NavigationButton } from '../ui/clientToolbar';
import { DevToolsPanel } from './devToolsPanel';
import { DevToolsPanelOverlay } from './devToolsPanelOverlay';
import { DevToolsSceneOverlay } from './devToolsSceneOverlay';
import { clearToggles, onToggled, toggles } from './devToolsState';

/** The renderer's counters, which exist only once a GPU backend has taken the canvas. */
interface RenderStats {
    show(): void;
    hide(): void;
}

function stats(): RenderStats | null {
    return (window as unknown as { WebGpuStats?: RenderStats }).WebGpuStats ?? null;
}

const panelOverlay = new DevToolsPanelOverlay();
const sceneOverlay = new DevToolsSceneOverlay();

const navButton: NavigationButton = {
    tooltip: 'Developer Tools',
    icon: '/assets/plugins/devtools_icon.png',
    // Last in the strip: useful, but never the thing a player is reaching for.
    priority: 90,
    panel: new DevToolsPanel(),
};

let stopWatching: (() => void) | null = null;

function applyRenderStats(): void {
    const panel = stats();

    if (!panel) {
        return;
    }

    if (toggles.renderStats) {
        panel.show();
    } else {
        panel.hide();
    }
}

export const devToolsPlugin: FluxPlugin = {
    descriptor: {
        name: 'Developer Tools',
        description: 'Developer tools',
        tags: ['dev', 'debug', 'render', 'location', 'camera', 'tile'],
        enabledByDefault: false,
    },

    startUp() {
        overlayManager.add(panelOverlay);
        overlayManager.add(sceneOverlay);
        addNavigation(navButton);

        stopWatching = onToggled((key) => {
            if (key === 'renderStats') {
                applyRenderStats();
            }
        });

        applyRenderStats();
    },

    shutDown() {
        removeNavigation(navButton);
        overlayManager.remove(panelOverlay);
        overlayManager.remove(sceneOverlay);

        stopWatching?.();
        stopWatching = null;

        // Nothing of ours should still be drawing over the game once the plugin is off, including
        // the statistics overlay, which is not ours to leave behind.
        clearToggles();
        stats()?.hide();
    },
};
