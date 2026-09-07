/**
 * The FPS indicator, ported from `FpsOverlay.java`.
 *
 * Locks "FPS" into the top-right corner of the canvas with the value beside it, and colours the
 * value by whether a limit is being enforced — red when it is, yellow when it is not. The desktop
 * original exists because the built-in overlay shifts around; what stops it shifting is the fixed
 * corner placement, not the typeface, so the font is the renderer's like every other overlay.
 */
import { client } from '../api/game';
import { InterfaceID } from '../api/InterfaceID';
import type { ConfigReader } from '../types';
import { Overlay } from '../overlay/Overlay';
import { Dimension, OverlayLayer, OverlayPosition, PRIORITY_HIGH } from '../overlay/OverlayEnums';
import { measureText, renderTextLocation } from '../overlay/OverlayUtil';
import { drawFps, isEnforced } from './fpsConfig';

const Y_OFFSET = 1;
const X_OFFSET = 1;
const FPS_STRING = ' FPS';

/** `Color.red` / `Color.yellow` in the original. */
const COLOUR_ENFORCED = '#ff0000';
const COLOUR_FREE = '#ffff00';

export class FpsOverlay extends Overlay {
    private isFocused = true;

    /** Set by the plugin, since an overlay has no injected config on this side. */
    config: ConfigReader | null = null;

    constructor() {
        super();
        this.setLayer(OverlayLayer.ABOVE_WIDGETS);
        this.setPriority(PRIORITY_HIGH);
        this.setPosition(OverlayPosition.DYNAMIC);
    }

    getName(): string {
        return 'FpsOverlay';
    }

    onFocusChanged(focused: boolean): void {
        this.isFocused = focused;
    }

    private valueColour(config: ConfigReader): string {
        return isEnforced(config, this.isFocused) ? COLOUR_ENFORCED : COLOUR_FREE;
    }

    render(ctx: CanvasRenderingContext2D): Dimension | null {
        const config = this.config;

        if (!config || !drawFps(config)) {
            return null;
        }

        const fps = client.getFPS();
        const text = `${fps}${FPS_STRING}`;
        const size = measureText(ctx, text);

        // In resizable bottom-line mode the logout button sits at the top right, so shift left past
        // it — the same correction the desktop overlay makes.
        let xOffset = X_OFFSET;
        const logoutButton = client.getWidget(InterfaceID.ToplevelPreEoc.ICON10);

        if (logoutButton && !logoutButton.isHidden()) {
            xOffset += logoutButton.getWidth();
        }

        // DYNAMIC, so this overlay places itself against the canvas rather than being stacked.
        const x = ctx.canvas.width - size.width - xOffset;
        const y = size.height + Y_OFFSET;

        renderTextLocation(ctx, { x, y }, text, this.valueColour(config));

        return { width: size.width, height: size.height };
    }
}
