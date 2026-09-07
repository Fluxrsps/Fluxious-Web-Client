/**
 * The plugin host: registry, lifecycle, event dispatch and the overlay render pass.
 *
 * Together with `configStore` this is what `PluginManager`, `EventBus` and `OverlayManager` do on
 * desktop, collapsed into one small module because the browser build has one thread, one canvas
 * and no dependency injection to arrange.
 *
 * The client reaches this through `window.FluxPlugins.event(id, handle)`, installed by
 * {@link startPluginRuntime}, which hands it to the event bus. Everything else is driven from the
 * page.
 */
import { client } from './api/game';
import { dispatchEvent, subscribe } from './eventBus';
import {
    isPluginEnabled,
    isPluginFavourite,
    onConfigChanged,
    readerFor,
    setPluginEnabled,
    setPluginFavourite,
} from './configStore';
import { installManagedOverlays, tooltipOverlay } from './overlay/InfoBoxManager';
import { RENDERED_LAYERS } from './overlay/OverlayEnums';
import { overlayRenderer } from './overlay/OverlayRenderer';
import type { FluxPlugin, PluginContext } from './types';

declare global {
    interface Window {
        /**
         * The client's view of the page. `event` is called by `WebCallbacks` with an event id and a
         * handle to the event object; `frameLimit` is read back by `web.FrameLimiter` once a frame,
         * which is how a plugin paces the client without being able to block the thread the page
         * paints on.
         */
        FluxPlugins?: {
            event(id: number, handle: number): void;
            /** Frames per second to pace the client to; 0 leaves it unthrottled. */
            frameLimit?: number;
        };
    }
}

interface Registration {
    plugin: FluxPlugin;
    enabled: boolean;
    context: PluginContext;
    /** Subscriptions the plugin made through its context, dropped when it stops. */
    subscriptions: (() => void)[];
}

const registrations = new Map<string, Registration>();

let overlay: HTMLCanvasElement | null = null;
let overlayCtx: CanvasRenderingContext2D | null = null;
let started = false;

/** Notifies the Vue layer that the enabled set or a plugin's state changed. */
type RegistryListener = () => void;
const registryListeners = new Set<RegistryListener>();

export function onRegistryChanged(listener: RegistryListener): () => void {
    registryListeners.add(listener);

    return () => registryListeners.delete(listener);
}

function announceRegistry(): void {
    for (const listener of registryListeners) {
        listener();
    }
}

function contextFor(plugin: FluxPlugin, registration: () => Registration): PluginContext {
    return {
        client,
        // Subscriptions are the plugin's for as long as it is running: recorded here and dropped
        // by stop(), so a switched-off plugin stops receiving events without having to unsubscribe
        // itself. This is what the desktop lifecycle does with its @Subscribe methods.
        subscribe: (name, handler) => {
            const remove = subscribe(name, handler);
            registration().subscriptions.push(remove);

            return remove;
        },
        config: plugin.config
            ? readerFor(plugin.config)
            : {
                  boolean: () => false,
                  number: () => 0,
                  string: () => '',
              },
    };
}

/**
 * Adds a plugin and starts it if it is enabled.
 *
 * Registration is separate from starting so the plugin list can show everything available while
 * only the enabled ones are running, which is how the desktop side behaves too.
 */
export function registerPlugin(plugin: FluxPlugin): void {
    const name = plugin.descriptor.name;

    if (registrations.has(name)) {
        return;
    }

    const registration: Registration = {
        plugin,
        enabled: false,
        // Filled in below: the context needs the registration to record subscriptions against,
        // and the registration needs the context.
        context: undefined as unknown as PluginContext,
        subscriptions: [],
    };

    registration.context = contextFor(plugin, () => registration);

    registrations.set(name, registration);

    if (isPluginEnabled(name, plugin.descriptor.enabledByDefault)) {
        start(registration);
    }

    announceRegistry();
}

function start(registration: Registration): void {
    if (registration.enabled) {
        return;
    }

    registration.enabled = true;

    try {
        registration.plugin.startUp?.(registration.context);
    } catch (e) {
        // One broken plugin must not stop the others, and must not take the page with it.
        console.error(`[plugins] ${registration.plugin.descriptor.name} failed to start`, e);
    }
}

function stop(registration: Registration): void {
    if (!registration.enabled) {
        return;
    }

    registration.enabled = false;

    for (const remove of registration.subscriptions) {
        remove();
    }

    registration.subscriptions.length = 0;

    try {
        registration.plugin.shutDown?.();
    } catch (e) {
        console.error(`[plugins] ${registration.plugin.descriptor.name} failed to stop`, e);
    }
}

export function setEnabled(pluginName: string, enabled: boolean): void {
    const registration = registrations.get(pluginName);

    if (!registration) {
        return;
    }

    // A core plugin carries client behaviour, not an optional extra. Refused here rather than only
    // hidden in the UI, so nothing can switch one off by calling this directly.
    if (registration.plugin.descriptor.core && !enabled) {
        return;
    }

    setPluginEnabled(pluginName, enabled);
    enabled ? start(registration) : stop(registration);
    announceRegistry();
}

export interface PluginSummary {
    name: string;
    description: string;
    tags: string[];
    enabled: boolean;
    hasSettings: boolean;
    /** Pinned to the top of the list and not switchable. */
    core: boolean;
    /** Starred by the player; sorts above the rest. */
    favourite: boolean;
}

export function listPlugins(): PluginSummary[] {
    return [...registrations.values()]
        .map((registration) => ({
            name: registration.plugin.descriptor.name,
            description: registration.plugin.descriptor.description,
            tags: registration.plugin.descriptor.tags,
            enabled: registration.enabled,
            // Visible items only: a group whose every item is hidden — Notes, which keeps its
            // text in config — would otherwise offer a cog opening an empty panel.
            hasSettings: Boolean(registration.plugin.config?.items.some((item) => !item.hidden)),
            core: Boolean(registration.plugin.descriptor.core),
            favourite: isPluginFavourite(registration.plugin.descriptor.name),
        }))
        // Core first, then starred, then alphabetical: what belongs to the client, then what the
        // player marked, then everything else.
        .sort(
            (a, b) =>
                Number(b.core) - Number(a.core) ||
                Number(b.favourite) - Number(a.favourite) ||
                a.name.localeCompare(b.name),
        );
}

export function setFavourite(pluginName: string, favourite: boolean): void {
    setPluginFavourite(pluginName, favourite);
    announceRegistry();
}

export function pluginConfig(pluginName: string): FluxPlugin['config'] {
    return registrations.get(pluginName)?.plugin.config;
}

function forEachEnabled(visit: (registration: Registration) => void): void {
    for (const registration of registrations.values()) {
        if (!registration.enabled) {
            continue;
        }

        try {
            visit(registration);
        } catch (e) {
            console.error(`[plugins] ${registration.plugin.descriptor.name} threw`, e);
        }
    }
}

/**
 * Puts the overlay canvas exactly on top of the game canvas.
 *
 * Two things have to agree, and they are not the same thing. The backing store must match `#game`'s
 * so an overlay drawing at `canvas.width - w` lands on the game's right edge — overlays work in the
 * client's pixel space, not the page's. The CSS box must match `#game`'s box on screen, because
 * `#game-host` fills the viewport and centres the canvas inside it: an overlay stretched to the
 * host is both the wrong size and in the wrong place, and non-uniformly scaled with it.
 *
 * Driven by a ResizeObserver rather than the render loop so it costs no layout read per frame.
 */
function syncOverlayGeometry(): void {
    const game = document.getElementById('game') as HTMLCanvasElement | null;

    if (!overlay || !game) {
        return;
    }

    if (overlay.width !== game.width || overlay.height !== game.height) {
        overlay.width = game.width;
        overlay.height = game.height;
    }

    // offsetParent for both is #game-host, which is positioned, so these share an origin.
    const left = `${game.offsetLeft}px`;
    const top = `${game.offsetTop}px`;
    const width = `${game.offsetWidth}px`;
    const height = `${game.offsetHeight}px`;

    if (overlay.style.left !== left) {
        overlay.style.left = left;
    }
    if (overlay.style.top !== top) {
        overlay.style.top = top;
    }
    if (overlay.style.width !== width) {
        overlay.style.width = width;
    }
    if (overlay.style.height !== height) {
        overlay.style.height = height;
    }
}

/**
 * Draws every layer for one frame.
 *
 * The canvas is cleared here rather than by each overlay, so an overlay that draws nothing this
 * frame does not have to remember to erase what it drew last frame.
 *
 * Layers are walked in the order the client reaches them. They currently all land on this one
 * canvas above the game — the compositing that puts `ABOVE_SCENE` genuinely beneath widgets is the
 * client-side half, and until it lands the ordering is right even though the depth is not.
 */
function renderOverlays(): void {
    if (!overlay || !overlayCtx) {
        return;
    }

    // Cheap safety net: property reads, no layout. The CSS box is kept in step by
    // syncOverlayGeometry, which only runs when something actually resizes.
    const game = document.getElementById('game') as HTMLCanvasElement | null;

    if (game && (overlay.width !== game.width || overlay.height !== game.height)) {
        syncOverlayGeometry();
    }

    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

    for (const layer of RENDERED_LAYERS) {
        overlayRenderer.renderLayer(overlayCtx, layer);
    }
}


/**
 * Installs the client-facing hook and the page-side event sources.
 *
 * Focus is raised here rather than in Java: the client has no AWT focus events in the browser, and
 * the page already knows when it loses the window.
 */
export function startPluginRuntime(overlayCanvas: HTMLCanvasElement): () => void {
    overlay = overlayCanvas;
    overlayCtx = overlayCanvas.getContext('2d');

    const detachRenderer = overlayRenderer.attach(overlayCanvas);
    installManagedOverlays();

    // The canvas moves whenever either it or the host resizes: the client swaps canvas size on a
    // fixed/resizable change, and the host recentres it on any window resize.
    syncOverlayGeometry();

    const geometryObserver = new ResizeObserver(() => syncOverlayGeometry());
    const game = document.getElementById('game');
    const host = document.getElementById('game-host');

    if (game) {
        geometryObserver.observe(game);
    }
    if (host) {
        geometryObserver.observe(host);
    }

    // Tooltips follow the pointer, so the manager needs to know where it is.
    const onMove = (e: PointerEvent) => {
        const rect = overlayCanvas.getBoundingClientRect();
        tooltipOverlay.setMouse(
            ((e.clientX - rect.left) / rect.width) * overlayCanvas.width,
            ((e.clientY - rect.top) / rect.height) * overlayCanvas.height,
        );
    };
    window.addEventListener('pointermove', onMove);

    if (started) {
        return () => undefined;
    }

    started = true;

    window.FluxPlugins = {
        event: (id: number, handle: number) => dispatchEvent(id, handle),
        // Explicitly unthrottled until a plugin asks otherwise, so the client never reads undefined.
        frameLimit: 0,
    };

    // The overlays are drawn from BeforeRender, subscribed here rather than by each plugin: an
    // overlay belongs to the manager, and the client should be posting the event whenever the
    // runtime is up regardless of which plugins are on.
    const stopRenderPass = subscribe('BeforeRender', renderOverlays);

    const onFocus = () => forEachEnabled((r) => r.plugin.onFocusChanged?.(true));
    const onBlur = () => forEachEnabled((r) => r.plugin.onFocusChanged?.(false));

    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    const stopConfigWatch = onConfigChanged((group, keyName) => {
        forEachEnabled((r) => r.plugin.onConfigChanged?.(group, keyName));
    });

    return () => {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        stopRenderPass();
        stopConfigWatch();
        geometryObserver.disconnect();
        detachRenderer();
        window.removeEventListener('pointermove', onMove);
        delete window.FluxPlugins;
        overlay = null;
        overlayCtx = null;
        started = false;
    };
}
