# Fluxious Web Client

The browser client, served on its own subdomain. One page, one canvas: the TeaVM build of the game
client, the loading and login screens the browser needs (the client draws neither for itself), and
the RuneLite-style plugin layer.

There is no server side. The page is static HTML that boots a canvas, and from there the client
talks to the game server over its own WebSocket — so this deploys as files on a CDN, with no
runtime, no database and no session.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The page. Loads one module and gets out of the way |
| `resources/js/Client.vue` | Canvas, loading screen, login screen, plugin sidebar |
| `resources/js/lib/game/` | Boot sequence and the bridges the client's runtime scripts report through |
| `resources/js/components/game/` | Loading, login, error and plugin-sidebar components |
| `resources/js/plugins/` | The plugin layer: runtime, config, overlays, and the plugins themselves |
| `resources/js/plugins/api/` | **Generated.** `net.runelite.api` as TypeScript; see below |
| `public/client/` | **Generated.** The TeaVM client and its runtime scripts, copied to the build verbatim |
| `public/assets/` | Fonts and artwork the client and its plugins load by URL |

Both generated directories come from the client repo (`FluxRSClient`) and are checked in, so a
deploy needs no Java toolchain:

```
cd ../FluxRSClient
./gradlew :web:web-client:deployWebClient   # -> public/client/
./gradlew :web:web-client:deployApiTypes    # -> resources/js/plugins/api/
```

## Running it

```
npm install
cp .env.example .env
npm run dev       # http://localhost:5173
npm run build     # -> dist/
npm run preview   # serves dist/ as it will be served in production
```

## Where the game server is

Read from `jav_config.ws` at boot — the same file the desktop launcher reads. `codebase` names the
host, so moving a world is one edit on the server and every client follows on its next start,
browser and desktop alike. The port is always 8091.

Only the hostname is taken from `codebase`. It is written for the launcher and says `http://`, which
a page served over HTTPS may not fetch at all, so the scheme is decided from the page instead.

The browser does not connect to that host directly. `codebase` names the world as the desktop client
reaches it — a raw game port on a DNS-only record — while the browser needs the bridge over TLS,
which is a record of its own. So the first label gets a `-proxy` suffix: `world1.fluxious-rsps.com`
in the config becomes `world1-proxy.fluxious-rsps.com` in the browser. Every world therefore needs
both records. Address literals and single-label names are left alone, so a bridge on the local
network still works without one.

Two build-time settings, both optional, in `.env` locally and project environment variables on
Vercel:

| Variable | Empty means |
|---|---|
| `VITE_JAV_CONFIG_URL` | `https://central.fluxious-rsps.com/jav_config.ws` |
| `VITE_GAME_WS_SECURE` | Follow the page: HTTPS uses `wss`, HTTP uses `ws` |

**The config host must send `Access-Control-Allow-Origin`.** The page fetches it from the site's own
origin, so without that header the browser blocks the read and the client has no server to connect
to. On Cloudflare that is a Transform Rule adding the header for `/jav_config.ws`.

The bridge host itself has to serve TLS for the same reason: a page on `https://` may not open a
`ws://` socket or fetch the cache over `http://`. Note also that Cloudflare's proxy only carries
443, 2053, 2083, 2087, 2096 and 8443 — 8091 has to be DNS-only with its own certificate.

For testing, `?wsHost=` skips the config lookup entirely and `?wsPort=` overrides the port; running
on localhost also falls back to the local bridge when the config cannot be read, so development
against a server on this machine needs no flags.

## Deploying to Vercel

`vercel.json` is the whole of it: `npm run build`, publish `dist/`, and cache `/client` and
`/assets` rather than re-fetching the client on every visit. Import the repository and it needs no
further settings beyond the variables above.

The build ships ~16 MB, most of it `public/client/web-client.js`. That is within Vercel's limits but
worth knowing when reading a build log.

## Plugins

Plugins are TypeScript, written against the same API and events as their desktop originals:

```ts
export const examplePlugin: FluxPlugin = {
    descriptor: { name: 'Example', description: '…', tags: [], enabledByDefault: false },

    startUp(context) {
        context.subscribe('ChatMessage', (event) => console.log(event.getMessage()));
        console.log(context.client.getLocalPlayer()?.getName());
    },
};
```

Register it in `resources/js/plugins/index.ts`. `context.client` and the event names are generated
from `net.runelite.api`, so both are complete and neither can drift from the client.
