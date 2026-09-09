/**
 * Settings for the Fluxious plugin — the client's own, rather than an optional extra's.
 */
import { isMobileDevice } from '@/lib/game/device';
import type { ConfigGroup } from '../types';

export const CONFIG_GROUP_KEY = 'fluxious';

/**
 * Which screen edge the reveal button docks against, centred along it.
 *
 * The panel itself always comes out of the right; this is only the button that summons it.
 */
export const REVEAL_POSITIONS = ['top', 'right', 'bottom', 'left'] as const;

export type RevealPosition = (typeof REVEAL_POSITIONS)[number];

/**
 * Left on a phone, right on a desktop.
 *
 * The right edge is where a thumb rests and where the game's own tabs are, so a button there gets
 * caught by accident. There is nothing along the left of the mobile layout to compete with.
 */
const DEFAULT_REVEAL_POSITION: RevealPosition = isMobileDevice() ? 'left' : 'right';

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
            type: 'enum',
            keyName: 'revealPosition',
            name: 'Reveal button edge',
            description: 'Which screen edge the button that shows the side panel sits against.',
            position: 3,
            defaultValue: DEFAULT_REVEAL_POSITION,
            options: [
                { value: 'top', label: 'Top' },
                { value: 'right', label: 'Right' },
                { value: 'bottom', label: 'Bottom' },
                { value: 'left', label: 'Left' },
            ],
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
