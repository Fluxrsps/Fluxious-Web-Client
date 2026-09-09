/**
 * The plugin set the client boots with.
 *
 * Registering here rather than scanning a directory keeps the list something you read rather than
 * infer, and keeps Vite's bundling static — a plugin that is not in this file is not shipped.
 */
import { isMobileDevice } from '@/lib/game/device';
import { devToolsPlugin } from './devtools/devToolsPlugin';
import { fluxiousPlugin } from './fluxious/fluxiousPlugin';
import { fpsPlugin } from './fps/fpsPlugin';
import { fullscreenPlugin } from './fullscreen/fullscreenPlugin';
import { gpuPlugin } from './gpu/gpuPlugin';
import { notesPlugin } from './notes/notesPlugin';
import { registerPlugin } from './runtime';

let registered = false;

export function registerBuiltinPlugins(): void {
    // Play.vue can mount more than once in a session; plugins are registered for the page, not the
    // component, and registerPlugin ignores repeats anyway.
    if (registered) {
        return;
    }

    registered = true;

    // The client's own plugin first, so it heads the list before anything optional.
    registerPlugin(fluxiousPlugin);
    registerPlugin(gpuPlugin);
    registerPlugin(fpsPlugin);
    registerPlugin(notesPlugin);

    // Not on a phone: the page already goes fullscreen on the first tap, and there is no window
    // to be fullscreen relative to, so the button is a control that does nothing a player wants.
    if (!isMobileDevice()) {
        registerPlugin(fullscreenPlugin);
    }

    registerPlugin(devToolsPlugin);
}
