/**
 * Plugin and config shapes, mirroring the RuneLite annotations they replace.
 *
 * A desktop plugin declares itself through `@PluginDescriptor`, its settings through a `Config`
 * interface of `@ConfigItem` methods, and its behaviour through `@Subscribe` handlers and an
 * `Overlay`. There are no annotations to lean on here, so each of those becomes a plain object or
 * an optional method, keeping the same vocabulary so a port reads like its original.
 */

import type { Client } from './api/Client';
import type { FluxEventMap, FluxEventName } from './api/events';

/** The `@PluginDescriptor` fields. */
export interface PluginDescriptor {
    /** Shown in the plugin list and used as the settings panel title. */
    name: string;
    description: string;
    tags: string[];
    /** Whether a player who has never touched this plugin has it running. */
    enabledByDefault: boolean;
    /**
     * Part of the client rather than an optional extra: sorted to the top of the plugin list and
     * cannot be switched off. Nothing in RuneLite corresponds to this — it exists because some
     * behaviour here belongs to the client itself, not to a plugin a player might remove.
     */
    core?: boolean;
}

/**
 * One setting, mirroring `@ConfigItem` plus `@Range`.
 *
 * `position` orders the settings panel, exactly as it orders the desktop one — declaration order
 * in an interface is not something either side can rely on.
 */
export type ConfigItem =
    | {
          type: 'boolean';
          keyName: string;
          name: string;
          description: string;
          position: number;
          /** Stored and read like any other item, but never shown in the settings panel. */
          hidden?: boolean;
          defaultValue: boolean;
      }
    | {
          type: 'number';
          keyName: string;
          name: string;
          description: string;
          position: number;
          /** Stored and read like any other item, but never shown in the settings panel. */
          hidden?: boolean;
          defaultValue: number;
          /** Present for `@Range`; renders a slider rather than a number field. */
          min?: number;
          max?: number;
      }
    | {
          type: 'string';
          keyName: string;
          name: string;
          description: string;
          position: number;
          /** Stored and read like any other item, but never shown in the settings panel. */
          hidden?: boolean;
          defaultValue: string;
      }
    | {
          type: 'keybind';
          keyName: string;
          name: string;
          description: string;
          position: number;
          /** Stored and read like any other item, but never shown in the settings panel. */
          hidden?: boolean;
          /** A combo such as "Alt+H", or an empty string for unbound. */
          defaultValue: string;
      }
    | {
          type: 'enum';
          keyName: string;
          name: string;
          description: string;
          position: number;
          /** Stored and read like any other item, but never shown in the settings panel. */
          hidden?: boolean;
          defaultValue: string;
          options: { value: string; label: string }[];
      };

/** A `@ConfigGroup`: the storage key its items live under, and the items themselves. */
export interface ConfigGroup {
    group: string;
    items: ConfigItem[];
}

export type ConfigValue = boolean | number | string;

/** Reads settings for one group, with the declared default when nothing has been stored. */
export interface ConfigReader {
    boolean(keyName: string): boolean;
    number(keyName: string): number;
    string(keyName: string): string;
}

/** What a plugin is handed on start-up: its own settings, the client, and the event bus. */
export interface PluginContext {
    config: ConfigReader;

    /**
     * The client, as `@Inject Client client` is on desktop.
     *
     * Always present, and usable before the client has booted: calls answer with a zero value until
     * the bridge exists, so a plugin started on an empty page reads 0 and null rather than throwing.
     */
    client: Client;

    /**
     * Registers an event handler, standing in for `@Subscribe`.
     *
     * The subscription lasts as long as the plugin is running — switching the plugin off removes it
     * — so a plugin only calls the returned function when it wants to stop listening sooner.
     */
    subscribe<K extends FluxEventName>(
        name: K,
        handler: (event: FluxEventMap[K]) => void,
    ): () => void;
}

/**
 * A plugin.
 *
 * `startUp`/`shutDown` bracket the enabled state the way the desktop lifecycle methods do, and the
 * `on*` handlers stand in for `@Subscribe`. Drawing is not a plugin method: a plugin adds an
 * `Overlay` to the `OverlayManager` in `startUp` and removes it in `shutDown`, exactly as on
 * desktop, so layers, priorities and player-moved positions all apply to it.
 */
export interface FluxPlugin {
    descriptor: PluginDescriptor;
    config?: ConfigGroup;

    startUp?(context: PluginContext): void;
    shutDown?(): void;

    /**
     * Window focus, which is the page's to know rather than the client's: the browser build has no
     * AWT focus events, and the page is told directly.
     */
    onFocusChanged?(focused: boolean): void;
    onConfigChanged?(group: string, keyName: string): void;
}
