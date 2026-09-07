/**
 * Settings for the FPS plugin, ported from `FpsConfig.java`.
 *
 * Same keys, names, descriptions, positions and defaults as the desktop interface, so a profile
 * carried over reads the same and the settings panel matches what a player already knows.
 */
import type { ConfigGroup, ConfigReader } from '../types';

export const CONFIG_GROUP_KEY = 'fpscontrol';

export const fpsConfig: ConfigGroup = {
    group: CONFIG_GROUP_KEY,
    items: [
        {
            type: 'boolean',
            keyName: 'limitFps',
            name: 'Limit global FPS',
            description: 'Global FPS limit in effect regardless of whether window is in focus or not.',
            position: 1,
            defaultValue: false,
        },
        {
            type: 'number',
            keyName: 'maxFps',
            name: 'Global FPS target',
            description: 'Desired max global frames per second.',
            position: 2,
            defaultValue: 50,
            min: 1,
            max: 360,
        },
        {
            type: 'boolean',
            keyName: 'limitFpsUnfocused',
            name: 'Limit FPS unfocused',
            description: 'FPS limit while window is out of focus.',
            position: 3,
            defaultValue: false,
        },
        {
            type: 'number',
            keyName: 'maxFpsUnfocused',
            name: 'Unfocused FPS target',
            description: 'Desired max frames per second for unfocused.',
            position: 4,
            defaultValue: 50,
            min: 1,
            max: 360,
        },
        {
            type: 'boolean',
            keyName: 'drawFps',
            name: 'Draw FPS indicator',
            description: 'Show a number in the corner for the current FPS.',
            position: 5,
            defaultValue: true,
        },
    ],
};

export const limitFps = (config: ConfigReader): boolean => config.boolean('limitFps');
export const maxFps = (config: ConfigReader): number => config.number('maxFps');
export const limitFpsUnfocused = (config: ConfigReader): boolean => config.boolean('limitFpsUnfocused');
export const maxFpsUnfocused = (config: ConfigReader): number => config.number('maxFpsUnfocused');
export const drawFps = (config: ConfigReader): boolean => config.boolean('drawFps');

/** Whether a limit is in force right now — the condition both halves of the plugin key off. */
export function isEnforced(config: ConfigReader, isFocused: boolean): boolean {
    return limitFps(config) || (limitFpsUnfocused(config) && !isFocused);
}
