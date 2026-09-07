import type { LoginSnapshot } from './loginState';

export {};

/**
 * Globals published by the game client's runtime scripts (served from /play/web/*.js).
 *
 * These are plain scripts loaded at boot rather than modules, so they arrive on `window`. The
 * client itself is compiled from Java by TeaVM and reads `__webConfig` on startup.
 */
declare global {
    interface WebConfig {
        js5WsUrl: string;
        gameWsUrl: string;
        js5TcpPort: number;
        gameTcpPort: number;
        revision: number;
        cacheBaseUrl: string;
        worldListUrl: string;
        worldListPrimaryUrl: string;
        worldListFallbackProxy: string;
        jxAccessToken: string;
    }

    interface Window {
        __webConfig?: WebConfig;
        FluxLoading?: {
            report(progress: number, status: string): void;
            frame(): void;
        };
        /** Installed by the page; the client pushes its login state here, `null` once it is gone. */
        FluxLogin?: {
            state(snapshot: LoginSnapshot | null): void;
            /** The logged-in character, reported while the login screen is gone. */
            player(info: { name: string; totalLevel: number }): void;
        };
        /** Queues login actions for the client to drain on its next frame. */
        WebLogin?: {
            login(username: string, password: string, world: number): void;
            otp(code: string): void;
            backToLogin(): void;
            selectWorld(world: number): void;
            refreshWorlds(): void;
            setMuted(muted: boolean): void;
        };
        WebVfs: {
            init(): Promise<void>;
            ensureCacheBootstrap(): Promise<void>;
        };
        WebCanvas: { attach(id: string): void };
        WebInput: { attach(id: string): void };
        WebImage: {
            /** Decodes an image (every frame, if animated) and files it under `name` for the client. */
            preloadAsset(name: string, url: string): Promise<boolean>;
        };
        WebHttp: {
            prefetch(url: string): Promise<boolean>;
            aliasCache(from: string, to: string): void;
        };
        main?: (onError: (err: Error | null) => void) => void;
    }
}
