/**
 * Base class for overlays, ported from `net.runelite.client.ui.overlay.Overlay`.
 *
 * An overlay declares where it wants to be and what it draws; the manager decides where it ends up
 * and the renderer draws it. Defaults match the original — `UNDER_WIDGETS`, `TOP_LEFT`, medium
 * priority, movable and snappable — so a ported plugin that sets nothing behaves as it did.
 *
 * `render` returns the size it drew, or null for nothing this frame. The manager stacks
 * positioned overlays using that size, which is why returning it matters even when the overlay
 * knows its own bounds.
 */
import {
    Dimension,
    OverlayLayer,
    OverlayPosition,
    PRIORITY_DEFAULT,
    Point,
    Rectangle,
} from './OverlayEnums';

export abstract class Overlay {
    /** Set by the manager each frame; where this overlay was actually drawn. */
    bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

    private position: OverlayPosition = OverlayPosition.TOP_LEFT;
    private preferredPosition: OverlayPosition | null = null;
    private preferredLocation: Point | null = null;
    private preferredSize: Dimension | null = null;
    private layer: OverlayLayer = OverlayLayer.UNDER_WIDGETS;
    private priority: number = PRIORITY_DEFAULT;

    private movable = true;
    private snappable = true;
    private resizable = false;
    private resettable = true;
    private minimumSize = 32;

    /**
     * Identifies the overlay in stored positions, so a moved overlay is still where the player
     * left it after a reload. Defaults to the class name, as the original does.
     */
    getName(): string {
        return this.constructor.name;
    }

    abstract render(ctx: CanvasRenderingContext2D): Dimension | null;

    // --- placement ---------------------------------------------------------

    getPosition(): OverlayPosition {
        return this.preferredPosition ?? this.position;
    }

    setPosition(position: OverlayPosition): void {
        this.position = position;
    }

    getPreferredPosition(): OverlayPosition | null {
        return this.preferredPosition;
    }

    setPreferredPosition(position: OverlayPosition | null): void {
        this.preferredPosition = position;
    }

    getPreferredLocation(): Point | null {
        return this.preferredLocation;
    }

    setPreferredLocation(location: Point | null): void {
        this.preferredLocation = location;
    }

    getPreferredSize(): Dimension | null {
        return this.preferredSize;
    }

    setPreferredSize(size: Dimension | null): void {
        this.preferredSize = size;
    }

    // --- ordering ----------------------------------------------------------

    getLayer(): OverlayLayer {
        return this.layer;
    }

    setLayer(layer: OverlayLayer): void {
        this.layer = layer;
    }

    getPriority(): number {
        return this.priority;
    }

    setPriority(priority: number): void {
        this.priority = priority;
    }

    // --- interaction -------------------------------------------------------

    isMovable(): boolean {
        return this.movable;
    }

    setMovable(movable: boolean): void {
        this.movable = movable;
    }

    isSnappable(): boolean {
        return this.snappable;
    }

    setSnappable(snappable: boolean): void {
        this.snappable = snappable;
    }

    isResizable(): boolean {
        return this.resizable;
    }

    setResizable(resizable: boolean): void {
        this.resizable = resizable;
    }

    isResettable(): boolean {
        return this.resettable;
    }

    setResettable(resettable: boolean): void {
        this.resettable = resettable;
    }

    getMinimumSize(): number {
        return this.minimumSize;
    }

    setMinimumSize(minimumSize: number): void {
        this.minimumSize = minimumSize;
    }

    /** Called when the overlay's stored position is cleared, so it can rebuild internal state. */
    revalidate(): void {}
}
