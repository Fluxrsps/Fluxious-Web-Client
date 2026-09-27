import { reportConnection } from './connectionState';
import { isMobileDevice, mobileOsOverride } from './device';
import { DEFAULT_JAV_CONFIG_URL, hostFromCodebase, loadJavConfig } from './javConfig';
import { reportLoading } from './loadingState';

/**
 * Brings the game client up inside the page.
 *
 * The client is a TeaVM build served as static files from {@link CLIENT_BASE} (not /play, which is
 * this Inertia page); its runtime helpers are plain scripts that publish themselves on `window`, so
 * they are loaded in order before the client itself. Everything the client needs to reach the
 * server goes into `window.__webConfig`, which it reads once on startup.
 *
 * Boot is a handful of independent waits — the server config, the runtime scripts, the client
 * download, the cache, the bridge probes, the artwork — and none of them need the others' results
 * except where noted below. They are started together and awaited where they are needed, so the
 * time to the login screen is the longest of them rather than the sum.
 */
const CLIENT_BASE = '/client/';

/**
 * Identifies this deploy's client files, and goes on every client URL as `?v=`.
 *
 * The files under /client/ are served as immutable, so a changed build has to change its URL:
 * the hash is taken from the files themselves at build time (see vite.config.ts), which means a
 * redeployed client is fetched once and then comes out of the browser's cache on every visit
 * until it changes again. The old `?t=<now>` re-downloaded seven megabytes on every load.
 */
const CLIENT_BUILD = import.meta.env.VITE_CLIENT_BUILD || 'dev';

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
    // Battery and connection for the mobile interface; starts its one async read on load.
    'web/device.js',
    // The renderer, ahead of canvas.js: which context the canvas gets is decided before it attaches.
    'web/gpu/stats.js',
    'web/gpu/regions.js',
    'web/gpu/shaders.js',
    'web/gpu/scene.js',
    'web/gpu/webgpu.js',
    'web/gpu/webgl2.js',
    'web/gpu/gpu.js',
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

/**
 * Suffix added to the first label of the codebase host to reach the bridge.
 *
 * `codebase` in `jav_config.ws` names the world as the desktop client connects to it —
 * `world1.fluxious-rsps.com`, a raw game port on a DNS-only record. The browser needs the same world
 * over TLS, which is a separate record in front of the bridge, so the host is derived rather than
 * configured: a new world is still one edit on the server plus its DNS entry.
 */
const BRIDGE_HOST_SUFFIX = '-proxy';

const DEFAULT_GAME_PORT = 43594;
/** Matches the major revision the client puts in its login block; see `revision` in game.yml. */
const DEFAULT_REVISION = 240;
const BRIDGE_PROBE_TIMEOUT_MS = 5000;

/**
 * How long to wait for `jav_config.ws` before falling back to the host it named last time.
 *
 * The config changes when a world moves, which is rare, and the fetch has been seen to take seven
 * seconds on a cold browser while the bridge it names answered in a hundredth of that. So a remembered
 * answer is used once the fetch is this late, and the fetch is left to finish and refresh the memory
 * for next time. A first visit has nothing remembered and waits the full timeout as before.
 */
const JAV_CONFIG_SOFT_TIMEOUT_MS = 2000;
const JAV_CONFIG_MEMORY_KEY = 'flux.javConfig.codebaseHost';

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

/** The URL a client file is loaded by: under {@link CLIENT_BASE}, stamped with the build. */
function clientUrl(file: string): string {
    return `${CLIENT_BASE}${file}?v=${encodeURIComponent(CLIENT_BUILD)}`;
}

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

/**
 * Where the client reads the world list from.
 *
 * Central publishes it beside `jav_config.ws`, so the two come from one server: point the config at
 * a local central and the worlds follow. `worldslist.ws` is the binary form the client parses;
 * `worlds.js` next to it is the same data as JSON, for anything reading it from the page.
 */
function worldListUrl(javConfigUrl: string, bridgeOrigin: string, params: URLSearchParams): string {
    const override = params.get('worldListUrl') || import.meta.env.VITE_WORLD_LIST_URL;

    if (override) {
        return override;
    }

    // Relative config URLs are a dev-proxy path, and resolve against the page.
    const base = new URL(javConfigUrl, window.location.href);

    return new URL('worldslist.ws', base).href;
}

/**
 * The bridge's host for a world named by `codebase`.
 *
 * Only a real domain is rewritten. An address literal has no labels to put a subdomain in front of,
 * and a single-label name is a machine on the local network — both are development, where the
 * bridge is the same host the game port is on.
 */
function bridgeHost(codebaseHost: string): string {
    const labels = codebaseHost.split('.');

    if (labels.length < 2 || /^[\d[]/.test(codebaseHost)) {
        return codebaseHost;
    }

    if (labels[0].endsWith(BRIDGE_HOST_SUFFIX)) {
        return codebaseHost;
    }

    return [`${labels[0]}${BRIDGE_HOST_SUFFIX}`, ...labels.slice(1)].join('.');
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

/**
 * Appends one script and reports how it ended.
 *
 * `async = false` puts a dynamically inserted script into the document's ordered queue: the browser
 * downloads it at once but runs it after every earlier script inserted the same way. That is what
 * lets {@link loadScripts} hand the whole runtime to the browser in one go — twenty downloads in
 * flight together — while each still sees the globals of the ones before it.
 */
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

        el.async = false;
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
 * Loads scripts in order, downloading them all at once.
 *
 * The result is the first failure in document order, or ok. Everything is appended before anything
 * is awaited; the loading each waited on the last before, and the runtime took a round trip per file.
 */
async function loadScripts(files: string[]): Promise<{ file: string; load: ScriptLoad } | null> {
    const loads = files.map((file) => ({ file, promise: loadScript(clientUrl(file)) }));

    for (const { file, promise } of loads) {
        const load = await promise;

        if (load.status !== 'ok') {
            return { file, load };
        }
    }

    return null;
}

/**
 * Starts the client download without running it.
 *
 * The client is the largest thing boot fetches and the last thing it needs, so the download is
 * started first and the file is in the cache by the time {@link loadScript} asks for it. A preload
 * rather than a fetch(), so the browser matches it to the script tag later without a second request.
 */
function preloadScript(src: string): void {
    const url = new URL(src, window.location.href).href;
    const existing = [...document.querySelectorAll('link[rel="preload"]')].some(
        (link) => (link as HTMLLinkElement).href === url,
    );

    if (existing || alreadyLoaded(src)) {
        return;
    }

    const link = document.createElement('link');

    link.rel = 'preload';
    link.as = 'script';
    link.href = src;
    document.head.appendChild(link);
}

/**
 * The host `jav_config.ws` names, or the reason it could not be read.
 *
 * Remembers the last good answer so a slow config server holds boot up by at most
 * {@link JAV_CONFIG_SOFT_TIMEOUT_MS} on a repeat visit. Keyed by config URL, so pointing a dev
 * build at a different config does not replay a host from the live one.
 */
async function resolveCodebaseHost(url: string): Promise<{ host: string | null; reason: string }> {
    const memoryKey = `${JAV_CONFIG_MEMORY_KEY}:${url}`;
    let remembered: string | null = null;

    try {
        remembered = window.localStorage.getItem(memoryKey);
    } catch {
        // Storage can be unavailable (private mode, blocked); the fetch alone is then the answer.
    }

    const fetched = (async () => {
        const host = hostFromCodebase(await loadJavConfig(url));

        if (!host) {
            throw new Error('no usable codebase');
        }

        try {
            window.localStorage.setItem(memoryKey, host);
        } catch {
            // Not remembered; the next visit fetches as this one did.
        }

        return host;
    })();

    if (remembered) {
        const late = new Promise<null>((resolve) =>
            window.setTimeout(() => resolve(null), JAV_CONFIG_SOFT_TIMEOUT_MS),
        );
        const host = await Promise.race([fetched.catch(() => null), late]);

        if (host === null) {
            // Left running: a late answer still refreshes what is remembered, and a failure is only
            // logged because there is a host to use regardless.
            fetched.catch((e) => console.warn(`[boot] ${url}: ${e instanceof Error ? e.message : e}`));
        }

        return { host: host ?? remembered, reason: '' };
    }

    try {
        return { host: await fetched, reason: '' };
    } catch (e) {
        return { host: null, reason: e instanceof Error ? e.message : String(e) };
    }
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

        // Started before anything else: the download is the longest single wait in boot and needs
        // nothing from the steps below, only to be in the cache when the script tag asks for it.
        const clientScriptUrl = clientUrl('web-client.js');
        preloadScript(clientScriptUrl);

        // Which server to play against comes from jav_config.ws, the same file the desktop launcher
        // reads: `codebase` names the host. Fetched every boot rather than built in, so moving a
        // world is one edit on the server and every client follows. Started now, alongside the
        // runtime download; a query-string host is a tester pointing the client somewhere by hand,
        // and that beats the published configuration, so there is no reason to fetch it at all then.
        const javConfigUrl =
            params.get('javConfig') || import.meta.env.VITE_JAV_CONFIG_URL || DEFAULT_JAV_CONFIG_URL;
        const codebase = params.get('wsHost')
            ? Promise.resolve({ host: null, reason: '' })
            : resolveCodebaseHost(javConfigUrl);

        const runtime = await loadScripts(RUNTIME_SCRIPTS);

        if (runtime && runtime.load.status === 'missing') {
            return fail({
                title: 'Client files are missing',
                message:
                    'Part of the game client failed to load. This usually means the site is ' +
                    'mid-deploy, so refreshing in a moment should fix it.',
                detail: `Failed to load ${CLIENT_BASE}${runtime.file}`,
                retryable: true,
            });
        }

        if (runtime && runtime.load.status === 'threw') {
            return fail({
                title: 'The client stopped unexpectedly',
                message:
                    'A part of the game client failed while starting up. This is a fault on our ' +
                    'side rather than yours — please let us know if it keeps happening.',
                detail: `${CLIENT_BASE}${runtime.file} threw while loading: ${runtime.load.detail}`,
                retryable: true,
            });
        }

        // Before the canvas is attached: a canvas keeps one kind of context for its lifetime, so
        // whether the frame goes to the GPU or to a 2D context is settled here, once.
        easing.set(10, 'Starting renderer');
        const renderer = window.WebGpu.init('game');

        // Needs only the runtime (WebVfs) and none of the server details, so it runs while the
        // config is read and the bridge probed. Opening the cache is a few hundred storage round
        // trips and was the longest local step in boot.
        const cache = window.WebVfs.init().then(() => window.WebVfs.ensureCacheBootstrap());

        // Not fatal: preloadAsset reports its own failure, and the login screen draws without the
        // artwork the same way the desktop client does when the files are missing.
        const artwork = Promise.all(
            LOGIN_ASSETS.map(([name, url]) => window.WebImage.preloadAsset(name, url)),
        );

        await renderer;
        window.WebCanvas.attach('game');
        window.WebInput.attach('game');

        easing.set(12, 'Reading server configuration');

        const { host: codebaseHost, reason } = await codebase;

        if (!params.get('wsHost') && !codebaseHost) {
            // Development runs against a server on this machine, and the published config
            // names a live world it should not be talking to — so a failure there is expected
            // rather than fatal, and the local bridge is the right answer.
            if (!isLocal()) {
                return fail({
                    title: 'Cannot reach the server list',
                    message:
                        'We could not work out which server to connect you to. This is a problem ' +
                        'on our side rather than yours; please try again in a minute.',
                    detail: `${javConfigUrl}: ${reason}`,
                    retryable: true,
                });
            }

            console.warn(`[boot] ${javConfigUrl}: ${reason} — using this host, as this is a local run`);
        }

        // `?wsHost=` is a tester naming the bridge outright, so it is taken as written, and
        // `VITE_BRIDGE_HOST` is the same thing said once for a whole dev run. The published config
        // names the world rather than the bridge, so that one is derived.
        const wsHost =
            params.get('wsHost') ||
            import.meta.env.VITE_BRIDGE_HOST ||
            (codebaseHost && bridgeHost(codebaseHost)) ||
            window.location.hostname ||
            '127.0.0.1';
        // 8091 is the bridge's own port. Behind TLS it is whatever the terminator listens on —
        // 443 for a Cloudflare tunnel, 8443 for a proxy on a Cloudflare-proxied port — so the
        // deploy sets it rather than the client assuming.
        const wsPort =
            params.get('wsPort') || import.meta.env.VITE_BRIDGE_PORT || DEFAULT_BRIDGE_PORT;

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
            worldListUrl: worldListUrl(javConfigUrl, bridgeOrigin, params),
            worldListPrimaryUrl: '',
            // The bridge relays central's list on the origin the client already talks to, which is
            // the way out when central itself cannot be read from the page.
            worldListFallbackProxy: `${bridgeOrigin}/worldlist`,
            jxAccessToken: params.get('jxAccessToken') || '',
            // The page and the client must agree on this: the page lays the login screen out for a
            // phone, the client picks its display mode and client type from it, and a disagreement
            // shows up as a desktop-shaped client inside a phone-shaped page. The page's answer
            // wins because it is the one `?mobile=` can override.
            mobile: isMobileDevice(),
            ...(mobileOsOverride() !== null ? { osFamily: mobileOsOverride() as string } : {}),
        };

        reportConnection({
            host: wsHost,
            port: wsPort,
            secure,
            revision: window.__webConfig.revision,
            source: params.get('wsHost')
                ? 'url override'
                : import.meta.env.VITE_BRIDGE_HOST
                  ? 'site config'
                  : codebaseHost
                    ? 'launcher config'
                    : 'this page',
        });

        easing.set(15, 'Contacting game server');

        // The bridge answers over HTTP but the socket is what the client plays through, and the two
        // are blocked independently — so both are asked, together, and told apart below. The world
        // list is fetched alongside: it is small, and only the client needs it.
        const [bridgeUp, socketUp] = await Promise.all([
            isBridgeReachable(bridgeOrigin),
            isSocketReachable(window.__webConfig.js5WsUrl),
            window.WebHttp.prefetch(window.__webConfig.worldListUrl),
        ]);

        if (!bridgeUp) {
            return fail({
                title: 'The game server is offline',
                message:
                    'We could not reach the game server, so there is nothing to connect to. It may ' +
                    'be restarting, so please try again in a minute.',
                detail: `No response from ${bridgeOrigin}`,
                retryable: true,
            });
        }

        if (!socketUp) {
            return fail({
                title: 'The game server cannot be reached',
                message:
                    'The server is up, but the connection the game plays over could not be opened. ' +
                    'A firewall, VPN or network that blocks WebSockets is the usual cause.',
                detail: `WebSocket to ${window.__webConfig.js5WsUrl} did not open`,
                retryable: true,
            });
        }

        easing.set(40, 'Preparing cache');
        await cache;

        easing.set(58, 'Loading artwork');
        await artwork;

        easing.set(68, 'Downloading client');
        const load = await loadScript(clientScriptUrl);

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
