/**
 * GPU, ported from `GpuPlugin.java`.
 *
 * The renderer itself is not here. It is the client's — Java assembles the geometry and the page's
 * WebGPU or WebGL2 backend draws it, and both are running before any plugin loads. What this plugin
 * owns is the settings: the same ones the desktop plugin has, feeding the same uniforms.
 *
 * Marked `core`, so it sorts to the top of the list and has no switch. A browser that can render on
 * the GPU renders on the GPU; there is no version of this client where turning it off is the right
 * answer, and the software path exists only for a browser that cannot.
 */
import type { FluxPlugin, PluginContext } from '../types';
import { CONFIG_GROUP_KEY, gpuConfig, readGpuSettings } from './gpuConfig';

/** The page-side renderer, which exists only once a backend has taken the canvas. */
interface GpuScene {
    configure(changes: Record<string, unknown>): void;
    ready: boolean;
}

function scene(): GpuScene | null {
    return (window as unknown as { WebGpuScene?: GpuScene }).WebGpuScene ?? null;
}

let reader: PluginContext['config'] | null = null;
let waiting: ReturnType<typeof setInterval> | null = null;

/**
 * Pushes the settings to the renderer, waiting for it if it is not up yet.
 *
 * Plugins are registered as the page loads and the renderer's scripts load alongside them, so which
 * arrives first is not something either can rely on. This used to give up silently when the renderer
 * was not there, which meant every stored setting was quietly dropped on start-up and only took
 * effect if the player later changed something. Anything switched on by default therefore appeared
 * not to work at all.
 */
function apply(): void {
    if (!reader) {
        return;
    }

    const target = scene();

    if (target) {
        target.configure(readGpuSettings(reader));
        stopWaiting();

        return;
    }

    if (!waiting) {
        waiting = setInterval(apply, 250);
    }
}

function stopWaiting(): void {
    if (waiting) {
        clearInterval(waiting);
        waiting = null;
    }
}

export const gpuPlugin: FluxPlugin = {
    descriptor: {
        name: 'GPU',
        description: 'Utilizes the GPU to draw the game',
        tags: ['fog', 'draw', 'distance', 'render', 'renderer', 'webgpu', 'webgl'],
        enabledByDefault: true,
        core: true,
    },

    config: gpuConfig,

    startUp(context: PluginContext) {
        reader = context.config;
        apply();
    },

    shutDown() {
        stopWaiting();
        reader = null;
    },

    onConfigChanged(group) {
        if (group === CONFIG_GROUP_KEY) {
            apply();
        }
    },
};
