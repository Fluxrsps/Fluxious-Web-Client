/**
 * Fullscreen: an action button in the sidebar's foot.
 *
 * Exists to exercise the action half of the toolbar API — a `NavigationButton` with an `onClick`
 * and no panel, which is what `ScreenshotPlugin` builds for the desktop title bar. It is also
 * genuinely useful, since the browser's own fullscreen needs a gesture and so cannot be offered
 * from anywhere but a control like this.
 *
 * The icon is an inline SVG data URI rather than a file: it is two dozen bytes of geometry, and a
 * plugin that needs no assets should not ship an assets directory.
 */
import type { FluxPlugin } from '../types';
import { addNavigation, removeNavigation, type NavigationButton } from '../ui/clientToolbar';

const ENTER_ICON =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#c8c8c8" stroke-width="1.6">
            <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/>
         </svg>`,
    );

const EXIT_ICON =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#f0d75c" stroke-width="1.6">
            <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"/>
         </svg>`,
    );

/** Whatever is currently fullscreen, or null. */
function current(): Element | null {
    return document.fullscreenElement;
}

async function toggle(target: Element): Promise<void> {
    try {
        if (current()) {
            await document.exitFullscreen();
            return;
        }

        await target.requestFullscreen();
    } catch (e) {
        // Denied without a user gesture, or unsupported. Nothing to recover, and nothing worth
        // interrupting the player over.
        console.warn('[fullscreen] request rejected', e);
    }
}

const navButton: NavigationButton = {
    tooltip: 'Fullscreen',
    icon: ENTER_ICON,
    // High, so it sits below anything else that wants the foot of the strip.
    priority: 99,
    onClick: () => void toggle(document.documentElement),
    popup: {
        // The whole page includes the sidebar; this is the game on its own.
        'Fullscreen game only': () => {
            const host = document.getElementById('game-host');

            if (host) {
                void toggle(host);
            }
        },
        'Exit fullscreen': () => {
            if (current()) {
                void document.exitFullscreen();
            }
        },
    },
};

/** Swaps the icon so the button says what it will do next. */
function syncIcon(): void {
    navButton.icon = current() ? EXIT_ICON : ENTER_ICON;
    navButton.tooltip = current() ? 'Exit fullscreen' : 'Fullscreen';

    // Re-adding is how the sidebar learns the button changed; it re-reads the list on every
    // toolbar change rather than watching individual buttons.
    removeNavigation(navButton);
    addNavigation(navButton);
}

export const fullscreenPlugin: FluxPlugin = {
    descriptor: {
        name: 'Fullscreen',
        description: 'Adds a button to put the client fullscreen',
        tags: ['panel', 'screen', 'display'],
        enabledByDefault: true,
    },

    startUp() {
        addNavigation(navButton);
        document.addEventListener('fullscreenchange', syncIcon);
    },

    shutDown() {
        document.removeEventListener('fullscreenchange', syncIcon);
        removeNavigation(navButton);
    },
};
