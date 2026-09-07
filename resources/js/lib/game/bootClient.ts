import { DEFAULT_JAV_CONFIG_URL, hostFromCodebase, loadJavConfig } from './javConfig';
import { reportLoading } from './loadingState';

/**
 * Brings the game client up inside the page.
 *
 * The client is a TeaVM build served as static files from {@link CLIENT_BASE} (not /play, which is
 * this Inertia page); its runtime helpers are plain scripts that publish themselves on `window`, so
 * they are loaded in order before the client itself. Everything the client needs to reach the
 * server goes into `window.__webConfig`, which it reads once on startup.
 */
const CLIENT_BASE = '/client/';

/** Runtime helpers, in dependency order: decoders first, then the bridges that use them. */
const RUNTIME_SCRIPTS = [
    'web/pako.min.js',
    'web/jpeg-decoder.js',
    'web/upng.js',
    'web/web-image.js',
    'web/vfs.js',
    'web/http.js',
    'web/websocket.js',
    // Ahead of input.js, which reads the rotation it publishes on `window` to map pointer events.
    'web/orientation.js',
    'web/canvas.js',
    'web/input.js',
    // Before canvas.js would be wrong: canvas.js only calls into it, and it must exist by the time
    // the client paints its first frame, which is well after every script here has loaded.
    'web/login.js',
    'web/login-pow.js',
];

/**
 * Login screen artwork, decoded by the browser before the client starts.
 *
 * The client reads these back by name (see `LoginBackground` / `LoginBackgroundBorder` in
 * `mixin/mixins-web`), so the names here are a contract with the client build. The desktop client
 * loads the same two files off its classpath; the browser has none, so the site serves them.
 */
const LOGIN_ASSETS: Array<[string, string]> = [
    ['login-background', '/assets/game/background.gif'],
    ['login-border', '/assets/game/background-border.png'],
];

/**
 * The bridge port, matching `websocket.port` in the server's game.yml.
 *
 * Fixed rather than configured: every world listens on it, and `jav_config.ws` — which says which
 * host to play against — has no field for a port. `?wsPort=` overrides it for testing.
 */
const DEFAULT_BRIDGE_PORT = '8091';
const DEFAULT_GAME_PORT = 43594;
/** Matches the major revision the client puts in its login block; see `revision` in game.yml. */
const DEFAULT_REVISION = 240;
const BRIDGE_PROBE_TIMEOUT_MS = 5000;

/**
 * A boot failure, described for a player rather than a developer.
 *
 * `detail` is the technical cause. It goes to the console only: the page must not put server
 * addresses or internal paths in front of players.
 */
export type BootFailure = {
    title: string;
    message: string;
    detail?: string;
    retryable: boolean;
};

/**
 * Whether the WebSocket bridge is up.
 *
 * Checked before the long part of boot so an offline server is reported in about a second, rather
 * than after the cache has been prepared. A range request keeps it to a single byte.
 */
async function isBridgeReachable(origin: string): Promise<boolean> {
    try {
        const response = await fetch(`${origin}/cache/main_file_cache.idx255`, {
            headers: { Range: 'bytes=0-0' },
            cache: 'no-store',
            signal: AbortSignal.timeout(BRIDGE_PROBE_TIMEOUT_MS),
        });
        return response.ok;
    } catch {
        return false;
    }
}

/** Whether this page is a developer's own machine rather than a deployed site. */
function isLocal(): boolean {
    const host = window.location.hostname;

    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '';
}

/**
 * Whether a WebSocket to the bridge actually opens.
 *
 * Separate from {@link isBridgeReachable} because the two fail independently: a corporate proxy or
 * an HTTPS page will serve the bridge's files over HTTP and refuse the socket, and the client can do
 * nothing without the socket. Told apart here so the page can say which one is wrong.
 */
async function isSocketReachable(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        let socket: WebSocket;

        try {
            socket = new WebSocket(url);
        } catch {
            resolve(false);

            return;
        }

        const done = (ok: boolean) => {
            window.clearTimeout(timer);
            socket.onopen = null;
            socket.onerror = null;
            socket.onclose = null;
            // Closing an opening socket is fine; the server sees a connection that went away.
            socket.close();
            resolve(ok);
        };

        const timer = window.setTimeout(() => done(false), BRIDGE_PROBE_TIMEOUT_MS);

        socket.onopen = () => done(true);
        socket.onerror = () => done(false);
        socket.onclose = () => done(false);
    });
}

/**
 * Whether this script is already in the document.
 *
 * Boot can run more than once against the same document — a hot reload in development, or a second
 * mount of the page. The runtime scripts declare their globals with `const`, so a second append
 * throws "Identifier 'WebImage' has already been declared" and the file's later side effects never
 * run, leaving a half-initialised runtime far harder to read than the failure that caused it.
 *
 * Asked of the document rather than remembered in a module-level set, because a hot reload replaces
 * the module: the set would come back empty while the scripts it described were still on the page.
 */
function alreadyLoaded(src: string): boolean {
    const url = new URL(src, window.location.href).href;

    return [...document.querySelectorAll('script[src]')].some(
        (script) => (script as HTMLScriptElement).src === url,
    );
}

/**
 * How loading a script ended.
 *
 * "missing" and "threw" are different failures with different answers, and telling a player the
 * client "could not be downloaded" when in fact it downloaded and then blew up sends them off
 * refreshing at a problem no refresh will fix.
 */
type ScriptLoad = { status: 'ok' } | { status: 'missing' } | { status: 'threw'; detail: string };

function loadScript(src: string): Promise<ScriptLoad> {
    if (alreadyLoaded(src)) {
        return Promise.resolve({ status: 'ok' });
    }

    return new Promise((resolve) => {
        const el = document.createElement('script');

        // A script that throws while evaluating still fires load, not error — the failure only
        // surfaces on window. Watched for the duration of this load and matched by URL, so an
        // unrelated error elsewhere on the page is not blamed on this script.
        let thrown: string | undefined;
        const onWindowError = (event: ErrorEvent) => {
            if (event.filename === el.src) {
                thrown = event.message || String(event.error);
            }
        };

        window.addEventListener('error', onWindowError);

        const finish = (result: ScriptLoad) => {
            window.removeEventListener('error', onWindowError);
            resolve(result);
        };

        el.src = src;
        el.onload = () => {
            if (thrown) {
                finish({ status: 'threw', detail: thrown });

                return;
            }

            finish({ status: 'ok' });
        };
        el.onerror = () => finish({ status: 'missing' });
        document.body.appendChild(el);
    });
}

/**
 * Eases the reported percentage towards the last milestone.
 *
 * Boot is a handful of large steps, and a bar that sits still for ten seconds then leaps looks
 * broken even when nothing is wrong.
 */
function createProgressEasing() {
    let target = 5;
    let shown = 5;
    let status = 'Starting';
    let raf = 0;

    const tick = () => {
        const cap = target < 95 ? target + 0.15 : target;
        shown += (Math.min(cap, 99) - shown) * 0.08;
        if (shown < target - 0.5) {
            shown += 0.02;
        }
        reportLoading(shown, status);
        raf = requestAnimationFrame(tick);
    };

    return {
        start() {
            reportLoading(shown, status);
            raf = requestAnimationFrame(tick);
        },
        set(percent: number, message: string) {
            target = Math.min(99, Math.max(shown, percent));
            status = message;
        },
        stop() {
            cancelAnimationFrame(raf);
            raf = 0;
        },
    };
}

export async function bootGameClient(): Promise<BootFailure | null> {
    const params = new URLSearchParams(window.location.search);
    const easing = createProgressEasing();

    /** Stops the progress animation and records the cause where a developer can find it. */
    const fail = (failure: BootFailure): BootFailure => {
        easing.stop();
        if (failure.detail) {
            console.error(`[boot] ${failure.title}: ${failure.detail}`);
        }
        return failure;
    };

    try {
        easing.start();
        easing.set(8, 'Loading runtime');

        for (const script of RUNTIME_SCRIPTS) {
            const load = await loadScript(CLIENT_BASE + script);

            if (load.status === 'missing') {
                return fail({
                    title: 'Client files are missing',
                    message:
                        'Part of the game client failed to load. This usually means the site is ' +
                        'mid-deploy, so refreshing in a moment should fix it.',
                    detail: `Failed to load ${CLIENT_BASE}${script}`,
                    retryable: true,
                });
            }

            if (load.status === 'threw') {
                return fail({
                    title: 'The client stopped unexpectedly',
                    message:
                        'A part of the game client failed while starting up. This is a fault on our ' +
                        'side rather than yours — please let us know if it keeps happening.',
                    detail: `${CLIENT_BASE}${script} threw while loading: ${load.detail}`,
                    retryable: true,
                });
            }
        }

        window.WebCanvas.attach('game');
        window.WebInput.attach('game');

        // Which server to play against comes from jav_config.ws, the same file the desktop launcher
        // reads: `codebase` names the host. Fetched every boot rather than built in, so moving a
        // world is one edit on the server and every client follows.
        easing.set(10, 'Reading server configuration');

        const javConfigUrl =
            params.get('javConfig') || import.meta.env.VITE_JAV_CONFIG_URL || DEFAULT_JAV_CONFIG_URL;

        let codebaseHost: string | null = null;

        // A query-string host is a tester pointing the client somewhere by hand, and that beats the
        // published configuration — so there is no reason to fetch it at all in that case.
        if (!params.get('wsHost')) {
            const failure = { url: javConfigUrl, reason: '' };

            try {
                codebaseHost = hostFromCodebase(await loadJavConfig(javConfigUrl));

                if (!codebaseHost) {
                    failure.reason = 'no usable codebase';
                }
            } catch (e) {
                failure.reason = e instanceof Error ? e.message : String(e);
            }

            if (!codebaseHost) {
                // Development runs against a server on this machine, and the published config
                // names a live world it should not be talking to — so a failure there is expected
                // rather than fatal, and the local bridge is the right answer.
                if (!isLocal()) {
                    return fail({
                        title: 'Cannot reach the server list',
                        message:
                            'We could not work out which server to connect you to. This is a problem ' +
                            'on our side rather than yours; please try again in a minute.',
                        detail: `${failure.url}: ${failure.reason}`,
                        retryable: true,
                    });
                }

                console.warn(
                    `[boot] ${failure.url}: ${failure.reason} — using this host, as this is a local run`,
                );
            }
        }

        const wsHost = params.get('wsHost') || codebaseHost || window.location.hostname || '127.0.0.1';
        const wsPort = params.get('wsPort') || DEFAULT_BRIDGE_PORT;

        // A page served over HTTPS may not open an insecure socket or fetch insecure files: the
        // browser blocks both as mixed content, and the client would fail with nothing to show for
        // it. So the scheme follows the page unless the deploy says otherwise, which is what a
        // plain-HTTP bridge behind an HTTPS site needs.
        const secure = (import.meta.env.VITE_GAME_WS_SECURE ?? '') !== ''
            ? import.meta.env.VITE_GAME_WS_SECURE === 'true'
            : window.location.protocol === 'https:';

        const httpScheme = secure ? 'https' : 'http';
        const wsScheme = secure ? 'wss' : 'ws';
        const bridgeOrigin = `${httpScheme}://${wsHost}:${wsPort}`;

        window.__webConfig = {
            js5WsUrl: `${wsScheme}://${wsHost}:${wsPort}/js5`,
            gameWsUrl: `${wsScheme}://${wsHost}:${wsPort}/game`,
            js5TcpPort: parseInt(params.get('js5Port') || String(DEFAULT_GAME_PORT), 10),
            gameTcpPort: parseInt(params.get('gamePort') || String(DEFAULT_GAME_PORT), 10),
            revision: parseInt(params.get('rev') || String(DEFAULT_REVISION), 10),
            // The bridge serves the cache seed as well as the sockets.
            cacheBaseUrl: bridgeOrigin,
            worldListUrl: params.get('worldListUrl') || `${bridgeOrigin}/worldlist`,
            worldListPrimaryUrl: '',
            worldListFallbackProxy: `${bridgeOrigin}/worldlist`,
            jxAccessToken: params.get('jxAccessToken') || '',
        };

        easing.set(12, 'Contacting game server');
        if (!(await isBridgeReachable(bridgeOrigin))) {
            return fail({
                title: 'The game server is offline',
                message:
                    'We could not reach the game server, so there is nothing to connect to. It may ' +
                    'be restarting, so please try again in a minute.',
                detail: `No response from ${bridgeOrigin}`,
                retryable: true,
            });
        }

        // The bridge answers over HTTP but the socket is what the client plays through, and the two
        // are blocked independently.
        if (!(await isSocketReachable(window.__webConfig.js5WsUrl))) {
            return fail({
                title: 'The game server cannot be reached',
                message:
                    'The server is up, but the connection the game plays over could not be opened. ' +
                    'A firewall, VPN or network that blocks WebSockets is the usual cause.',
                detail: `WebSocket to ${window.__webConfig.js5WsUrl} did not open`,
                retryable: true,
            });
        }

        easing.set(15, 'Opening cache');
        await window.WebVfs.init();
        easing.set(32, 'Preparing cache');
        await window.WebVfs.ensureCacheBootstrap();

        easing.set(45, 'Fetching world list');
        await window.WebHttp.prefetch(window.__webConfig.worldListUrl);

        easing.set(58, 'Loading artwork');
        // Not fatal: preloadAsset reports its own failure, and the login screen draws without the
        // artwork the same way the desktop client does when the files are missing.
        await Promise.all(LOGIN_ASSETS.map(([name, url]) => window.WebImage.preloadAsset(name, url)));

        easing.set(68, 'Downloading client');
        const clientUrl = `${CLIENT_BASE}web-client.js?t=${Date.now()}`;
        const load = await loadScript(clientUrl);

        if (load.status === 'missing') {
            return fail({
                title: 'Game client not available',
                message:
                    'The client could not be downloaded. If this keeps happening it has not been ' +
                    'deployed to the site yet.',
                detail: `${CLIENT_BASE}web-client.js did not load`,
                retryable: true,
            });
        }

        // Downloaded and then failed on its own terms: a build problem, not a delivery one.
        if (load.status === 'threw') {
            return fail({
                title: 'The client stopped unexpectedly',
                message:
                    'The game client downloaded but could not start. This is a fault in the build ' +
                    'rather than anything you did — please let us know if it keeps happening.',
                detail: `${CLIENT_BASE}web-client.js threw while loading: ${load.detail}`,
                retryable: true,
            });
        }

        if (typeof window.main !== 'function') {
            return fail({
                title: 'Game client is incomplete',
                message:
                    'The client loaded but is missing its entry point, which usually means a ' +
                    'half-finished deploy. Refreshing in a minute should pick up the full build.',
                detail: `${CLIENT_BASE}web-client.js exposed no main()`,
                retryable: true,
            });
        }

        easing.set(82, 'Starting client');

        // Hand progress over to the client before starting it. From here the client reports its own
        // steps ("Loading - please wait", "Loaded world map", ...) through WebCanvas.drawLoadingBar;
        // leaving the easing loop running would overwrite each of them on the next frame.
        easing.stop();

        await new Promise<void>((resolve, reject) => {
            window.main!((err) => (err ? reject(err) : resolve()));
        });

        return null;
    } catch (e) {
        console.error(e);
        return fail({
            title: 'The client stopped unexpectedly',
            message:
                'Something went wrong while starting the game. Refreshing usually clears it; if it ' +
                'keeps happening, please let us know.',
            detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
            retryable: true,
        });
    }
}
