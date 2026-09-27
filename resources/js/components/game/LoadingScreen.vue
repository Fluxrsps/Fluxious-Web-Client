<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import bodyBg from '/resources/images/body-bg.webp';
import bodyBgLg from '/resources/images/body-bg-lg.webp';
import bodyBgMd from '/resources/images/body-bg-md.webp';
import bodyBgSm from '/resources/images/body-bg-sm.webp';
import logo from '/resources/images/logo.webp';
import tipData from '/resources/loading-tips.json';
import { loadingProgress, loadingStatus } from '@/lib/game/loadingState';

/**
 * Loading screen for the game client.
 *
 * Artwork and tips come from the site's own assets, so the client shares the site's branding
 * rather than carrying a copy of it. Progress is reported by the boot sequence and then by the
 * client itself; see `lib/game/loadingState`.
 */
// Widths match the exports in resources/images, so the browser can pick the smallest that fits
// instead of always pulling the multi-megabyte original.
const backgroundSrcset = [
    `${bodyBgSm} 960w`,
    `${bodyBgMd} 1600w`,
    `${bodyBgLg} 2560w`,
    `${bodyBg} 3840w`,
].join(', ');

const TIP_INTERVAL_MS = 5000;

/** Tips live on the CDN so they can be edited without a site deploy. */
const TIPS_URL = 'https://cdn.fluxious-rsps.com/tips/didyouknow.json';

const readTips = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.filter((tip): tip is string => typeof tip === 'string' && tip.trim().length > 0)
        : [];

// The bundled tips are what shows first, and what stays up if the CDN is slow, blocked or down.
const tips = ref(readTips(tipData.tips));
const tipIndex = ref(0);

let timer: ReturnType<typeof setInterval> | undefined;
const pending = new AbortController();

/**
 * Replaces the bundled tips with the CDN's once they arrive. A flat array is the file's own shape;
 * an object carrying a `tips` array is taken too, so this reads the site's local file either way.
 */
async function loadTips() {
    try {
        const response = await fetch(TIPS_URL, { signal: pending.signal, cache: 'no-cache' });
        if (!response.ok) {
            return;
        }
        const payload: unknown = await response.json();
        const loaded = readTips(
            Array.isArray(payload) ? payload : (payload as { tips?: unknown } | null)?.tips,
        );
        if (loaded.length === 0) {
            return;
        }
        tips.value = loaded;
        // A random start, so the same few tips are not the ones every player reads.
        tipIndex.value = Math.floor(Math.random() * loaded.length);
    } catch {
        // The bundled tips stay up. A loading screen is not the place to report a failed fetch.
    }
}

onMounted(() => {
    void loadTips();
    // Unconditional: the list can grow from one bundled tip to the CDN's whole set mid-load.
    timer = setInterval(() => {
        if (tips.value.length > 1) {
            tipIndex.value = (tipIndex.value + 1) % tips.value.length;
        }
    }, TIP_INTERVAL_MS);
});

onBeforeUnmount(() => {
    clearInterval(timer);
    pending.abort();
});

const percent = computed(() => Math.max(0, Math.min(100, Math.round(loadingProgress.value))));
const currentTip = computed(
    () => tips.value[tipIndex.value % Math.max(tips.value.length, 1)] ?? '',
);
</script>

<template>
    <div class="flx-loading">
        <img
            class="flx-bg"
            :src="bodyBg"
            :srcset="backgroundSrcset"
            sizes="100vw"
            alt=""
            decoding="async"
            fetchpriority="high"
        />
        <div class="flx-scrim" />
        <div class="flx-fog" />
        <img class="flx-logo" :src="logo" alt="Fluxious" />

        <div class="flx-bottom">
            <div class="flx-row">
                <div class="flx-left">
                    <span class="flx-status">{{ loadingStatus }}</span>
                    <!-- key re-triggers the fade animation per tip -->
                    <span :key="tipIndex" class="flx-tip">{{ currentTip }}</span>
                </div>
                <span class="flx-pct">{{ percent }}<span class="flx-pct-sign">%</span></span>
            </div>
            <div class="flx-track">
                <div class="flx-fill" :style="{ width: `${percent}%` }" />
            </div>
        </div>
    </div>
</template>
