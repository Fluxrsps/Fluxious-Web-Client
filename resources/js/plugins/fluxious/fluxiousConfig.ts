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

/**
 * How large the game interface is drawn, as a percentage.
 *
 * 100 is one game pixel per screen pixel — on a phone that means the device's own pixels, which is
 * what the real mobile client does, and it leaves the mobile layout's touch-sized widgets looking
 * small on a dense screen. A hand-held screen is held closer and has less of it, so the default
 * asks for larger there.
 *
 * Applied by drawing fewer, bigger game pixels; see `scaleFor` in `web/canvas.js`, which also caps
 * it at the point the layout would start overlapping itself.
 */
const DEFAULT_UI_SCALE = isMobileDevice() ? 150 : 100;

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
            type: 'number',
            keyName: 'uiScale',
            name: 'Interface size',
            description:
                'How large the game interface is drawn, as a percentage. Higher zooms in. How far it'
                + ' can go depends on the screen: past a point the layout runs out of room and stops'
                + ' getting any larger.',
            position: 4,
            defaultValue: DEFAULT_UI_SCALE,
            min: 50,
            max: 200,
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
