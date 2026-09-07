/**
 * The frame limiter, ported from `FpsDrawListener.java` — with the sleep on the other side of the
 * boundary.
 *
 * The desktop listener runs after the canvas has been painted and sleeps the client thread for a
 * calculated amount, converging on the target over a couple of seconds. A browser cannot sleep
 * anything from here: JavaScript owns the one thread the page paints on, and blocking it would
 * freeze the client, the overlay and the UI together.
 *
 * So this half keeps the policy — is a limit in force, and what is the target — and publishes it
 * for the client to read. The sampling and the sleep itself live in `web.FrameLimiter` on the Java
 * side, running inside the client's per-frame callback, which is the same place in the frame the
 * desktop listener occupies.
 */
import type { ConfigReader } from '../types';
import { isEnforced, maxFps, maxFpsUnfocused, limitFpsUnfocused } from './fpsConfig';

export class FpsDrawListener {
    private isFocused = true;

    onFocusChanged(focused: boolean): void {
        this.isFocused = focused;
        this.reloadConfig();
    }

    /** Recomputed on config change and focus change, exactly as the original reloads. */
    reloadConfig(config?: ConfigReader): void {
        if (config) {
            this.config = config;
        }

        this.publish();
    }

    private config: ConfigReader | null = null;

    private targetFps(): number {
        if (!this.config) {
            return 0;
        }

        if (!isEnforced(this.config, this.isFocused)) {
            return 0;
        }

        const fps =
            limitFpsUnfocused(this.config) && !this.isFocused ? maxFpsUnfocused(this.config) : maxFps(this.config);

        return Math.max(1, fps);
    }

    private publish(): void {
        if (window.FluxPlugins) {
            window.FluxPlugins.frameLimit = this.targetFps();
        }
    }

    /** Clears the limit, so disabling the plugin gives the frame rate straight back. */
    shutDown(): void {
        if (window.FluxPlugins) {
            window.FluxPlugins.frameLimit = 0;
        }
    }
}
