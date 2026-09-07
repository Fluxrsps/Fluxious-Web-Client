/**
 * Overlay placement, ordering and layering, ported from the RuneLite enums of the same names.
 *
 * Kept in one file because they are only meaningful together — an overlay's position, layer and
 * priority are read as a set every time the manager lays one out.
 */

/**
 * When in the frame an overlay is drawn, and therefore what it appears beneath.
 *
 * Each value corresponds to a client callback: `drawScene` for {@link ABOVE_SCENE},
 * `drawAboveOverheads` for {@link UNDER_WIDGETS}, `drawInterface`/`drawLayer` for
 * {@link ABOVE_WIDGETS}, and the buffer provider's `draw` for {@link ALWAYS_ON_TOP}.
 */
export enum OverlayLayer {
    /** Not drawn by the renderer; the overlay arranges its own moment. */
    MANUAL = 'MANUAL',
    /** Right above the scene, so interfaces cover it. */
    ABOVE_SCENE = 'ABOVE_SCENE',
    /** Under all interfaces but above overheads. */
    UNDER_WIDGETS = 'UNDER_WIDGETS',
    /** Above interfaces, under the right-click menu. */
    ABOVE_WIDGETS = 'ABOVE_WIDGETS',
    /** Above everything the client draws. */
    ALWAYS_ON_TOP = 'ALWAYS_ON_TOP',
}

/** Where an overlay sits. Anything but {@link DYNAMIC} is laid out by the manager. */
export enum OverlayPosition {
    /** Not attached, but still movable. Prefer DYNAMIC with movable set. */
    DETACHED = 'DETACHED',
    /** The overlay places itself. */
    DYNAMIC = 'DYNAMIC',
    TOP_LEFT = 'TOP_LEFT',
    TOP_CENTER = 'TOP_CENTER',
    TOP_RIGHT = 'TOP_RIGHT',
    BOTTOM_LEFT = 'BOTTOM_LEFT',
    BOTTOM_RIGHT = 'BOTTOM_RIGHT',
    /** Directly above the right of the chatbox. */
    ABOVE_CHATBOX_RIGHT = 'ABOVE_CHATBOX_RIGHT',
    /** The top right of the canvas, ignoring the viewport inset. */
    CANVAS_TOP_RIGHT = 'CANVAS_TOP_RIGHT',
    TOOLTIP = 'TOOLTIP',
}

/**
 * Render order within a layer, high first.
 *
 * Numbers rather than an enum, matching the float priority RuneLite moved to, so an overlay can
 * sit between two named values.
 */
export const OverlayPriority = {
    LOW: 0,
    MED: 25,
    HIGH: 50,
    HIGHEST: 75,
} as const;

export const PRIORITY_LOW = OverlayPriority.LOW;
export const PRIORITY_MED = OverlayPriority.MED;
export const PRIORITY_HIGH = OverlayPriority.HIGH;
export const PRIORITY_HIGHEST = OverlayPriority.HIGHEST;
export const PRIORITY_DEFAULT = OverlayPriority.MED;

/** Corners an overlay can be snapped to when dragged. */
export enum SnapCorner {
    TOP_LEFT = 'TOP_LEFT',
    TOP_CENTER = 'TOP_CENTER',
    TOP_RIGHT = 'TOP_RIGHT',
    BOTTOM_LEFT = 'BOTTOM_LEFT',
    BOTTOM_RIGHT = 'BOTTOM_RIGHT',
}

/** Layers the renderer walks, in the order the client reaches them. */
export const RENDERED_LAYERS: OverlayLayer[] = [
    OverlayLayer.ABOVE_SCENE,
    OverlayLayer.UNDER_WIDGETS,
    OverlayLayer.ABOVE_WIDGETS,
    OverlayLayer.ALWAYS_ON_TOP,
];

export interface Point {
    x: number;
    y: number;
}

export interface Dimension {
    width: number;
    height: number;
}

export interface Rectangle extends Point, Dimension {}

export function contains(rect: Rectangle, point: Point): boolean {
    return (
        point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
    );
}
