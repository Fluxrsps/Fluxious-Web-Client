<script setup lang="ts">
/**
 * Settings panel for one plugin, rendered from its config schema.
 *
 * Generic on purpose, the way the desktop `ConfigPanel` is: a plugin declares items and gets a
 * panel, rather than shipping a component of its own. Which control a setting gets is decided by
 * its type, and by whether a range was declared.
 */
import { computed, onUnmounted, ref } from 'vue';
import { onConfigChanged, readValue, writeValue } from '@/plugins/configStore';
import { formatKeybind } from '@/plugins/ui/keybind';
import type { ConfigGroup, ConfigItem } from '@/plugins/types';

const props = defineProps<{ config: ConfigGroup }>();

/**
 * Bumped on every config write.
 *
 * Values live in localStorage, which Vue cannot track, so reads are tied to this counter instead.
 * Without it a control would keep rendering the value it was first given — including when a
 * plugin changes a setting itself.
 */
const version = ref(0);
const stopWatching = onConfigChanged(() => (version.value += 1));

onUnmounted(stopWatching);

/**
 * The settings a player can see, in declared order.
 *
 * Hidden items are stored and read like any other, but have no control here — Notes keeps its text
 * in config so it persists, and a text box holding a whole note has no business in a settings list.
 */
const items = computed(() =>
    [...props.config.items].filter((item) => !item.hidden).sort((a, b) => a.position - b.position),
);

function valueOf(item: ConfigItem): boolean | number | string {
    // Read of `version` is the reactive dependency; the value itself comes from storage.
    void version.value;

    return readValue(props.config, item.keyName);
}

function set(item: ConfigItem, value: boolean | number | string): void {
    writeValue(props.config, item.keyName, value);
}

function onNumber(item: ConfigItem, raw: string): void {
    const parsed = Number(raw);

    if (Number.isFinite(parsed)) {
        set(item, parsed);
    }
}

/** Key name of the bind currently listening for a press, or null. */
const capturing = ref<string | null>(null);

function startCapture(keyName: string): void {
    capturing.value = keyName;
}

/**
 * Records a pressed combo.
 *
 * Escape clears the bind rather than storing Escape, which is the only way to unbind from a
 * control that captures every other key. Modifier-only presses are ignored so holding Alt before
 * the letter does not store "Alt+".
 */
function onKeybind(event: KeyboardEvent, item: ConfigItem): void {
    if (capturing.value !== item.keyName) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
        set(item, '');
        capturing.value = null;
        return;
    }

    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
        return;
    }

    set(item, formatKeybind(event));
    capturing.value = null;
}
</script>

<template>
    <div>
        <!-- A div, not a label. Wrapping the row in a label makes a click anywhere in it — the
             description text included — activate the control inside, which on a slider means the
             value jumps to wherever the pointer happened to be. Nothing here is a labelable
             control anyway: the toggle is a button. -->
        <!-- One row per setting: name on the left, its control on the right, description as the
             row's tooltip. Matches the desktop config panel, and keeps a group readable at the
             width of a sidebar. -->
        <div v-for="item in items" :key="item.keyName" class="flx-setting" :title="item.description">
            <span class="flx-setting__name">{{ item.name }}</span>

            <button
                v-if="item.type === 'boolean'"
                type="button"
                class="flx-check"
                :aria-pressed="Boolean(valueOf(item))"
                @click="set(item, !valueOf(item))"
            >
                {{ valueOf(item) ? '✓' : '' }}
            </button>

            <!-- A declared range renders as a slider with its value alongside; without one, a
                 plain number field, since there is no sensible span to drag over. -->
            <span
                v-else-if="item.type === 'number' && item.min !== undefined && item.max !== undefined"
                class="flx-setting__range"
            >
                <input
                    type="range"
                    :min="item.min"
                    :max="item.max"
                    :value="valueOf(item)"
                    @input="onNumber(item, ($event.target as HTMLInputElement).value)"
                />
                <span class="flx-setting__value">{{ valueOf(item) }}</span>
            </span>

            <input
                v-else-if="item.type === 'number'"
                class="flx-setting__input"
                type="number"
                :value="valueOf(item)"
                @input="onNumber(item, ($event.target as HTMLInputElement).value)"
            />

            <select
                v-else-if="item.type === 'enum'"
                class="flx-setting__input"
                :value="valueOf(item)"
                @change="set(item, ($event.target as HTMLSelectElement).value)"
            >
                <option v-for="option in item.options" :key="option.value" :value="option.value">
                    {{ option.label }}
                </option>
            </select>

            <!-- Keybind: captured by pressing the combo rather than typed, so what is stored is
                 always something the browser will actually report back on keydown. -->
            <button
                v-else-if="item.type === 'keybind'"
                type="button"
                class="flx-setting__input flx-setting__keybind"
                :class="{ 'flx-setting__keybind--capturing': capturing === item.keyName }"
                @click="startCapture(item.keyName)"
                @blur="capturing = null"
                @keydown="onKeybind($event, item)"
            >
                {{ capturing === item.keyName ? 'Press a key…' : valueOf(item) || 'Not set' }}
            </button>

            <input
                v-else-if="item.type === 'string'"
                class="flx-setting__input"
                type="text"
                :value="valueOf(item)"
                @input="set(item, ($event.target as HTMLInputElement).value)"
            />
        </div>
    </div>
</template>
