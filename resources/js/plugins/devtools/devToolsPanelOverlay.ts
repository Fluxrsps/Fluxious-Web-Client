/**
 * The text panel, following `LocationOverlay.java` and `CameraOverlay.java`.
 *
 * Both are one panel here rather than two overlays that each decide whether to draw nothing.
 */
import { client } from '../api/game';
import { OverlayPanel } from '../overlay/OverlayPanel';
import { LineComponent, TitleComponent } from '../overlay/components';
import { Dimension, OverlayLayer, OverlayPosition, PRIORITY_HIGH } from '../overlay/OverlayEnums';
import { toggles } from './devToolsState';

const VALUE = '#ffffff';

export class DevToolsPanelOverlay extends OverlayPanel {
    constructor() {
        super();
        this.setLayer(OverlayLayer.ABOVE_WIDGETS);
        this.setPriority(PRIORITY_HIGH);
        this.setPosition(OverlayPosition.TOP_LEFT);
    }

    getName(): string {
        return 'DevToolsPanelOverlay';
    }

    render(ctx: CanvasRenderingContext2D): Dimension | null {
        this.clearPanel();

        if (toggles.location) {
            this.addLocation();
        }

        if (toggles.cameraPosition) {
            this.addCamera();
        }

        return this.panelComponent.getChildren().length > 0 ? super.render(ctx) : null;
    }

    /** Where the player is, in every coordinate space the client thinks in at once. */
    private addLocation(): void {
        const player = client.getLocalPlayer();
        const world = player?.getWorldLocation();
        const local = player?.getLocalLocation();

        if (!world || !local) {
            return;
        }

        const x = world.getX();
        const y = world.getY();

        // The region a coordinate falls in, and where it sits inside it, as the client numbers them.
        const region = ((x >> 6) << 8) | (y >> 6);
        const children = this.panelComponent.getChildren();

        children.push(TitleComponent.builder().setText('Location'));
        children.push(
            LineComponent.builder().setLeft('World').setRight(`${x}, ${y}, ${world.getPlane()}`).setRightColor(VALUE),
        );
        children.push(
            LineComponent.builder().setLeft('Region').setRight(`${region} (${x & 63}, ${y & 63})`).setRightColor(VALUE),
        );
        children.push(LineComponent.builder().setLeft('Chunk').setRight(`${x >> 3}, ${y >> 3}`).setRightColor(VALUE));
        children.push(
            LineComponent.builder()
                .setLeft('Scene')
                .setRight(`${local.getSceneX()}, ${local.getSceneY()}`)
                .setRightColor(VALUE),
        );
    }

    private addCamera(): void {
        const children = this.panelComponent.getChildren();

        children.push(TitleComponent.builder().setText('Camera'));
        children.push(
            LineComponent.builder()
                .setLeft('Position')
                .setRight(`${client.getCameraX()}, ${client.getCameraY()}, ${client.getCameraZ()}`)
                .setRightColor(VALUE),
        );
        children.push(
            LineComponent.builder()
                .setLeft('Angle')
                .setRight(`yaw ${client.getCameraYaw()}  pitch ${client.getCameraPitch()}`)
                .setRightColor(VALUE),
        );
        children.push(LineComponent.builder().setLeft('Scale').setRight(`${client.getScale()}`).setRightColor(VALUE));
    }
}
