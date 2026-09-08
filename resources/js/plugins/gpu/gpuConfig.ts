/**
 * Settings for the GPU renderer, ported from `GpuPluginConfig.java`.
 *
 * Same keys, names, descriptions, positions and defaults as the desktop plugin, minus the four that
 * mean nothing in a browser: the renderer is single-threaded here, there is no vsync to pick, and
 * the frame rate is paced by the page rather than by a target.
 */
import type { ConfigGroup, ConfigReader } from '../types';

export const CONFIG_GROUP_KEY = 'gpu';

export const gpuConfig: ConfigGroup = {
    group: CONFIG_GROUP_KEY,
    items: [
        {
            type: 'number',
            keyName: 'drawDistance',
            name: 'Draw distance',
            description: 'Draw distance.',
            position: 1,
            defaultValue: 50,
            min: 0,
            max: 184,
        },
        {
            type: 'boolean',
            keyName: 'hideUnrelatedMaps',
            name: 'Hide unrelated maps',
            description: "Hide unrelated map areas you shouldn't see.",
            position: 2,
            defaultValue: true,
        },
        {
            type: 'number',
            keyName: 'expandedMapLoadingChunks',
            name: 'Extended map loading',
            description: 'Extra map area to load, in 8 tile chunks.',
            position: 3,
            defaultValue: 3,
            min: 0,
            max: 5,
        },
        {
            type: 'boolean',
            keyName: 'smoothBanding',
            name: 'Remove color banding',
            description: 'Smooths out the color banding that is present in the CPU renderer.',
            position: 4,
            defaultValue: true,
        },
        {
            type: 'enum',
            keyName: 'antiAliasingMode',
            name: 'Anti aliasing',
            description: 'Configures the anti-aliasing mode.',
            position: 5,
            defaultValue: 'MSAA_2',
            options: [
                { value: 'DISABLED', label: 'Disabled' },
                { value: 'MSAA_2', label: 'MSAA x2' },
                { value: 'MSAA_4', label: 'MSAA x4' },
                { value: 'MSAA_8', label: 'MSAA x8' },
                { value: 'MSAA_16', label: 'MSAA x16' },
            ],
        },
        {
            type: 'enum',
            keyName: 'uiScalingMode',
            name: 'UI scaling mode',
            description: 'Sampling function to use for the UI in stretched mode.',
            position: 6,
            defaultValue: 'HYBRID',
            options: [
                { value: 'NEAREST', label: 'Nearest Neighbor' },
                { value: 'LINEAR', label: 'Bilinear' },
                { value: 'MITCHELL', label: 'Bicubic (Mitchell)' },
                { value: 'CATMULL_ROM', label: 'Bicubic (Catmull-Rom)' },
                { value: 'XBR', label: 'xBR' },
                { value: 'HYBRID', label: 'Hybrid' },
            ],
        },
        {
            type: 'number',
            keyName: 'fogDepth',
            name: 'Fog depth',
            description: 'Distance from the scene edge the fog starts.',
            position: 7,
            defaultValue: 0,
            min: 0,
            max: 100,
        },
        {
            type: 'number',
            keyName: 'anisotropicFilteringLevel',
            name: 'Anisotropic filtering',
            description: 'Configures the anisotropic filtering level.',
            position: 8,
            defaultValue: 1,
            min: 0,
            max: 16,
        },
        {
            type: 'enum',
            keyName: 'colorBlindMode',
            name: 'Colorblindness correction',
            description: 'Adjusts colors to account for colorblindness.',
            position: 9,
            defaultValue: 'NONE',
            options: [
                { value: 'NONE', label: 'None' },
                { value: 'PROTANOPE', label: 'Protanope' },
                { value: 'DEUTERANOPE', label: 'Deuteranope' },
                { value: 'TRITANOPE', label: 'Tritanope' },
            ],
        },
        {
            type: 'number',
            keyName: 'colorBlindIntensity',
            name: 'Colorblindness intensity',
            description: 'Strength of the colorblindness correction effect.',
            position: 10,
            defaultValue: 100,
            min: 0,
            max: 100,
        },
        {
            type: 'boolean',
            keyName: 'brightTextures',
            name: 'Bright textures',
            description: 'Use old texture lighting method which results in brighter game textures.',
            position: 11,
            defaultValue: false,
        },
        {
            // Off, where the desktop plugin has it on, and it stays off until it is understood.
            // Turning it on freezes this build — including at the login screen, where a starved
            // client loop makes the handshake time out and the server's reply arrive too late to be
            // recognised. Capping the unlocked rate to the display's own was not enough to fix that,
            // so the cause is the unlocked loop itself rather than the rate it runs at.
            type: 'boolean',
            keyName: 'unlockFps',
            name: 'Unlock FPS',
            description: 'Removes the 50 FPS cap for camera movement. Known to stall this build.',
            position: 12,
            defaultValue: false,
        },
        {
            type: 'enum',
            keyName: 'vsyncMode',
            name: 'Vsync mode',
            description: 'Method to synchronize frame rate with refresh rate.',
            position: 13,
            defaultValue: 'OFF',
            options: [
                { value: 'OFF', label: 'Off' },
                { value: 'ON', label: 'On' },
                { value: 'ADAPTIVE', label: 'Adaptive' },
            ],
        },
        {
            type: 'number',
            keyName: 'fpsTarget',
            name: 'FPS target',
            description: "Target FPS when 'Unlock FPS' is enabled and 'Vsync mode' is off.",
            position: 14,
            defaultValue: 60,
            min: 1,
            max: 999,
        },
        {
            type: 'boolean',
            keyName: 'removeVertexSnapping',
            name: 'Remove vertex snapping',
            description: 'Removes vertex snapping from most animations.',
            position: 15,
            defaultValue: true,
        },
    ],
};

/** Every setting at once, in the shape the renderer's page-side scene holds them. */
export function readGpuSettings(config: ConfigReader): Record<string, unknown> {
    return {
        drawDistance: config.number('drawDistance'),
        hideUnrelatedMaps: config.boolean('hideUnrelatedMaps'),
        expandedMapLoadingChunks: config.number('expandedMapLoadingChunks'),
        smoothBanding: config.boolean('smoothBanding'),
        antiAliasingMode: config.string('antiAliasingMode'),
        uiScalingMode: config.string('uiScalingMode'),
        fogDepth: config.number('fogDepth'),
        anisotropicFilteringLevel: config.number('anisotropicFilteringLevel'),
        brightTextures: config.boolean('brightTextures'),
        colorBlindMode: config.string('colorBlindMode'),
        colorBlindIntensity: config.number('colorBlindIntensity'),
        unlockFps: config.boolean('unlockFps'),
        vsyncMode: config.string('vsyncMode'),
        fpsTarget: config.number('fpsTarget'),
        removeVertexSnapping: config.boolean('removeVertexSnapping'),
    };
}
