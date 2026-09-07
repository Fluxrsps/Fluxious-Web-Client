/**
 * Registry and layout for overlays, ported from `OverlayManager` / the layout half of
 * `OverlayRenderer`.
 *
 * Holds the overlays, sorts them the way the client draws them, and works out where each
 * positioned overlay goes: overlays sharing a position stack in priority order with a couple of
 * pixels between them, growing away from their corner.
 *
 * Positions a player has dragged are kept in the plugin config store, under a reserved group, so
 * they survive a reload — the same thing RuneLite does with its own config.
 */
import { readRawPreference, writeRawPreference } from '../configStore';
import { client } from '../api/game';
import type { Overlay } from './Overlay';
import {
    Dimension,
    OverlayLayer,
    OverlayPosition,
    Point,
    Rectangle,
    SnapCorner,
} from './OverlayEnums';

/** Gap between stacked overlays, and from the edge they are anchored to. */
const PADDING = 2;

/** Config group holding dragged positions, keyed by overlay name. */
const OVERLAY_GROUP = 'overlays';

export class OverlayManager {
    private readonly overlays: Overlay[] = [];

    add(overlay: Overlay): void {
        if (this.overlays.includes(overlay)) {
            return;
        }

        this.overlays.push(overlay);
        this.loadPosition(overlay);
        this.sort();
    }

    remove(overlay: Overlay): void {
        const index = this.overlays.indexOf(overlay);

        if (index >= 0) {
            this.overlays.splice(index, 1);
        }
    }

    /** Removes every overlay a plugin registered, for `shutDown`. */
    removeIf(predicate: (overlay: Overlay) => boolean): void {
        for (let i = this.overlays.length - 1; i >= 0; i--) {
            if (predicate(this.overlays[i])) {
                this.overlays.splice(i, 1);
            }
        }
    }

    /** Highest priority first, so the most important overlay takes the corner. */
    private sort(): void {
        this.overlays.sort((a, b) => b.getPriority() - a.getPriority());
    }

    forLayer(layer: OverlayLayer): Overlay[] {
        return this.overlays.filter((overlay) => overlay.getLayer() === layer);
    }

    all(): Overlay[] {
        return [...this.overlays];
    }

    // --- stored positions --------------------------------------------------

    private loadPosition(overlay: Overlay): void {
        const stored = readRawPreference(OVERLAY_GROUP, overlay.getName());

        if (!stored) {
            return;
        }

        const [x, y, position] = stored.split(':');
        const px = Number(x);
        const py = Number(y);

        if (Number.isFinite(px) && Number.isFinite(py)) {
            overlay.setPreferredLocation({ x: px, y: py });
        }

        if (position && position in OverlayPosition) {
            overlay.setPreferredPosition(position as OverlayPosition);
        }
    }

    savePosition(overlay: Overlay): void {
        const location = overlay.getPreferredLocation();
        const position = overlay.getPreferredPosition() ?? '';

        writeRawPreference(
            OVERLAY_GROUP,
            overlay.getName(),
            location ? `${Math.round(location.x)}:${Math.round(location.y)}:${position}` : `::${position}`,
        );
    }

    resetPosition(overlay: Overlay): void {
        overlay.setPreferredLocation(null);
        overlay.setPreferredPosition(null);
        overlay.revalidate();
        writeRawPreference(OVERLAY_GROUP, overlay.getName(), '');
    }

    // --- layout ------------------------------------------------------------

    /**
     * Folds the two resizable-only positions onto their fixed-mode equivalents.
     *
     * In fixed mode `CANVAS_TOP_RIGHT` occupies the same place as `TOP_RIGHT`, and
     * `ABOVE_CHATBOX_RIGHT` the same as `BOTTOM_RIGHT`; without this, overlays in each pair would
     * be laid out independently and draw on top of one another.
     */
    correctedPosition(overlay: Overlay): OverlayPosition {
        const position = overlay.getPreferredPosition() ?? overlay.getPosition();

        if (client.isResized()) {
            return position;
        }

        if (position === OverlayPosition.CANVAS_TOP_RIGHT) {
            return OverlayPosition.TOP_RIGHT;
        }

        if (position === OverlayPosition.ABOVE_CHATBOX_RIGHT) {
            return OverlayPosition.BOTTOM_RIGHT;
        }

        return position;
    }

    /**
     * The area positioned overlays are anchored to.
     *
     * The viewport is the game world rectangle inside the canvas — in fixed mode it excludes the
     * side panel and chatbox, which is why an overlay in `TOP_LEFT` sits inside the scene rather
     * than over the inventory.
     */
    viewport(canvas: HTMLCanvasElement): Rectangle {
        const width = client.getViewportWidth();
        const height = client.getViewportHeight();

        if (width <= 0 || height <= 0) {
            return { x: 0, y: 0, width: canvas.width, height: canvas.height };
        }

        return { x: client.getViewportXOffset(), y: client.getViewportYOffset(), width, height };
    }

    /**
     * Where the next overlay in a position group starts, given how far the group has grown.
     *
     * Each corner grows away from itself: the top ones downwards, the bottom ones upwards, so a
     * stack never runs off the edge it is anchored to.
     */
    nextLocation(position: OverlayPosition, viewport: Rectangle, canvas: Dimension, offset: number, size: Dimension): Point {
        switch (position) {
            case OverlayPosition.TOP_LEFT:
                return { x: viewport.x + PADDING, y: viewport.y + PADDING + offset };
            case OverlayPosition.TOP_CENTER:
                return {
                    x: viewport.x + (viewport.width - size.width) / 2,
                    y: viewport.y + PADDING + offset,
                };
            case OverlayPosition.TOP_RIGHT:
                return {
                    x: viewport.x + viewport.width - size.width - PADDING,
                    y: viewport.y + PADDING + offset,
                };
            case OverlayPosition.BOTTOM_LEFT:
                return {
                    x: viewport.x + PADDING,
                    y: viewport.y + viewport.height - size.height - PADDING - offset,
                };
            case OverlayPosition.BOTTOM_RIGHT:
            case OverlayPosition.ABOVE_CHATBOX_RIGHT:
                return {
                    x: viewport.x + viewport.width - size.width - PADDING,
                    y: viewport.y + viewport.height - size.height - PADDING - offset,
                };
            case OverlayPosition.CANVAS_TOP_RIGHT:
                // Anchored to the canvas, not the viewport: this is the corner the FPS counter
                // and similar client-level readouts sit in.
                return { x: canvas.width - size.width - PADDING, y: PADDING + offset };
            default:
                return { x: viewport.x + PADDING, y: viewport.y + PADDING + offset };
        }
    }

    /** How much the group has grown after placing an overlay of this size. */
    advance(size: Dimension): number {
        return size.height + PADDING;
    }

    /** The snap corner an overlay dropped at this point belongs to, or null if it is not near one. */
    snapCornerAt(point: Point, viewport: Rectangle, radius = 80): OverlayPosition | null {
        const corners: [SnapCorner, OverlayPosition, Point][] = [
            [SnapCorner.TOP_LEFT, OverlayPosition.TOP_LEFT, { x: viewport.x, y: viewport.y }],
            [
                SnapCorner.TOP_CENTER,
                OverlayPosition.TOP_CENTER,
                { x: viewport.x + viewport.width / 2, y: viewport.y },
            ],
            [SnapCorner.TOP_RIGHT, OverlayPosition.TOP_RIGHT, { x: viewport.x + viewport.width, y: viewport.y }],
            [
                SnapCorner.BOTTOM_LEFT,
                OverlayPosition.BOTTOM_LEFT,
                { x: viewport.x, y: viewport.y + viewport.height },
            ],
            [
                SnapCorner.BOTTOM_RIGHT,
                OverlayPosition.BOTTOM_RIGHT,
                { x: viewport.x + viewport.width, y: viewport.y + viewport.height },
            ],
        ];

        for (const [, position, corner] of corners) {
            if (Math.abs(point.x - corner.x) <= radius && Math.abs(point.y - corner.y) <= radius) {
                return position;
            }
        }

        return null;
    }
}

export const overlayManager = new OverlayManager();
