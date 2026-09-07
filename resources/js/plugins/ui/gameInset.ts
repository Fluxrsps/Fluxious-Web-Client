/**
 * Decides whether the game has to give up width to the plugin chrome.
 *
 * The strip and any open panel are fixed to the right edge of the viewport. In fixed mode the game
 * is a 765×503 canvas centred in whatever space it has, so on a wide screen there is already empty
 * black either side of it and the chrome sits in that gap without covering anything. Insetting
 * regardless would shove the game left for no reason.
 *
 * So the inset is applied only when the chrome would actually reach the canvas. In resizable mode
 * the canvas fills its host, so it always would.
 */
import { isPanelOpen, isSidebarHidden, onSidebarLayoutChanged } from './sidebarState';

const INSET_CLASS = 'flx-game-inset';

/** Reads a chrome width from the stylesheet, so the two cannot drift apart. */
function cssPixels(name: string, fallback: number): number {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const parsed = Number.parseFloat(value);

    return Number.isFinite(parsed) ? parsed : fallback;
}

function chromeWidth(): number {
    if (isSidebarHidden()) {
        return 0;
    }

    return cssPixels('--flx-plugin-bar-w', 40) + (isPanelOpen() ? cssPixels('--flx-plugin-panel-w', 240) : 0);
}

/**
 * Whether the chrome overlaps the canvas when the game keeps the full viewport.
 *
 * Worked from the canvas's natural size rather than its current box, because its current box is
 * itself a result of this decision — measuring that would let the two chase each other.
 */
function overlaps(): boolean {
    const host = document.getElementById('game-host');
    const game = document.getElementById('game') as HTMLCanvasElement | null;
    const chrome = chromeWidth();

    if (!host || !game || chrome === 0) {
        return false;
    }

    // Resizable mode: the canvas is the host, so anything the chrome takes comes off the game.
    if (host.classList.contains('game-host--resizable')) {
        return true;
    }

    // Fixed mode: the canvas keeps its aspect and is bounded by the viewport on both axes.
    const scale = Math.min(1, window.innerWidth / game.width, window.innerHeight / game.height);
    const shown = game.width * scale;

    // Centred, so the free space is split between the two sides.
    return (window.innerWidth - shown) / 2 < chrome;
}

function update(): void {
    document.documentElement.classList.toggle(INSET_CLASS, overlaps());
}

/** Starts watching, and returns the function that stops. */
export function startGameInset(): () => void {
    update();

    const stopLayoutWatch = onSidebarLayoutChanged(update);
    window.addEventListener('resize', update);

    // The client swaps between fixed and resizable by resizing its canvas, which no event reports.
    const game = document.getElementById('game');
    const observer = new ResizeObserver(update);

    if (game) {
        observer.observe(game);
    }

    return () => {
        stopLayoutWatch();
        window.removeEventListener('resize', update);
        observer.disconnect();
        document.documentElement.classList.remove(INSET_CLASS);
    };
}
