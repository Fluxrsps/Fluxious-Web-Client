/**
 * Settings for the Fluxious plugin — the client's own, rather than an optional extra's.
 */
import type { ConfigGroup } from '../types';

export const CONFIG_GROUP_KEY = 'fluxious';

export const fluxiousConfig: ConfigGroup = {
    group: CONFIG_GROUP_KEY,
    items: [
        {
            type: 'keybind',
            keyName: 'toggleSidebar',
            name: 'Toggle side panel',
            description: 'Hides and shows the side panel.',
            position: 1,
            // Not an Alt combination: on Windows those are menu accelerators, and the browser
            // acts on them before the page gets a say — Alt+H opens Help. F9 is unclaimed by
            // Chromium and is not a key anyone types into the game.
            defaultValue: 'F9',
        },
        {
            type: 'boolean',
            keyName: 'edgeReveal',
            name: 'Reveal on hover',
            description: 'Show a button near the right edge when the side panel is hidden.',
            position: 2,
            defaultValue: true,
        },
    ],
};
