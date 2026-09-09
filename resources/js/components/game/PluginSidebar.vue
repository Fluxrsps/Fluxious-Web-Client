<script setup lang="ts">
/**
 * Plugin chrome for the /play client: a tab strip, the plugin list, the settings panel, and one
 * tab per panel a plugin has contributed.
 *
 * Stands in for `ClientToolbar` and its `NavigationButton`s. One panel is open at a time and the
 * strip stays visible, so the game viewport underneath never changes size when a player switches
 * panels.
 *
 * Plugin panels build plain DOM into a host element rather than being Vue components, so a plugin
 * never has to import the page's framework; see `ui/clientToolbar`.
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import PluginSettings from '@/components/game/PluginSettings.vue';
import { isMobileDevice } from '@/lib/game/device';
import { onConfigChanged, readValue } from '@/plugins/configStore';
import { CONFIG_GROUP_KEY, fluxiousConfig, type RevealPosition } from '@/plugins/fluxious/fluxiousConfig';
import { resetValue } from '@/plugins/configStore';
import { listPlugins, onRegistryChanged, pluginConfig, setEnabled, setFavourite } from '@/plugins/runtime';
import {
    isSidebarHidden,
    onSidebarVisibilityChanged,
    setSidebarHidden,
    setSidebarPanelOpen,
} from '@/plugins/ui/sidebarState';
import {
    listActionNavigations,
    listPanelNavigations,
    onToolbarChanged,
    type NavigationButton,
} from '@/plugins/ui/clientToolbar';

/** Either the built-in plugin list, or the tooltip of a plugin-contributed panel. */
type Panel = 'none' | 'plugins' | string;

const panel = ref<Panel>('none');

/** Mirrors the shared sidebar state; the Fluxious plugin and the toolbar button both drive it. */
const hidden = ref(isSidebarHidden());
const stopVisibility = onSidebarVisibilityChanged((next) => (hidden.value = next));

/** True while the pointer is in the reveal strip at the screen edge. */
const revealing = ref(false);

/**
 * Always shown on touch: a tap fires pointerenter and pointerleave back to back, so the hover strip
 * would flash the button and take it away, leaving no way back to a sidebar hidden by default.
 */
const touch = isMobileDevice();

/** Where the reveal button sits; a player setting, so it follows the store rather than the device. */
const revealPosition = ref(readValue(fluxiousConfig, 'revealPosition') as RevealPosition);

const stopConfig = onConfigChanged((group, keyName) => {
    if (group === CONFIG_GROUP_KEY && keyName === 'revealPosition') {
        revealPosition.value = readValue(fluxiousConfig, 'revealPosition') as RevealPosition;
    }
});

/** Set while a plugin's settings are open; null shows the list. */
const settingsFor = ref<string | null>(null);

/** Host element plugin panels mount into. */
const panelHost = ref<HTMLElement | null>(null);

/** Bumped when a plugin is added or toggled, since the registry is a plain Map. */
const version = ref(0);
const stopRegistry = onRegistryChanged(() => (version.value += 1));
const stopToolbar = onToolbarChanged(() => (version.value += 1));

/** Search text for the plugin list. */
const query = ref('');

/**
 * Filters on the plugin list, and whether the funnel's menu is open.
 *
 * None selected means everything, as it does on the world list: a filter is something a player adds,
 * not something they have to clear before the list is complete.
 */
const FILTERS = ['Enabled', 'Disabled', 'Pinned', 'Configurable'] as const;

const filters = ref<string[]>([]);
const showFilters = ref(false);

function toggleFilter(name: string): void {
    filters.value = filters.value.includes(name)
        ? filters.value.filter((entry) => entry !== name)
        : [...filters.value, name];
}

const plugins = computed(() => {
    void version.value;

    return listPlugins();
});

/** Whether a plugin is one of the things a given filter selects for. */
function matchesFilter(plugin: ReturnType<typeof listPlugins>[number], filter: string): boolean {
    if (filter === 'Enabled') return plugin.enabled;
    if (filter === 'Disabled') return !plugin.enabled;
    if (filter === 'Pinned') return plugin.favourite;

    return plugin.hasSettings;
}

/** Matches on name, description or tags — the three things a plugin describes itself by. */
const visiblePlugins = computed(() => {
    const needle = query.value.trim().toLowerCase();
    const chosen = filters.value;

    return plugins.value.filter((plugin) => {
        // Several filters read as "any of these", so a plugin needs to satisfy only one of them.
        if (chosen.length > 0 && !chosen.some((filter) => matchesFilter(plugin, filter))) {
            return false;
        }

        if (!needle) {
            return true;
        }

        return (
            plugin.name.toLowerCase().includes(needle) ||
            plugin.description.toLowerCase().includes(needle) ||
            plugin.tags.some((tag) => tag.toLowerCase().includes(needle))
        );
    });
});

/** Panel buttons: the top group, each opening its panel. */
const navigations = computed(() => {
    void version.value;

    return listPanelNavigations();
});

/** Action buttons: the bottom group, standing in for the desktop title bar. */
const actions = computed(() => {
    void version.value;

    return listActionNavigations();
});

/** Open right-click menu, or null. Positioned against the button that raised it. */
const popup = ref<{ button: NavigationButton; x: number; y: number } | null>(null);

function openPopup(event: MouseEvent, button: NavigationButton): void {
    if (!button.popup) {
        return;
    }

    event.preventDefault();
    popup.value = { button, x: event.clientX, y: event.clientY };
}

function runPopup(action: () => void): void {
    popup.value = null;
    action();
}

function runAction(button: NavigationButton): void {
    popup.value = null;
    button.onClick?.();
}

const openConfig = computed(() => (settingsFor.value ? pluginConfig(settingsFor.value) : undefined));

/** Summary of the plugin whose settings are open, for the header's switch. */
const settingsPlugin = computed(() =>
    settingsFor.value ? plugins.value.find((plugin) => plugin.name === settingsFor.value) : undefined,
);

/** Puts every setting in this group back to its declared default. */
function resetOpenConfig(): void {
    const config = openConfig.value;

    if (!config) {
        return;
    }

    for (const item of config.items) {
        resetValue(config, item.keyName);
    }
}

const activeNavigation = computed(() =>
    navigations.value.find((nav) => nav.tooltip === panel.value),
);

const title = computed(() => {
    if (panel.value === 'plugins') {
        return settingsFor.value ?? 'Plugins';
    }

    return activeNavigation.value?.tooltip ?? '';
});

/** The plugin list labels itself; everything else needs its name at the top. */
const showHeader = computed(() => panel.value !== 'plugins' || settingsFor.value !== null);

let mounted: NavigationButton | null = null;

/**
 * Mounts the open plugin panel, and unmounts the one it replaces.
 *
 * Panels are mounted on becoming visible rather than kept alive hidden, so a panel that polls or
 * listens is not doing it while nobody can see it.
 */
async function syncPanel(): Promise<void> {
    await nextTick();

    const next = activeNavigation.value ?? null;

    if (mounted && mounted !== next) {
        mounted.panel?.unmount?.();
        mounted = null;
    }

    // Only panel buttons mount anything; action buttons never become the active navigation.
    if (next?.panel && next !== mounted && panelHost.value) {
        panelHost.value.replaceChildren();
        next.panel.mount(panelHost.value);
        mounted = next;
    }
}

watch([panel, navigations], syncPanel);

watch(
    [panel, hidden],
    ([openPanel, isHidden]) => setSidebarPanelOpen(openPanel !== 'none' && !isHidden),
    { immediate: true },
);

onUnmounted(() => {
    // The inset belongs to this component; leaving it set would shrink the game with nothing there.
    setSidebarPanelOpen(false);
    mounted?.panel?.unmount?.();
    mounted = null;
    stopRegistry();
    stopToolbar();
    stopVisibility();
    stopConfig();
});

function togglePanel(next: Panel): void {
    panel.value = panel.value === next ? 'none' : next;
    settingsFor.value = null;
}

function toggleEnabled(name: string, enabled: boolean): void {
    setEnabled(name, enabled);
}

function toggleFavourite(name: string, favourite: boolean): void {
    setFavourite(name, favourite);
}
</script>

<template>
    <!-- Hidden: nothing but a strip of hover area at the edge, so the game has the whole width.
         The strip is what makes the panel findable again without a keybind. -->
    <template v-if="hidden">
        <div
            class="flx-plugins__reveal"
            :class="`flx-plugins__reveal--${revealPosition}`"
            @pointerenter="revealing = true"
            @pointerleave="revealing = false"
        >
            <button
                v-show="revealing || touch"
                type="button"
                class="flx-plugins__revealbtn"
                title="Show side panel"
                @click="setSidebarHidden(false)"
            >
                <!-- Wrapped so the edge styles can turn it to face the panel without rotating the
                     button's own box. -->
                <span class="flx-plugins__revealchevron">‹</span>
            </button>
        </div>
    </template>

    <div v-else class="flx-plugins">
        <div v-if="panel !== 'none'" class="flx-plugins__panel">
            <!-- No header over the plugin list: the tab strip already says which panel is open, and
                 a bar reading "Plugins" over a list of plugins is a row of height spent on nothing.
                 A plugin's own settings do need one, for the name and the way back. -->
            <div v-if="showHeader" class="flx-plugins__header">
                <!-- In a plugin's config the header is its way out, so the arrow leads the title. -->
                <button
                    v-if="settingsFor"
                    type="button"
                    class="flx-backarrow"
                    title="Back to plugins"
                    @click="settingsFor = null"
                ></button>

                <span class="flx-plugins__title">{{ title }}</span>

                <!-- The plugin's own switch, so it can be turned off without leaving its settings. -->
                <button
                    v-if="settingsPlugin && !settingsPlugin.core"
                    type="button"
                    class="flx-switch"
                    :class="{ 'flx-switch--off': !settingsPlugin.enabled }"
                    :aria-pressed="settingsPlugin.enabled"
                    :title="settingsPlugin.enabled ? 'Disable' : 'Enable'"
                    @click="toggleEnabled(settingsPlugin.name, !settingsPlugin.enabled)"
                ></button>
            </div>

            <div class="flx-plugins__body">
                <template v-if="panel === 'plugins'">
                    <template v-if="openConfig">
                        <PluginSettings :config="openConfig" />

                        <div class="flx-configfoot">
                            <button type="button" class="flx-configbtn" @click="resetOpenConfig">
                                Reset
                            </button>
                            <button type="button" class="flx-configbtn" @click="settingsFor = null">
                                Back
                            </button>
                        </div>
                    </template>

                    <template v-else>
                        <div class="flx-search">
                            <svg
                                class="flx-search__icon"
                                width="13"
                                height="13"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <circle cx="11" cy="11" r="7" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>

                            <input
                                v-model="query"
                                type="text"
                                class="flx-search__input"
                                placeholder="Search"
                            />

                            <button
                                v-if="query"
                                type="button"
                                class="flx-search__clear"
                                title="Clear"
                                @click="query = ''"
                            >
                                ×
                            </button>

                            <!-- The world list's funnel, doing the same job on a different list. -->
                            <button
                                type="button"
                                class="flx-funnel"
                                :class="{ 'flx-funnel--on': filters.length > 0 || showFilters }"
                                title="Filter plugins"
                                @click.stop="showFilters = !showFilters"
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

                            <template v-if="showFilters">
                                <div class="flx-plugins__popupveil" @click="showFilters = false"></div>
                                <div class="flx-filtermenu" @click.stop>
                                    <button
                                        v-for="option in FILTERS"
                                        :key="option"
                                        type="button"
                                        class="flx-filtermenu__item"
                                        :class="{ 'flx-filtermenu__item--on': filters.includes(option) }"
                                        @click="toggleFilter(option)"
                                    >
                                        <span class="flx-filtermenu__check">{{
                                            filters.includes(option) ? '✓' : ''
                                        }}</span>
                                        {{ option }}
                                    </button>
                                </div>
                            </template>
                        </div>

                        <!-- The description is the row's tooltip rather than a second line: the
                             list is for finding a plugin, and one line each fits far more of it. -->
                        <div
                            v-for="plugin in visiblePlugins"
                            :key="plugin.name"
                            class="flx-plugin-row"
                            :title="plugin.description"
                        >
                            <button
                                type="button"
                                class="flx-star"
                                :class="{ 'flx-star--off': !plugin.favourite }"
                                :title="plugin.favourite ? 'Unpin' : 'Pin to top'"
                                @click="toggleFavourite(plugin.name, !plugin.favourite)"
                            ></button>

                            <span class="flx-plugin-row__name">{{ plugin.name }}</span>

                            <button
                                v-if="plugin.hasSettings"
                                type="button"
                                class="flx-cog"
                                title="Configure"
                                @click="settingsFor = plugin.name"
                            ></button>

                            <!-- Core plugins have no switch at all: the runtime refuses to stop
                                 them, so offering a control that cannot act would be a lie. -->
                            <button
                                v-if="!plugin.core"
                                type="button"
                                class="flx-switch"
                                :class="{ 'flx-switch--off': !plugin.enabled }"
                                :aria-pressed="plugin.enabled"
                                :title="plugin.enabled ? 'Disable' : 'Enable'"
                                @click="toggleEnabled(plugin.name, !plugin.enabled)"
                            ></button>
                        </div>

                        <p v-if="visiblePlugins.length === 0" class="flx-plugins__empty">
                            {{ query ? 'No matching plugins.' : 'No plugins installed.' }}
                        </p>
                    </template>
                </template>

                <!-- Plugin-owned panels render their own DOM in here. -->
                <div v-show="panel !== 'plugins'" ref="panelHost" class="flx-plugins__host"></div>
            </div>
        </div>

        <div class="flx-plugins__bar">
            <button
                type="button"
                class="flx-plugins__tab"
                :class="{ 'flx-plugins__tab--active': panel === 'plugins' }"
                title="Plugins"
                @click="togglePanel('plugins')"
            >
                ⚙
            </button>

            <button
                v-for="nav in navigations"
                :key="nav.tooltip"
                type="button"
                class="flx-plugins__tab"
                :class="{ 'flx-plugins__tab--active': panel === nav.tooltip }"
                :title="nav.tooltip"
                @click="togglePanel(nav.tooltip)"
                @contextmenu="openPopup($event, nav)"
            >
                <img class="flx-plugins__icon" :src="nav.icon" :alt="nav.tooltip" />
            </button>

            <!-- Pushes the action buttons to the foot of the strip. -->
            <div class="flx-plugins__spacer"></div>

            <button
                v-for="action in actions"
                :key="action.tooltip"
                type="button"
                class="flx-plugins__tab"
                :title="action.tooltip"
                @click="runAction(action)"
                @contextmenu="openPopup($event, action)"
            >
                <img class="flx-plugins__icon" :src="action.icon" :alt="action.tooltip" />
            </button>
        </div>

        <!-- Right-click menu. Closes on any click elsewhere, which the backdrop catches. -->
        <template v-if="popup">
            <div class="flx-plugins__popupveil" @click="popup = null" @contextmenu.prevent="popup = null"></div>
            <div class="flx-plugins__popup" :style="{ left: popup.x + 'px', top: popup.y + 'px' }">
                <button
                    v-for="(action, label) in popup.button.popup"
                    :key="label"
                    type="button"
                    class="flx-plugins__popupitem"
                    @click="runPopup(action)"
                >
                    {{ label }}
                </button>
            </div>
        </template>
    </div>
</template>
