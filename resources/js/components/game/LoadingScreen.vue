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
const tips = (tipData.tips ?? []).filter((tip) => typeof tip === 'string' && tip.trim().length > 0);

const tipIndex = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
    if (tips.length > 1) {
        timer = setInterval(() => {
            tipIndex.value = (tipIndex.value + 1) % tips.length;
        }, TIP_INTERVAL_MS);
    }
});

onBeforeUnmount(() => clearInterval(timer));

const percent = computed(() => Math.max(0, Math.min(100, Math.round(loadingProgress.value))));
const currentTip = computed(() => tips[tipIndex.value % Math.max(tips.length, 1)] ?? '');
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
