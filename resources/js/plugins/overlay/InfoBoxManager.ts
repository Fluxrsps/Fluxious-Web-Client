/**
 * Info boxes and tooltips, ported from `InfoBoxManager` and `TooltipManager`.
 *
 * Both are overlays in their own right on desktop, and are here too: plugins add entries and the
 * managers own the drawing, so an info box from one plugin lines up with one from another.
 */
import { Overlay } from './Overlay';
import { overlayManager } from './OverlayManager';
import { Dimension, OverlayLayer, OverlayPosition, PRIORITY_HIGH } from './OverlayEnums';
import { measureText, renderTextLocation } from './OverlayUtil';

const BOX_SIZE = 32;
const BOX_GAP = 2;
const BACKGROUND = 'rgba(30, 30, 30, 0.61)';

export interface InfoBox {
    /** Identifies the box so a plugin can update or remove it. */
    id: string;
    /** Drawn in the box; usually a timer or a count. */
    text: string;
    colour: string;
    image?: CanvasImageSource;
    tooltip?: string;
}

class InfoBoxOverlay extends Overlay {
    private readonly boxes: InfoBox[] = [];

    constructor() {
        super();
        this.setPosition(OverlayPosition.TOP_LEFT);
        this.setLayer(OverlayLayer.ABOVE_WIDGETS);
        this.setPriority(PRIORITY_HIGH);
    }

    getName(): string {
        return 'InfoBoxOverlay';
    }

    add(box: InfoBox): void {
        this.remove(box.id);
        this.boxes.push(box);
    }

    remove(id: string): void {
        const index = this.boxes.findIndex((box) => box.id === id);

        if (index >= 0) {
            this.boxes.splice(index, 1);
        }
    }

    removeIf(predicate: (box: InfoBox) => boolean): void {
        for (let i = this.boxes.length - 1; i >= 0; i--) {
            if (predicate(this.boxes[i])) {
                this.boxes.splice(i, 1);
            }
        }
    }

    render(ctx: CanvasRenderingContext2D): Dimension | null {
        if (this.boxes.length === 0) {
            return null;
        }

        let x = 0;

        for (const box of this.boxes) {
            ctx.fillStyle = BACKGROUND;
            ctx.fillRect(x, 0, BOX_SIZE, BOX_SIZE);

            if (box.image) {
                ctx.drawImage(box.image, x, 0);
            }

            const size = measureText(ctx, box.text);
            renderTextLocation(
                ctx,
                { x: x + (BOX_SIZE - size.width) / 2, y: BOX_SIZE - 2 },
                box.text,
                box.colour,
            );

            x += BOX_SIZE + BOX_GAP;
        }

        return { width: x - BOX_GAP, height: BOX_SIZE };
    }
}

export interface Tooltip {
    text: string;
    colour?: string;
}

/**
 * Tooltips, which last one frame.
 *
 * Adding a tooltip every frame it should be visible is how the desktop manager works: a plugin
 * decides afresh each frame whether the pointer is over its thing, so the manager clears the queue
 * after drawing rather than tracking removal.
 */
class TooltipOverlay extends Overlay {
    private queue: Tooltip[] = [];
    private mouse: { x: number; y: number } = { x: 0, y: 0 };

    constructor() {
        super();
        this.setPosition(OverlayPosition.TOOLTIP);
        this.setLayer(OverlayLayer.ALWAYS_ON_TOP);
        this.setPriority(PRIORITY_HIGH);
        this.setMovable(false);
        this.setSnappable(false);
    }

    getName(): string {
        return 'TooltipOverlay';
    }

    add(tooltip: Tooltip): void {
        this.queue.push(tooltip);
    }

    setMouse(x: number, y: number): void {
        this.mouse = { x, y };
    }

    render(ctx: CanvasRenderingContext2D): Dimension | null {
        if (this.queue.length === 0) {
            return null;
        }

        const tooltips = this.queue;
        this.queue = [];

        let width = 0;
        let height = 0;

        for (const tooltip of tooltips) {
            const size = measureText(ctx, tooltip.text);
            width = Math.max(width, size.width + 8);
            height += size.height + 6;
        }

        // Follows the pointer, like the client's own tooltips.
        const x = this.mouse.x + 10;
        const y = this.mouse.y + 10;

        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = BACKGROUND;
        ctx.fillRect(0, 0, width, height);

        let lineY = 0;

        for (const tooltip of tooltips) {
            const size = measureText(ctx, tooltip.text);
            lineY += size.height + 3;
            renderTextLocation(ctx, { x: 4, y: lineY }, tooltip.text, tooltip.colour ?? '#ffffff');
            lineY += 3;
        }

        ctx.restore();

        return { width, height };
    }
}

export const infoBoxOverlay = new InfoBoxOverlay();
export const tooltipOverlay = new TooltipOverlay();

/** Adds both managers' overlays. Called once when the runtime starts. */
export function installManagedOverlays(): void {
    overlayManager.add(infoBoxOverlay);
    overlayManager.add(tooltipOverlay);
}

export const InfoBoxManager = {
    add: (box: InfoBox) => infoBoxOverlay.add(box),
    remove: (id: string) => infoBoxOverlay.remove(id),
    removeIf: (predicate: (box: InfoBox) => boolean) => infoBoxOverlay.removeIf(predicate),
};

export const TooltipManager = {
    add: (tooltip: Tooltip) => tooltipOverlay.add(tooltip),
};
