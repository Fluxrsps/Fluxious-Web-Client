/**
 * Drawing helpers, ported from `net.runelite.client.ui.overlay.OverlayUtil`.
 *
 * Only the ones that mean something against a 2D canvas are here. The scene-projection helpers —
 * `renderActorOverlay`, `renderTileOverlay`, the `LocalPoint` overloads — need actor and scene
 * bridging that does not exist yet, and are deliberately absent rather than stubbed: a helper that
 * silently draws nothing is worse than one that is not there.
 */
import type { Point, Rectangle } from './OverlayEnums';

/** The 1px black offset shadow the client draws all its text with. */
export function renderTextLocation(
    ctx: CanvasRenderingContext2D,
    location: Point,
    text: string,
    colour: string,
): void {
    ctx.fillStyle = '#000000';
    ctx.fillText(text, location.x + 1, location.y + 1);
    ctx.fillStyle = colour;
    ctx.fillText(text, location.x, location.y);
}

export function renderPolygon(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    colour: string,
    fillColour?: string,
    lineWidth = 1,
): void {
    if (points.length === 0) {
        return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }

    ctx.closePath();

    if (fillColour) {
        ctx.fillStyle = fillColour;
        ctx.fill();
    }

    ctx.strokeStyle = colour;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
}

export function renderImageLocation(ctx: CanvasRenderingContext2D, location: Point, image: CanvasImageSource): void {
    ctx.drawImage(image, location.x, location.y);
}

/** Fills and outlines an area, brightening the outline while the pointer is inside it. */
export function renderHoverableArea(
    ctx: CanvasRenderingContext2D,
    area: Rectangle,
    mouse: Point | null,
    fillColour: string,
    borderColour: string,
    borderHoverColour: string,
): void {
    const hovered =
        mouse !== null &&
        mouse.x >= area.x &&
        mouse.x < area.x + area.width &&
        mouse.y >= area.y &&
        mouse.y < area.y + area.height;

    ctx.save();
    ctx.fillStyle = fillColour;
    ctx.fillRect(area.x, area.y, area.width, area.height);
    ctx.strokeStyle = hovered ? borderHoverColour : borderColour;
    ctx.lineWidth = 1;
    ctx.strokeRect(area.x + 0.5, area.y + 0.5, area.width - 1, area.height - 1);
    ctx.restore();
}

/**
 * The client's own fonts, matching `FontManager` and `FontType`.
 *
 * All three are 16px on desktop — the faces are bitmap designs drawn at that size, so scaling them
 * gives the blurred approximation this is meant to avoid.
 */
export const OverlayFont = {
    /** `FontType.REGULAR`; the default for overlays. */
    REGULAR: '16px RuneScape',
    /** `FontType.BOLD`. */
    BOLD: 'bold 16px RuneScape',
    /** `FontType.SMALL`. */
    SMALL: '16px "RuneScape Small"',
} as const;

/**
 * The drawing defaults overlays expect.
 *
 * `OverlayRenderer` picks the font by position — dynamic, tooltip and interface are separately
 * configurable on desktop — so the font is a parameter here rather than fixed.
 *
 * Smoothing stays off: the faces are bitmap, and the overlay canvas sits over pixel art that the
 * client itself draws unsmoothed.
 */
export function setGraphicProperties(ctx: CanvasRenderingContext2D, font: string = OverlayFont.REGULAR): void {
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.imageSmoothingEnabled = false;
}

/** Width and height of a string under the context's current font. */
export function measureText(ctx: CanvasRenderingContext2D, text: string): { width: number; height: number } {
    const metrics = ctx.measureText(text);

    return {
        width: metrics.width,
        height: metrics.actualBoundingBoxAscent || 10,
    };
}
