/**
 * An overlay that draws a panel, ported from `OverlayPanel`.
 *
 * Subclasses fill `panelComponent` in `render` and let the base class draw and size it, which is
 * how nearly every desktop panel overlay is written:
 *
 * ```ts
 * render(ctx) {
 *     this.panelComponent.getChildren().length = 0;
 *     this.panelComponent.getChildren().push(TitleComponent.builder().setText('Timers'));
 *     return super.render(ctx);
 * }
 * ```
 */
import { Overlay } from './Overlay';
import { PanelComponent } from './components';
import type { Dimension } from './OverlayEnums';

export abstract class OverlayPanel extends Overlay {
    protected readonly panelComponent = new PanelComponent();

    /** Cleared between frames by convention; kept here so subclasses need not repeat it. */
    protected clearPanel(): void {
        this.panelComponent.getChildren().length = 0;
    }

    render(ctx: CanvasRenderingContext2D): Dimension | null {
        const preferred = this.getPreferredSize();

        if (preferred) {
            this.panelComponent.setPreferredSize(preferred);
        }

        const size = this.panelComponent.render(ctx);

        return size.width > 0 && size.height > 0 ? size : null;
    }
}
