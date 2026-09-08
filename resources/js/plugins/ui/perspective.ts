/**
 * Turning a place in the world into a place on the canvas.
 *
 * A port of the parts of RuneLite's `Perspective` that overlays actually use. It is not in the
 * generated API because the original returns `java.awt` geometry, which does not cross to a browser;
 * the arithmetic is the client's own and is reproduced here rather than bridged.
 */
import { client } from '../api/game';
import { ApiArray } from '../api/runtime';

/** Local units per tile, and how the client measures a turn. */
export const LOCAL_TILE_SIZE = 128;
const UNITS = 16384;

/**
 * Where the drawn scene sits inside the loaded one.
 *
 * The client loads more of the world than it draws, so the height grid is indexed in the larger of
 * the two. `(184 - 104) / 2`, as the client computes it.
 */
const SCENE_OFFSET = 40;

/** The client's sine and cosine at its own angular resolution, built once. */
const SINE = new Int32Array(UNITS);
const COSINE = new Int32Array(UNITS);

for (let i = 0; i < UNITS; i++) {
    const angle = (i * 2 * Math.PI) / UNITS;

    SINE[i] = Math.trunc(65536 * Math.sin(angle));
    COSINE[i] = Math.trunc(65536 * Math.cos(angle));
}

export interface CanvasPoint {
    x: number;
    y: number;
}

/**
 * The ground's height at a scene tile, or zero if it cannot be read.
 *
 * The client's height grid is `int[plane][x][y]`, and the generated bridge does not know what to
 * make of an array of arrays — it types the result as a flat one and stops. It is still walkable:
 * an element of an array of arrays comes back as a handle to the inner array, so each dimension is
 * one more wrap. Anything unexpected answers zero rather than throwing, because this is only ever
 * used to place a marking.
 */
export function tileHeight(sceneX: number, sceneY: number, plane: number): number {
    const view = client.getTopLevelWorldView();
    const scene = view?.getScene();

    if (!scene) {
        return 0;
    }

    const nested = (handle: number, index: number): number =>
        new ApiArray<number>(handle, 'none', null).get(index);

    const planes = scene.getTileHeights();
    const rows = planes.get(plane);

    if (!rows) {
        return 0;
    }

    const row = nested(rows, sceneX + SCENE_OFFSET);

    if (!row) {
        return 0;
    }

    return nested(row, sceneY + SCENE_OFFSET) || 0;
}

/**
 * Where a point in the scene lands on the canvas, or null if it is behind the camera.
 *
 * `x` and `y` are the scene's horizontal axes and `height` is up — the client's naming, where the
 * camera's own Y is the height and its Z is north.
 */
export function localToCanvas(x: number, y: number, height: number): CanvasPoint | null {
    const pitch = client.getCameraPitch() & (UNITS - 1);
    const yaw = client.getCameraYaw() & (UNITS - 1);

    // RuneLite's `Perspective` takes north from `getCameraZ` and height from `getCameraY`. This
    // client's accessors are the other way round — a camera at ground level reads Y in the thousands
    // and Z in the hundreds negative, which is a northing and a height respectively.
    const dx = x - client.getCameraX();
    const dy = y - client.getCameraY();
    const dz = height - client.getCameraZ();

    const pitchSin = SINE[pitch];
    const pitchCos = COSINE[pitch];
    const yawSin = SINE[yaw];
    const yawCos = COSINE[yaw];

    const rotatedX = (dx * yawCos + dy * yawSin) >> 16;
    const rotatedY = (dy * yawCos - dx * yawSin) >> 16;
    const screenY = (dz * pitchCos - rotatedY * pitchSin) >> 16;
    const depth = (rotatedY * pitchCos + dz * pitchSin) >> 16;

    // The client's own near plane. Closer than this the divide below is meaningless.
    if (depth < 50) {
        return null;
    }

    const scale = client.getScale();

    return {
        x: client.getViewportWidth() / 2 + (rotatedX * scale) / depth + client.getViewportXOffset(),
        y: client.getViewportHeight() / 2 + (screenY * scale) / depth + client.getViewportYOffset(),
    };
}

/**
 * The four corners of a tile, at the tile's own height, or null if any corner is behind the camera.
 *
 * Drawn as a polygon this is the tile outline the desktop tools draw; a tile whose corners are not
 * all visible is dropped rather than drawn wrong, which is what the original does too.
 */
export function tilePolygon(sceneX: number, sceneY: number, height: number): CanvasPoint[] | null {
    const x = sceneX * LOCAL_TILE_SIZE;
    const y = sceneY * LOCAL_TILE_SIZE;
    const corners: CanvasPoint[] = [];

    for (const [ox, oy] of [
        [0, 0],
        [LOCAL_TILE_SIZE, 0],
        [LOCAL_TILE_SIZE, LOCAL_TILE_SIZE],
        [0, LOCAL_TILE_SIZE],
    ]) {
        const point = localToCanvas(x + ox, y + oy, height);

        if (!point) {
            return null;
        }

        corners.push(point);
    }

    return corners;
}
