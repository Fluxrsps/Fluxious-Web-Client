/**
 * The markings drawn into the scene, following the scene-drawing half of `DevToolsOverlay.java`.
 *
 * Separate from the panel overlay because of where each is allowed to draw. A positioned overlay is
 * handed a canvas the renderer has already translated to that overlay's corner, so anything drawn in
 * canvas coordinates lands in the wrong place. A dynamic overlay is not translated, which is what
 * something drawing at a point in the world needs.
 */
import { client } from '../api/game';
import { Overlay } from '../overlay/Overlay';
import { Dimension, OverlayLayer, OverlayPosition, PRIORITY_HIGH } from '../overlay/OverlayEnums';
import { localToCanvas, tileHeight, tilePolygon } from '../ui/perspective';
import { toggles } from './devToolsState';

/** The desktop tools draw their markings in cyan; keeping that makes them obvious and familiar. */
const MARKING = '#00ffff';

export class DevToolsSceneOverlay extends Overlay {
    constructor() {
        super();
        this.setLayer(OverlayLayer.ABOVE_SCENE);
        this.setPriority(PRIORITY_HIGH);
        // Dynamic, so the renderer leaves the canvas alone and these coordinates mean what they say.
        this.setPosition(OverlayPosition.DYNAMIC);
    }

    getName(): string {
        return 'DevToolsSceneOverlay';
    }

    render(ctx: CanvasRenderingContext2D): Dimension | null {
        if (toggles.tileLocation) {
            this.drawPlayerTile(ctx);
        }

        if (toggles.interacting) {
            this.drawInteracting(ctx);
        }

        // Nothing to lay out: this draws into the scene rather than occupying a corner.
        return null;
    }

    /** The tile the player stands on, outlined and labelled with its world coordinates. */
    private drawPlayerTile(ctx: CanvasRenderingContext2D): void {
        const player = client.getLocalPlayer();
        const local = player?.getLocalLocation();
        const world = player?.getWorldLocation();

        if (!local || !world) {
            return;
        }

        // At the ground's own height, so the outline lies on the tile rather than at sea level.
        const height = tileHeight(local.getSceneX(), local.getSceneY(), world.getPlane());
        const corners = tilePolygon(local.getSceneX(), local.getSceneY(), height);

        if (!corners) {
            return;
        }

        ctx.save();
        ctx.strokeStyle = MARKING;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);

        for (let i = 1; i < corners.length; i++) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }

        ctx.closePath();
        ctx.stroke();

        const label = `${world.getX()}, ${world.getY()}, ${world.getPlane()}`;
        const x = (corners[0].x + corners[2].x) / 2;
        const y = (corners[0].y + corners[2].y) / 2;

        ctx.fillStyle = '#000000';
        ctx.fillText(label, x + 1, y + 1);
        ctx.fillStyle = MARKING;
        ctx.fillText(label, x, y);
        ctx.restore();
    }

    /** A line from the player to whatever it is interacting with. */
    private drawInteracting(ctx: CanvasRenderingContext2D): void {
        const player = client.getLocalPlayer();
        const target = player?.getInteracting();
        const from = player?.getLocalLocation();
        const to = target?.getLocalLocation();

        if (!from || !to) {
            return;
        }

        const start = localToCanvas(from.getX(), from.getY(), tileHeight(from.getSceneX(), from.getSceneY(), client.getTopLevelWorldView()?.getPlane() ?? 0));
        const end = localToCanvas(to.getX(), to.getY(), tileHeight(to.getSceneX(), to.getSceneY(), client.getTopLevelWorldView()?.getPlane() ?? 0));

        if (!start || !end) {
            return;
        }

        ctx.save();
        ctx.strokeStyle = MARKING;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.restore();
    }
}
