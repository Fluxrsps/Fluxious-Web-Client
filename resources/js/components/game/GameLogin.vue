<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { connectionInfo } from '@/lib/game/connectionState';
import {
    GAME_STATE_LOGGING_IN,
    SCREEN_LOGIN_ERROR,
    SCREEN_TWO_FACTOR,
    backToLogin,
    locationName,
    loginSnapshot,
    refreshWorlds,
    selectWorld,
    setMuted,
    submitLogin,
    submitOtp,
} from '@/lib/game/loginState';
import {
    MAX_SAVES,
    favouritePlayer,
    forgetPlayer,
    lastPlayedLabel,
    savedPlayers,
    toggleFavourite,
} from '@/lib/game/savedPlayers';
import type { SavedPlayer } from '@/lib/game/savedPlayers';
import '../../../css/game-login.css';

/**
 * The game client's login screen.
 *
 * Everything the client owns — which screen is up, the message lines, the world list, whether a
 * login attempt is in flight — arrives through `loginSnapshot` and is never duplicated here. What
 * this component owns is the parts the client has no concept of: the typed credentials before they
 * are submitted, the saved-player list, and the presentation.
 */

const ASSETS = '/assets/game/login';

const TIPS = [
    'Use your In-Game credentials to sign in',
    'Click a saved player to log straight back in',
    'No XP waste!',
    'Star a saved player to fill your login on launch',
];

const ACTIVITY_FILTERS = [
    'Main World',
    'PvP World',
    'Trading hub',
    'Skilling',
    'Boss World',
    'Ironman only',
    'Skill Total 1500',
];

/** Pure-CSS flags, so a new region costs a gradient rather than an image. */
const FLAGS: Record<string, string> = {
    'United States':
        'linear-gradient(#3c3b6e 0 0) left top/45% 55% no-repeat, repeating-linear-gradient(180deg, #b22234 0 10%, #fff 10% 20%)',
    'United Kingdom':
        'linear-gradient(#c8102e 0 0) center/100% 22% no-repeat, linear-gradient(#c8102e 0 0) center/18% 100% no-repeat, linear-gradient(#fff 0 0) center/100% 40% no-repeat, linear-gradient(#fff 0 0) center/32% 100% no-repeat, #012169',
    Germany: 'linear-gradient(180deg, #000 0 33%, #dd0000 33% 66%, #ffce00 66%)',
    Canada: 'linear-gradient(90deg, #d52b1e 0 28%, #fff 28% 72%, #d52b1e 72%)',
    Australia: 'linear-gradient(135deg, #012169 0 60%, #c8102e 60%)',
};

const usernameInput = ref<HTMLInputElement | null>(null);
const passwordInput = ref<HTMLInputElement | null>(null);

const username = ref('');
const password = ref('');
const code = ref('');
const remember = ref(true);
const selectedSave = ref<string | null>(null);
const formError = ref('');
const codeError = ref('');
const tipIndex = ref(0);

const showWorlds = ref(false);
const showLocations = ref(false);
const showActivities = ref(false);
const locationFilters = ref<string[]>([]);
const activityFilters = ref<string[]>([]);
const sortKey = ref<'id' | 'players' | 'ping'>('id');
const sortDir = ref<1 | -1>(1);

/**
 * Round trip to the game server, in milliseconds.
 *
 * The world list carries no latency figure, so it is measured here instead — once per refresh,
 * against the bridge every world currently lives behind. Null until the first measurement lands.
 */
const pingMs = ref<number | null>(null);

let tipTimer: number | undefined;

const snapshot = computed(() => loginSnapshot.value);
const twoFactor = computed(() => snapshot.value?.index === SCREEN_TWO_FACTOR);
const connecting = computed(() => snapshot.value?.gameState === GAME_STATE_LOGGING_IN);
const world = computed(() => snapshot.value?.world ?? 0);
const muted = computed(() => snapshot.value?.muted === true);
// Left unannotated on purpose: the snapshot is a readonly ref, so its world array is deeply
// readonly, and pinning it to LoginWorld[] would be a lie the compiler rejects.
const worlds = computed(() => snapshot.value?.worlds ?? []);

const endpoint = computed(() => {
    const info = connectionInfo.value;
    if (!info) {
        return '';
    }
    return `${info.secure ? 'wss' : 'ws'}://${info.host}:${info.port}/game · rev ${info.revision} · ${info.source}`;
});

const saves = computed(() => savedPlayers.value.slice(0, MAX_SAVES));
const showSaves = computed(() => saves.value.length > 0 && !twoFactor.value);

/**
 * The client's own message lines, when it has something to say.
 *
 * These are the only place the real wording lives — "account disabled", "world is full",
 * "connecting to server" — so whenever the client has filled any of them, they are what is shown.
 *
 * The order is the client's own, not the field numbering: `setLoginMessage` writes its heading to
 * `line1` and its body to `line3`, while `line2` is filled separately by login responses.
 */
const clientMessage = computed(() => {
    const state = snapshot.value;

    if (!state) {
        return null;
    }

    const lines = [state.line1, state.line3, state.line2].filter((line) => line !== '');

    return lines.length > 0 ? lines : null;
});

const messageLines = computed<[string, string]>(() => {
    if (formError.value) {
        return [formError.value, 'Please try again.'];
    }

    const fromClient = clientMessage.value;

    if (fromClient) {
        return [fromClient[0], fromClient[1] ?? ''];
    }

    return ['Enter username / password', ''];
});

const messageIsError = computed(
    () => !connecting.value && (formError.value !== '' || snapshot.value?.index === SCREEN_LOGIN_ERROR),
);

const codeMessageLines = computed<[string, string]>(() => {
    if (connecting.value) {
        return ['Connecting to server…', ''];
    }

    if (codeError.value) {
        return [codeError.value, 'Please try again.'];
    }

    return ['Enter the 6-digit code', 'from your authenticator app'];
});

// Tips only. Connection state belongs on the panel, next to the fields it is about, and the client
// says it better there — repeating it down here just puts the same sentence on screen twice.
const statusText = computed(() => TIPS[tipIndex.value % TIPS.length]);

const locationOptions = computed(() => {
    const names = new Set<string>();

    for (const entry of worlds.value) {
        names.add(locationName(entry.location));
    }

    return ['All', ...Array.from(names).sort()];
});

const visibleWorlds = computed(() => {
    const rows = worlds.value.filter((entry) => {
        const activityOk = activityFilters.value.length === 0 || activityFilters.value.includes(entry.activity);
        const locationOk =
            locationFilters.value.length === 0 || locationFilters.value.includes(locationName(entry.location));

        return activityOk && locationOk;
    });
    const key = sortKey.value;

    return rows.sort((a, b) => {
        if (key === 'ping') {
            return 0;
        }

        return (a[key] - b[key]) * sortDir.value;
    });
});

function flagFor(location: string): string {
    return FLAGS[location] ?? '#3f3f3f';
}

function initial(name: string): string {
    return name.charAt(0).toUpperCase();
}

/**
 * Second line of a saved-player card: total level and when they last played.
 *
 * The level is left out entirely until the client has reported one, rather than showing a zero:
 * a save made before the character first reached the world has nothing truthful to put there.
 */
function saveMeta(save: SavedPlayer): string {
    const played = lastPlayedLabel(save.lastPlayed);

    return save.totalLevel > 0 ? `Lvl ${save.totalLevel} · ${played}` : played;
}

function playerCountLabel(count: number): string {
    if (count < 0) {
        return 'Offline';
    }

    return String(count);
}

/** Fills the form from a save without submitting it. */
function fillFromSave(save: SavedPlayer): void {
    username.value = save.name;
    password.value = save.password;
    selectedSave.value = save.name;
    formError.value = '';

    if (save.world > 0) {
        selectWorld(save.world);
    }
}

/**
 * Clicking a saved player logs straight in.
 *
 * A save with no stored password can only fill the username — one written before passwords were
 * kept, or by a player who logged in with "Remember me" off. Those fall back to filling the form
 * and putting the cursor in the password field.
 */
function useSave(save: SavedPlayer): void {
    fillFromSave(save);

    if (save.password === '') {
        passwordInput.value?.focus();

        return;
    }

    play();
}

function onFavourite(save: SavedPlayer, wasFavourite: boolean): void {
    toggleFavourite(save.name);

    if (!wasFavourite) {
        fillFromSave(save);
    }
}

function onForget(name: string): void {
    forgetPlayer(name);

    if (selectedSave.value === name) {
        selectedSave.value = null;
    }
}

function play(): void {
    if (connecting.value) {
        return;
    }

    if (username.value.trim() === '' || password.value === '') {
        formError.value = 'Invalid username or password.';

        return;
    }

    formError.value = '';
    submitLogin(username.value.trim(), password.value, world.value, remember.value);
}

/**
 * Enter walks the form the way the game client's own login screen does.
 *
 * From the username field it moves to the password. From the password field it logs in if there is
 * something to send, and otherwise goes back to the username rather than submitting an attempt that
 * can only fail — which matches how the client's key handler treats Tab and Enter between the two.
 */
function onUsernameEnter(): void {
    passwordInput.value?.focus();
}

function onPasswordEnter(): void {
    if (password.value === '') {
        usernameInput.value?.focus();

        return;
    }

    play();
}

function confirmCode(): void {
    if (connecting.value) {
        return;
    }

    if (code.value.length < 6) {
        codeError.value = 'Invalid code.';

        return;
    }

    codeError.value = '';
    submitOtp(code.value);
}

function onCodeInput(event: Event): void {
    code.value = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
}

function goBack(): void {
    code.value = '';
    codeError.value = '';
    password.value = '';
    backToLogin();
}

function pickWorld(id: number): void {
    selectWorld(id);
    showWorlds.value = false;
}

function closeWorlds(): void {
    showWorlds.value = false;
    showLocations.value = false;
    showActivities.value = false;
}

function toggleSort(key: 'players' | 'ping'): void {
    if (sortKey.value === key) {
        sortDir.value = sortDir.value === 1 ? -1 : 1;

        return;
    }

    sortKey.value = key;
    // Players reads best busiest-first; ping reads best fastest-first.
    sortDir.value = key === 'players' ? -1 : 1;
}

function nextFilter(current: string[], value: string): string[] {
    if (value === 'All') {
        return [];
    }

    return current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
}

function toggleLocation(value: string): void {
    locationFilters.value = nextFilter(locationFilters.value, value);
}

function toggleActivity(value: string): void {
    activityFilters.value = nextFilter(activityFilters.value, value);
}

function isFilterActive(list: string[], value: string): boolean {
    return value === 'All' ? list.length === 0 : list.includes(value);
}

/** Times a one-byte request to the server the worlds live behind. */
async function measurePing(): Promise<void> {
    const base = window.__webConfig?.cacheBaseUrl;

    if (!base) {
        return;
    }

    const started = performance.now();

    try {
        await fetch(`${base}/cache/main_file_cache.idx255`, {
            headers: { Range: 'bytes=0-0' },
            cache: 'no-store',
            signal: AbortSignal.timeout(4000),
        });
        pingMs.value = Math.round(performance.now() - started);
    } catch {
        pingMs.value = null;
    }
}

function onRefresh(): void {
    refreshWorlds();
    void measurePing();
}

watch(
    () => saves.value.length,
    () => {
        // Auto-fill from the favourite, but never overwrite something already typed.
        if (username.value !== '') {
            return;
        }

        const favourite = favouritePlayer();

        if (favourite) {
            fillFromSave(favourite);
        }
    },
    { immediate: true },
);

// Saving a successful login is handled by the bridge in `loginState`, not here: this component is
// unmounted the moment the login screen goes away, which is exactly the transition worth saving on.

onMounted(() => {
    tipTimer = window.setInterval(() => {
        tipIndex.value += 1;
    }, 6000);
    void measurePing();
});

onUnmounted(() => {
    window.clearInterval(tipTimer);
});
</script>

<template>
    <div class="flx-login">
        <div class="flx-login__logo-bar">
            <img class="flx-login__logo" :src="`${ASSETS}/logo.webp`" alt="Fluxious" />
        </div>

        <div class="flx-login__main">
            <!-- Saved players -->
            <div v-if="showSaves" class="flx-panel flx-saves">
                <div class="flx-panel__header">
                    <span class="flx-panel__title">Saved players</span>
                </div>
                <div class="flx-saves__list">
                    <div
                        v-for="save in saves"
                        :key="save.name"
                        class="flx-save"
                        :class="{ 'flx-save--selected': selectedSave === save.name }"
                        role="button"
                        tabindex="0"
                        @click="useSave(save)"
                        @keydown.enter.prevent="useSave(save)"
                        @keydown.space.prevent="useSave(save)"
                    >
                        <span class="flx-save__avatar">{{ initial(save.name) }}</span>
                        <span class="flx-save__text">
                            <span class="flx-save__name">{{ save.name }}</span>
                            <span class="flx-save__meta">{{ saveMeta(save) }}</span>
                        </span>
                        <button
                            type="button"
                            class="flx-save__btn flx-save__btn--fav"
                            :class="{ 'flx-save__btn--fav-on': save.fav }"
                            :title="save.fav ? 'Favorite — auto-fills on launch' : 'Mark as favorite'"
                            @click.stop="onFavourite(save, save.fav)"
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                :fill="save.fav ? '#f0d75c' : 'none'"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <polygon
                                    points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                                />
                            </svg>
                        </button>
                        <button
                            type="button"
                            class="flx-save__btn flx-save__btn--forget"
                            title="Forget this player"
                            @click.stop="onForget(save.name)"
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path d="M3 6h18" />
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="flx-saves__footer">{{ saves.length }} of {{ MAX_SAVES }} saves used</div>
            </div>

            <div class="flx-login__centre">
                <img class="flx-login__logo flx-login__logo--inline" :src="`${ASSETS}/logo.webp`" alt="Fluxious" />

                <!-- Credentials -->
                <div
                    v-if="!twoFactor"
                    class="flx-panel flx-login__form"
                    :class="showSaves ? 'flx-login__form--with-saves' : 'flx-login__form--alone'"
                >
                    <div class="flx-panel__header">
                        <span class="flx-panel__title">Welcome to Fluxious</span>
                    </div>
                    <form class="flx-panel__body" @submit.prevent="play">
                        <div class="flx-msg" :class="{ 'flx-msg--error': messageIsError }">
                            {{ messageLines[0] }}
                            <template v-if="messageLines[1]"><br />{{ messageLines[1] }}</template>
                        </div>

                        <label class="flx-field">
                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#99b3b3"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                            </svg>
                            <input
                                ref="usernameInput"
                                v-model="username"
                                class="flx-field__input"
                                placeholder="Username"
                                autocomplete="username"
                                spellcheck="false"
                                @keydown.enter.prevent="onUsernameEnter"
                            />
                        </label>

                        <label class="flx-field">
                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#99b3b3"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <rect width="18" height="11" x="3" y="11" rx="0" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                            <input
                                ref="passwordInput"
                                v-model="password"
                                class="flx-field__input"
                                type="password"
                                placeholder="Password"
                                autocomplete="current-password"
                                @keydown.enter.prevent="onPasswordEnter"
                            />
                        </label>

                        <button type="button" class="flx-remember" @click="remember = !remember">
                            <span class="flx-check">{{ remember ? '✓' : '' }}</span>
                            <span>Remember me</span>
                        </button>

                        <button type="submit" class="flx-imgbtn" title="Play now" :disabled="connecting">
                            <img :src="`${ASSETS}/login_button_n.png`" alt="Play now" />
                            <img class="flx-imgbtn__hover" :src="`${ASSETS}/login_button_h.png`" alt="" />
                        </button>
                    </form>
                </div>

                <!-- Two-factor -->
                <div v-else class="flx-panel flx-2fa">
                    <div class="flx-panel__header">
                        <span class="flx-panel__title">Two-factor authentication</span>
                    </div>
                    <form class="flx-panel__body" @submit.prevent="confirmCode">
                        <div class="flx-msg" :class="{ 'flx-msg--error': codeError !== '' }">
                            {{ codeMessageLines[0] }}
                            <template v-if="codeMessageLines[1]"><br />{{ codeMessageLines[1] }}</template>
                        </div>
                        <input
                            class="flx-2fa__code"
                            :value="code"
                            inputmode="numeric"
                            autocomplete="one-time-code"
                            placeholder="••••••"
                            maxlength="6"
                            @input="onCodeInput"
                        />
                        <button type="submit" class="flx-imgbtn" title="Confirm" :disabled="connecting">
                            <img :src="`${ASSETS}/login_button_n.png`" alt="Confirm" />
                            <img class="flx-imgbtn__hover" :src="`${ASSETS}/login_button_h.png`" alt="" />
                        </button>
                        <button type="button" class="flx-link" @click="goBack">Back to login</button>
                    </form>
                </div>
            </div>
        </div>

        <!-- Bottom bar -->
        <div class="flx-bar">
            <button type="button" class="flx-bar__world" @click="showWorlds = true">
                <span class="flx-bar__dot" />
                World {{ world }}
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="m6 15 6-6 6 6" />
                </svg>
            </button>

            <span v-if="endpoint" class="flx-bar__endpoint" :title="endpoint">{{ endpoint }}</span>

            <div class="flx-bar__tip">
                <span class="flx-bar__tip-label">Tip:</span>
                <span class="flx-bar__tip-text">{{ statusText }}</span>
            </div>

            <button type="button" class="flx-bar__music" title="Music" @click="setMuted(!muted)">
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    :stroke="muted ? '#6d6d6d' : '#99b3b3'"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                    <path v-if="muted" d="M3 3l18 18" stroke="#a84444" />
                </svg>
            </button>
        </div>

        <!-- World select -->
        <div v-if="showWorlds" class="flx-modal" @click="closeWorlds">
            <div class="flx-panel flx-modal__panel" @click.stop>
                <div class="flx-panel__header flx-modal__header">
                    <button type="button" class="flx-iconbtn" title="Refresh" @click="onRefresh">
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                            <path d="M21 3v5h-5" />
                            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                            <path d="M3 21v-5h5" />
                        </svg>
                        Refresh
                    </button>
                    <span class="flx-modal__titles">
                        <span class="flx-panel__title">Select a world</span>
                        <span class="flx-modal__subtitle">Please choose a game world from the list</span>
                    </span>
                    <button type="button" class="flx-iconbtn" title="Close" @click="closeWorlds">
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div class="flx-modal__body">
                    <div class="flx-worlds__head">
                        <span class="flx-worlds__head-cell">
                            World
                            <button
                                type="button"
                                class="flx-funnel"
                                :class="{ 'flx-funnel--on': locationFilters.length > 0 || showLocations }"
                                title="Filter by location"
                                @click.stop="
                                    showLocations = !showLocations;
                                    showActivities = false;
                                "
                            >
                                <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                >
                                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                                </svg>
                            </button>
                            <div v-if="showLocations" class="flx-dropdown" @click.stop>
                                <button
                                    v-for="option in locationOptions"
                                    :key="option"
                                    type="button"
                                    class="flx-dropdown__item"
                                    :class="{
                                        'flx-dropdown__item--on': isFilterActive(locationFilters, option),
                                    }"
                                    @click="toggleLocation(option)"
                                >
                                    <span class="flx-dropdown__check">{{
                                        isFilterActive(locationFilters, option) ? '✓' : ''
                                    }}</span>
                                    <span class="flx-flag" :style="{ background: flagFor(option) }" />
                                    {{ option }}
                                </button>
                            </div>
                        </span>

                        <button type="button" class="flx-sort" @click="toggleSort('players')">
                            Players
                            <span class="flx-sort__arrows">
                                <span
                                    class="flx-sort__arrow"
                                    :class="{ 'flx-sort__arrow--on': sortKey === 'players' && sortDir === 1 }"
                                    >▲</span
                                >
                                <span
                                    class="flx-sort__arrow"
                                    :class="{ 'flx-sort__arrow--on': sortKey === 'players' && sortDir === -1 }"
                                    >▼</span
                                >
                            </span>
                        </button>

                        <span class="flx-worlds__head-cell">
                            Activity / Location
                            <button
                                type="button"
                                class="flx-funnel"
                                :class="{ 'flx-funnel--on': activityFilters.length > 0 || showActivities }"
                                title="Filter by activity"
                                @click.stop="
                                    showActivities = !showActivities;
                                    showLocations = false;
                                "
                            >
                                <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                >
                                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                                </svg>
                            </button>
                            <div v-if="showActivities" class="flx-dropdown" @click.stop>
                                <button
                                    v-for="option in ['All', ...ACTIVITY_FILTERS]"
                                    :key="option"
                                    type="button"
                                    class="flx-dropdown__item"
                                    :class="{
                                        'flx-dropdown__item--on': isFilterActive(activityFilters, option),
                                    }"
                                    @click="toggleActivity(option)"
                                >
                                    <span class="flx-dropdown__check">{{
                                        isFilterActive(activityFilters, option) ? '✓' : ''
                                    }}</span>
                                    {{ option }}
                                </button>
                            </div>
                        </span>

                        <button type="button" class="flx-sort" @click="toggleSort('ping')">
                            Ping
                            <span class="flx-sort__arrows">
                                <span
                                    class="flx-sort__arrow"
                                    :class="{ 'flx-sort__arrow--on': sortKey === 'ping' && sortDir === 1 }"
                                    >▲</span
                                >
                                <span
                                    class="flx-sort__arrow"
                                    :class="{ 'flx-sort__arrow--on': sortKey === 'ping' && sortDir === -1 }"
                                    >▼</span
                                >
                            </span>
                        </button>
                    </div>

                    <div class="flx-worlds__list">
                        <button
                            v-for="entry in visibleWorlds"
                            :key="entry.id"
                            type="button"
                            class="flx-worlds__row"
                            :class="{ 'flx-worlds__row--selected': entry.id === world }"
                            @click="pickWorld(entry.id)"
                        >
                            <span class="flx-worlds__id">
                                <span
                                    class="flx-flag"
                                    :title="locationName(entry.location)"
                                    :style="{ background: flagFor(locationName(entry.location)) }"
                                />
                                World {{ entry.id }}
                            </span>
                            <span class="flx-worlds__muted">{{ playerCountLabel(entry.players) }}</span>
                            <span class="flx-worlds__muted">{{ entry.activity }}</span>
                            <span class="flx-worlds__muted">{{ pingMs === null ? '—' : `${pingMs}ms` }}</span>
                        </button>
                        <div v-if="visibleWorlds.length === 0" class="flx-worlds__empty">
                            {{ worlds.length === 0 ? 'Waiting for the world list…' : 'No worlds match those filters.' }}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
