/**
 * Panel components, ported from `net.runelite.client.ui.overlay.components`.
 *
 * Each component measures and draws itself, and `PanelComponent` stacks them. Together they are
 * what a panel-style overlay is actually built from — a title and a few lines of label-and-value —
 * so a ported plugin assembles the same objects it does on desktop.
 */
import type { Dimension, Point } from './OverlayEnums';

/** The client's own panel background and border. */
const BACKGROUND = 'rgba(30, 30, 30, 0.61)';
const BORDER = 'rgba(0, 0, 0, 0.71)';

export const ComponentColour = {
    /** The client's default overlay text. */
    WHITE: '#ffffff',
    ORANGE: '#ff981f',
    YELLOW: '#ffff00',
    GREEN: '#00ff00',
    RED: '#ff0000',
} as const;

export interface LayoutableRenderableEntity {
    /** Draws at the current origin and answers the space taken. */
    render(ctx: CanvasRenderingContext2D): Dimension;
    preferredSize?: Dimension | null;
}

/** A centred, coloured heading. */
export class TitleComponent implements LayoutableRenderableEntity {
    text = '';
    colour: string = ComponentColour.WHITE;
    preferredSize: Dimension | null = null;

    static builder(): TitleComponent {
        return new TitleComponent();
    }

    setText(text: string): this {
        this.text = text;
        return this;
    }

    setColor(colour: string): this {
        this.colour = colour;
        return this;
    }

    render(ctx: CanvasRenderingContext2D): Dimension {
        const width = this.preferredSize?.width ?? ctx.measureText(this.text).width;
        const metrics = ctx.measureText(this.text);
        const height = metrics.actualBoundingBoxAscent || 10;
        const x = (width - metrics.width) / 2;

        ctx.fillStyle = '#000000';
        ctx.fillText(this.text, x + 1, height + 1);
        ctx.fillStyle = this.colour;
        ctx.fillText(this.text, x, height);

        return { width, height: height + 2 };
    }
}

/** A left-aligned label with a right-aligned value, the workhorse of every panel overlay. */
export class LineComponent implements LayoutableRenderableEntity {
    left = '';
    right = '';
    leftColour: string = ComponentColour.WHITE;
    rightColour: string = ComponentColour.WHITE;
    preferredSize: Dimension | null = null;

    static builder(): LineComponent {
        return new LineComponent();
    }

    setLeft(text: string): this {
        this.left = text;
        return this;
    }

    setRight(text: string): this {
        this.right = text;
        return this;
    }

    setLeftColor(colour: string): this {
        this.leftColour = colour;
        return this;
    }

    setRightColor(colour: string): this {
        this.rightColour = colour;
        return this;
    }

    render(ctx: CanvasRenderingContext2D): Dimension {
        const leftMetrics = ctx.measureText(this.left);
        const rightMetrics = ctx.measureText(this.right);
        const height = leftMetrics.actualBoundingBoxAscent || 10;
        const width = this.preferredSize?.width ?? leftMetrics.width + rightMetrics.width + 8;

        ctx.fillStyle = '#000000';
        ctx.fillText(this.left, 1, height + 1);
        ctx.fillStyle = this.leftColour;
        ctx.fillText(this.left, 0, height);

        if (this.right) {
            const x = width - rightMetrics.width;
            ctx.fillStyle = '#000000';
            ctx.fillText(this.right, x + 1, height + 1);
            ctx.fillStyle = this.rightColour;
            ctx.fillText(this.right, x, height);
        }

        return { width, height: height + 2 };
    }
}

/** A filled bar with an optional centred label. */
export class ProgressBarComponent implements LayoutableRenderableEntity {
    minimum = 0;
    maximum = 100;
    value = 0;
    label = '';
    foreground: string = ComponentColour.GREEN;
    background = 'rgba(0, 0, 0, 0.7)';
    preferredSize: Dimension | null = null;

    static builder(): ProgressBarComponent {
        return new ProgressBarComponent();
    }

    setValue(value: number): this {
        this.value = value;
        return this;
    }

    setMaximum(maximum: number): this {
        this.maximum = maximum;
        return this;
    }

    setLabel(label: string): this {
        this.label = label;
        return this;
    }

    setForegroundColor(colour: string): this {
        this.foreground = colour;
        return this;
    }

    render(ctx: CanvasRenderingContext2D): Dimension {
        const width = this.preferredSize?.width ?? 120;
        const height = 16;
        const span = this.maximum - this.minimum;
        const filled = span <= 0 ? 0 : Math.max(0, Math.min(1, (this.value - this.minimum) / span));

        ctx.fillStyle = this.background;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = this.foreground;
        ctx.fillRect(0, 0, width * filled, height);

        if (this.label) {
            const metrics = ctx.measureText(this.label);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(this.label, (width - metrics.width) / 2, height - 4);
        }

        return { width, height: height + 2 };
    }
}

export class ImageComponent implements LayoutableRenderableEntity {
    preferredSize: Dimension | null = null;

    constructor(private readonly image: CanvasImageSource, private readonly width: number, private readonly height: number) {}

    render(ctx: CanvasRenderingContext2D): Dimension {
        ctx.drawImage(this.image, 0, 0);

        return { width: this.width, height: this.height };
    }
}

/**
 * Stacks components inside a bordered background.
 *
 * Width is the widest child unless one is set, so a panel grows to fit its content the way the
 * desktop one does rather than needing a size chosen up front.
 */
export class PanelComponent implements LayoutableRenderableEntity {
    private readonly children: LayoutableRenderableEntity[] = [];

    preferredSize: Dimension | null = null;
    backgroundColour: string | null = BACKGROUND;
    border = { top: 4, left: 4, bottom: 4, right: 4 };
    gap = 1;

    getChildren(): LayoutableRenderableEntity[] {
        return this.children;
    }

    setPreferredSize(size: Dimension | null): void {
        this.preferredSize = size;
    }

    render(ctx: CanvasRenderingContext2D): Dimension {
        if (this.children.length === 0) {
            return { width: 0, height: 0 };
        }

        const contentWidth = this.preferredSize
            ? this.preferredSize.width - this.border.left - this.border.right
            : this.measureContentWidth(ctx);

        // Measured in a first pass so the background can be drawn behind the children rather than
        // over them; the alternative is drawing to a scratch canvas, which is not worth it here.
        const height = this.measureContentHeight(ctx, contentWidth);
        const totalWidth = contentWidth + this.border.left + this.border.right;
        const totalHeight = height + this.border.top + this.border.bottom;

        if (this.backgroundColour) {
            ctx.fillStyle = this.backgroundColour;
            ctx.fillRect(0, 0, totalWidth, totalHeight);
            ctx.strokeStyle = BORDER;
            ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, totalWidth - 1, totalHeight - 1);
        }

        let y = this.border.top;

        for (const child of this.children) {
            ctx.save();
            ctx.translate(this.border.left, y);
            child.preferredSize = { width: contentWidth, height: 0 };
            const size = child.render(ctx);
            ctx.restore();
            y += size.height + this.gap;
        }

        return { width: totalWidth, height: totalHeight };
    }

    private measureContentWidth(ctx: CanvasRenderingContext2D): number {
        let width = 0;

        for (const child of this.children) {
            if (child instanceof LineComponent) {
                width = Math.max(width, ctx.measureText(child.left).width + ctx.measureText(child.right).width + 8);
            } else if (child instanceof TitleComponent) {
                width = Math.max(width, ctx.measureText(child.text).width);
            } else {
                width = Math.max(width, child.preferredSize?.width ?? 0);
            }
        }

        return width;
    }

    private measureContentHeight(ctx: CanvasRenderingContext2D, contentWidth: number): number {
        const metrics = ctx.measureText('X');
        const line = (metrics.actualBoundingBoxAscent || 10) + 2;

        let height = 0;

        for (const child of this.children) {
            height += child instanceof ProgressBarComponent ? 18 : line;
            height += this.gap;
        }

        return Math.max(0, height - this.gap);
    }
}

export type { Point };
