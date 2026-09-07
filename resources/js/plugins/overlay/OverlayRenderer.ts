/**
 * Draws overlays and lets the player move them, ported from `OverlayRenderer`.
 *
 * One pass per layer. Within a layer, overlays that chose `DYNAMIC` place themselves and the rest
 * are stacked into their position groups by {@link OverlayManager}. An overlay the player has
 * dragged carries a `preferredLocation` and is drawn there instead.
 *
 * Moving works as it does on desktop: hold Alt and drag. The overlay canvas ignores the pointer
 * the rest of the time so clicks reach the game, and only takes it while Alt is down.
 *
 * Not ported: RuneLite's snap corners are themselves draggable, with alignment and expand flags.
 * Here the five corners are fixed — dropping an overlay near one reassigns its position, which is
 * the behaviour a player actually uses.
 */
import type { Overlay } from './Overlay';
import { overlayManager } from './OverlayManager';
import { OverlayFont, setGraphicProperties } from './OverlayUtil';
import { Dimension, OverlayLayer, OverlayPosition, Point, Rectangle, contains } from './OverlayEnums';

/**
 * Font for an overlay in this position.
 *
 * Desktop reads three separate settings here — dynamic, tooltip and interface — but all three
 * default to `FontType.REGULAR`, so until those settings exist this is one answer rather than a
 * branch that pretends to choose.
 */
function fontFor(_position: OverlayPosition): string {
    return OverlayFont.REGULAR;
}

const MOVING_OVERLAY_COLOR = 'rgba(255, 255, 0, 0.39)';
const MOVING_OVERLAY_ACTIVE_COLOR = 'rgba(255, 255, 0, 0.78)';
const SNAP_CORNER_COLOR = 'rgba(0, 255, 255, 0.2)';
const SNAP_CORNER_SIZE = 80;

export class OverlayRenderer {
    private canvas: HTMLCanvasElement | null = null;

    /** Set while Alt is held; overlays become draggable and their bounds are drawn. */
    private inDraggingMode = false;

    private dragged: Overlay | null = null;
    private dragOffset: Point = { x: 0, y: 0 };
    private mouse: Point | null = null;

    attach(canvas: HTMLCanvasElement): () => void {
        this.canvas = canvas;

        const onKeyDown = (e: KeyboardEvent) => this.setDraggingMode(e.altKey);
        const onKeyUp = (e: KeyboardEvent) => this.setDraggingMode(e.altKey);
        const onBlur = () => this.setDraggingMode(false);

        const onPointerDown = (e: PointerEvent) => this.onPointerDown(e);
        const onPointerMove = (e: PointerEvent) => this.onPointerMove(e);
        const onPointerUp = () => this.onPointerUp();

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            this.canvas = null;
        };
    }

    private setDraggingMode(active: boolean): void {
        if (this.inDraggingMode === active) {
            return;
        }

        this.inDraggingMode = active;

        if (this.canvas) {
            // Only steal the pointer while moving overlays; the game needs every other click.
            this.canvas.style.pointerEvents = active ? 'auto' : 'none';
        }

        if (!active) {
            this.dragged = null;
        }
    }

    /** Canvas coordinates for a pointer event, which are not CSS pixels once the canvas is scaled. */
    private toCanvas(e: PointerEvent): Point {
        const canvas = this.canvas;

        if (!canvas) {
            return { x: 0, y: 0 };
        }

        const rect = canvas.getBoundingClientRect();

        return {
            x: ((e.clientX - rect.left) / rect.width) * canvas.width,
            y: ((e.clientY - rect.top) / rect.height) * canvas.height,
        };
    }

    private onPointerDown(e: PointerEvent): void {
        if (!this.inDraggingMode) {
            return;
        }

        const point = this.toCanvas(e);

        // Front-most first: the overlay a player means is the one drawn on top.
        for (const overlay of [...overlayManager.all()].reverse()) {
            if (!overlay.isMovable() || !contains(overlay.bounds, point)) {
                continue;
            }

            this.dragged = overlay;
            this.dragOffset = { x: point.x - overlay.bounds.x, y: point.y - overlay.bounds.y };
            e.preventDefault();
            return;
        }
    }

    private onPointerMove(e: PointerEvent): void {
        this.mouse = this.toCanvas(e);

        if (!this.dragged) {
            return;
        }

        this.dragged.setPreferredLocation({
            x: this.mouse.x - this.dragOffset.x,
            y: this.mouse.y - this.dragOffset.y,
        });
        e.preventDefault();
    }

    private onPointerUp(): void {
        const overlay = this.dragged;

        if (!overlay || !this.canvas) {
            return;
        }

        this.dragged = null;

        // Dropped on a corner: adopt that position and let the manager stack it again, rather than
        // pinning it to wherever the pointer happened to be.
        if (overlay.isSnappable() && this.mouse) {
            const viewport = overlayManager.viewport(this.canvas);
            const corner = overlayManager.snapCornerAt(this.mouse, viewport);

            if (corner) {
                overlay.setPreferredPosition(corner);
                overlay.setPreferredLocation(null);
            }
        }

        overlayManager.savePosition(overlay);
    }

    /**
     * Draws one layer.
     *
     * Called once per layer per frame. `offsets` is per position group and resets each layer, so
     * overlays in different layers do not stack against each other.
     */
    renderLayer(ctx: CanvasRenderingContext2D, layer: OverlayLayer): void {
        const canvas = this.canvas;

        if (!canvas) {
            return;
        }

        const overlays = overlayManager.forLayer(layer);

        if (overlays.length === 0) {
            return;
        }

        const viewport = overlayManager.viewport(canvas);
        const offsets = new Map<OverlayPosition, number>();

        for (const overlay of overlays) {
            const position = overlayManager.correctedPosition(overlay);
            const dynamic = position === OverlayPosition.DYNAMIC || position === OverlayPosition.DETACHED;
            const preferred = overlay.getPreferredLocation();

            ctx.save();
            // Font by position, as the desktop renderer does: dynamic overlays, tooltips and
            // interface-anchored overlays each take their own configured face.
            setGraphicProperties(ctx, fontFor(position));

            let origin: Point = { x: 0, y: 0 };

            if (!dynamic) {
                const offset = offsets.get(position) ?? 0;
                // Size is known only after rendering, so place with the previous frame's size and
                // correct on the next. The original has the same one-frame lag.
                const previous: Dimension = {
                    width: overlay.bounds.width,
                    height: overlay.bounds.height,
                };
                origin = preferred ?? overlayManager.nextLocation(position, viewport, canvas, offset, previous);
                ctx.translate(origin.x, origin.y);
            } else if (preferred) {
                origin = preferred;
                ctx.translate(origin.x, origin.y);
            }

            let size: Dimension | null = null;

            try {
                size = overlay.render(ctx);
            } catch (e) {
                console.error(`[overlay] ${overlay.getName()} threw while rendering`, e);
            }

            ctx.restore();

            if (!size || size.width <= 0 || size.height <= 0) {
                overlay.bounds = { x: origin.x, y: origin.y, width: 0, height: 0 };
                continue;
            }

            overlay.bounds = { x: origin.x, y: origin.y, width: size.width, height: size.height };

            if (!dynamic && !preferred) {
                offsets.set(position, (offsets.get(position) ?? 0) + overlayManager.advance(size));
            }
        }

        if (this.inDraggingMode) {
            this.renderDragChrome(ctx, overlays, viewport);
        }
    }

    /** Corner targets and overlay outlines, shown only while Alt is held. */
    private renderDragChrome(ctx: CanvasRenderingContext2D, overlays: Overlay[], viewport: Rectangle): void {
        ctx.save();

        for (const corner of [
            { x: viewport.x, y: viewport.y },
            { x: viewport.x + viewport.width - SNAP_CORNER_SIZE, y: viewport.y },
            { x: viewport.x, y: viewport.y + viewport.height - SNAP_CORNER_SIZE },
            {
                x: viewport.x + viewport.width - SNAP_CORNER_SIZE,
                y: viewport.y + viewport.height - SNAP_CORNER_SIZE,
            },
        ]) {
            ctx.fillStyle = SNAP_CORNER_COLOR;
            ctx.fillRect(corner.x, corner.y, SNAP_CORNER_SIZE, SNAP_CORNER_SIZE);
        }

        for (const overlay of overlays) {
            if (overlay.bounds.width <= 0 || !overlay.isMovable()) {
                continue;
            }

            ctx.fillStyle = overlay === this.dragged ? MOVING_OVERLAY_ACTIVE_COLOR : MOVING_OVERLAY_COLOR;
            ctx.fillRect(overlay.bounds.x, overlay.bounds.y, overlay.bounds.width, overlay.bounds.height);
        }

        ctx.restore();
    }
}

export const overlayRenderer = new OverlayRenderer();
