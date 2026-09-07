<script setup lang="ts">
import bodyBg from '/resources/images/body-bg.webp';
import bodyBgLg from '/resources/images/body-bg-lg.webp';
import bodyBgMd from '/resources/images/body-bg-md.webp';
import bodyBgSm from '/resources/images/body-bg-sm.webp';
import logo from '/resources/images/logo.webp';
import type { BootFailure } from '@/lib/game/bootClient';

/**
 * Shown when the client cannot start.
 *
 * Deliberately shares the loading screen's backdrop: a failure mid-load should look like the same
 * screen resolving badly, not like the site broke. The technical cause is logged to the console
 * rather than shown, so the page never puts server addresses in front of players.
 */
defineProps<{ failure: BootFailure }>();

const backgroundSrcset = [
    `${bodyBgSm} 960w`,
    `${bodyBgMd} 1600w`,
    `${bodyBgLg} 2560w`,
    `${bodyBg} 3840w`,
].join(', ');

function retry(): void {
    window.location.reload();
}
</script>

<template>
    <div class="flx-loading flx-loading--error">
        <img
            class="flx-bg"
            :src="bodyBg"
            :srcset="backgroundSrcset"
            sizes="100vw"
            alt=""
            decoding="async"
        />
        <div class="flx-scrim" />
        <img class="flx-logo" :src="logo" alt="Fluxious" />

        <div class="flx-error" role="alert">
            <h1 class="flx-error-title">{{ failure.title }}</h1>
            <p class="flx-error-message">{{ failure.message }}</p>

            <div class="flx-error-actions">
                <button v-if="failure.retryable" class="flx-btn" type="button" @click="retry">
                    Try again
                </button>
                <a class="flx-btn flx-btn--ghost" href="/">Back to site</a>
            </div>
        </div>
    </div>
</template>
