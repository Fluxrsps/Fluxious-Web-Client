<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import ErrorScreen from '@/components/game/ErrorScreen.vue';
import GameLogin from '@/components/game/GameLogin.vue';
import LoadingScreen from '@/components/game/LoadingScreen.vue';
import PluginSidebar from '@/components/game/PluginSidebar.vue';
import { bootGameClient, type BootFailure } from '@/lib/game/bootClient';
import { connectionLost, installConnectionBridge } from '@/lib/game/connectionState';
import { installDeviceClasses, installFullscreen, installWakeLock, isMobileDevice } from '@/lib/game/device';
import { installLoadingBridge, loadingVisible } from '@/lib/game/loadingState';
import { installLoginBridge, loginVisible } from '@/lib/game/loginState';
import { registerBuiltinPlugins } from '@/plugins';
import { startPluginRuntime } from '@/plugins/runtime';
import { startGameInset } from '@/plugins/ui/gameInset';
import { setSidebarHidden } from '@/plugins/ui/sidebarState';
import '../css/loading-screen.css';
import '../css/game-plugins.css';

/**
 * The client, which is the whole of this site.
 *
 * A canvas the size of the viewport, the loading and login screens drawn over it, and the plugin
 * sidebar beside it. Mounted straight into a Blade view: there is no router and nowhere else to go,
 * so nothing here knows about pages or layouts.
 */

const failure = ref<BootFailure | null>(null);

/** Reuses the boot failure screen: same event to a player, and reloading is the only way out. */
const CONNECTION_LOST: BootFailure = {
    title: 'Connection lost',
    message: 'You were disconnected from the game. Reload to log back in.',
    retryable: true,
};

/**
 * The game viewport, which is not the site's.
 *
 * The rest of the site is a scrollable document; this page is a fixed canvas that must not zoom,
 * bounce or leave a notch gutter. Swapped on mount rather than declared in the layout so the
 * change is scoped to /play, and restored on unmount so a client-side navigation back to the site
 * gets its own viewport again.
 */
const GAME_VIEWPORT =
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

let previousViewport: string | null = null;

function viewportMeta(): HTMLMetaElement | null {
    return document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
}

/** Canvas the plugin overlays draw on, layered over the game's own. */
const overlay = ref<HTMLCanvasElement | null>(null);

let stopPluginRuntime: (() => void) | null = null;
let stopGameInset: (() => void) | null = null;
let stopDeviceClasses: (() => void) | null = null;
let stopWakeLock: (() => void) | null = null;
let stopConnectionBridge: (() => void) | null = null;
let stopFullscreen: (() => void) | null = null;

const mobile = isMobileDevice();

// Called straight from the click: a touch browser ignores a focus outside a user gesture.
function toggleKeyboard(): void {
    window.WebInput?.toggleKeyboard?.();
}

onMounted(async () => {
    const meta = viewportMeta();
    if (meta) {
        previousViewport = meta.content;
        meta.content = GAME_VIEWPORT;
    }

    // Before anything reads them: the login screen picks its layout off these classes.
    stopDeviceClasses = installDeviceClasses();

    // Set once rather than forced, so the toolbar button still opens it.
    if (mobile) {
        setSidebarHidden(true);
    }

    stopWakeLock = installWakeLock();
    stopFullscreen = installFullscreen();

    // Before boot: the client starts raising BeforeRender as soon as it paints, and a runtime
    // installed afterwards would miss frames — and, more visibly, the plugins that draw on them.
    if (overlay.value) {
        registerBuiltinPlugins();
        stopPluginRuntime = startPluginRuntime(overlay.value);
    }

    // Decides, and keeps deciding, whether the plugin chrome forces the game to give up width.
    stopGameInset = startGameInset();

    // The client's runtime scripts report through these; install them all before booting.
    installLoadingBridge();
    installLoginBridge();
    stopConnectionBridge = installConnectionBridge(() => loginVisible.value);
    failure.value = await bootGameClient();
});

onUnmounted(() => {
    const meta = viewportMeta();
    if (meta && previousViewport !== null) {
        meta.content = previousViewport;
    }

    stopPluginRuntime?.();
    stopPluginRuntime = null;
    stopGameInset?.();
    stopGameInset = null;
    stopDeviceClasses?.();
    stopDeviceClasses = null;
    stopWakeLock?.();
    stopWakeLock = null;
    stopConnectionBridge?.();
    stopConnectionBridge = null;
    stopFullscreen?.();
    stopFullscreen = null;
});
</script>

<template>
    <div id="game-host">
        <canvas id="game" width="765" height="503" tabindex="0"></canvas>
        <!-- Sized to #game each frame by the plugin runtime, so overlay coordinates match the
             ones the client draws in. -->
        <canvas id="game-overlay" ref="overlay" width="765" height="503"></canvas>

        <!-- The mobile client's function button. Inside the host so the forced landscape
             rotation carries it round with the game. -->
        <button
            v-if="mobile && !failure && !loadingVisible && !loginVisible"
            type="button"
            class="flx-keyboard-btn"
            title="Keyboard"
            @click="toggleKeyboard"
        >
            ⌨
        </button>
    </div>

    <ErrorScreen v-if="failure" :failure="failure" />
    <ErrorScreen v-else-if="connectionLost" :failure="CONNECTION_LOST" />
    <LoadingScreen v-else-if="loadingVisible" />
    <!-- The client draws no login screen of its own in the browser; this is it. -->
    <GameLogin v-else-if="loginVisible" />

    <!-- Always mounted: #game-host reserves the strip's width, so hiding it would leave a gutter,
         and toggling a plugin before logging in is harmless. -->
    <PluginSidebar v-if="!failure" />
</template>

<style>
/* The client renders pixel art at a fixed size and scales it, so smoothing must stay off. */
#game-host {
    position: fixed;
    inset: 0;
    /* The full viewport by default. The client sizes its canvas from this element (see
       WebJs.gameHostWidth), so insetting it is how the plugin strip is kept off the game — but only
       when the strip would actually reach the canvas; see `flx-game-inset` in game-plugins.css. */
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    overflow: hidden;
}

#game {
    display: block;
    image-rendering: pixelated;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
    touch-action: none;
    /* Hold-to-right-click is a long press, which is also iOS's selection-callout gesture. */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
}

#game-host.game-host--resizable #game {
    width: 100%;
    height: 100%;
}

/* Bottom left, clear of the tab strip on the right and the chat box along the bottom. */
.flx-keyboard-btn {
    position: absolute;
    bottom: max(10px, env(safe-area-inset-bottom));
    left: max(10px, env(safe-area-inset-left));
    z-index: 40;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.25);
    background: rgba(0, 0, 0, 0.55);
    color: #e8e2d6;
    font-size: 20px;
    line-height: 1;
    touch-action: manipulation;
    -webkit-touch-callout: none;
    user-select: none;
}

.flx-keyboard-btn:active {
    background: rgba(0, 0, 0, 0.8);
}

/* Taps must not scroll, zoom or rubber-band the page out from under the client. */
html:has(#game-host),
html:has(#game-host) body {
    overscroll-behavior: none;
    touch-action: none;
}

/*
 * Forced landscape. web/orientation.js sets this class when a touch device is held in portrait and
 * the native orientation lock is unavailable (iOS) or was refused.
 *
 * The layout box is swapped to viewport-height wide by viewport-width tall, then rotated a quarter
 * turn clockwise about its centre. Transforms do not affect layout, so #game-host still reports
 * landscape clientWidth/clientHeight — which is what the client sizes itself from. Pointer
 * coordinates are the exception; web/input.js un-rotates those itself.
 */
html.flux-rotate-landscape #game-host,
html.flux-rotate-landscape .flx-loading,
html.flux-rotate-landscape .flx-login {
    inset: auto;
    top: 50%;
    left: 50%;
    width: 100vh;
    height: 100vw;
    width: 100dvh;
    height: 100dvw;
    transform: translate(-50%, -50%) rotate(90deg);
    transform-origin: center center;
}
</style>
