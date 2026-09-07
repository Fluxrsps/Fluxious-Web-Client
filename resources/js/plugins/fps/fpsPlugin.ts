/**
 * FPS Control, ported from `FpsPlugin.java`.
 *
 * Keeps the same two areas as the original and the same job: hold them up to date and handle setup
 * and teardown. The overlay paints the current FPS; the draw listener paces the client to a target.
 */
import { overlayManager } from '../overlay/OverlayManager';
import type { FluxPlugin, PluginContext } from '../types';
import { CONFIG_GROUP_KEY, fpsConfig } from './fpsConfig';
import { FpsDrawListener } from './fpsDrawListener';
import { FpsOverlay } from './fpsOverlay';

const overlay = new FpsOverlay();
const drawListener = new FpsDrawListener();

export const fpsPlugin: FluxPlugin = {
    descriptor: {
        name: 'FPS Control',
        description: 'Show current FPS and/or set an FPS limit',
        tags: ['frames', 'framerate', 'limit', 'overlay'],
        enabledByDefault: false,
    },

    config: fpsConfig,

    startUp(context: PluginContext) {
        // The page may already be in the background by the time the plugin is switched on.
        const focused = document.hasFocus();

        overlay.config = context.config;
        overlay.onFocusChanged(focused);
        drawListener.onFocusChanged(focused);
        drawListener.reloadConfig(context.config);

        overlayManager.add(overlay);
    },

    shutDown() {
        overlayManager.remove(overlay);
        drawListener.shutDown();
    },

    onConfigChanged(group) {
        if (group === CONFIG_GROUP_KEY) {
            drawListener.reloadConfig();
        }
    },

    onFocusChanged(focused) {
        drawListener.onFocusChanged(focused);
        overlay.onFocusChanged(focused);
    },
};
