/**
 * The launcher configuration, `jav_config.ws`.
 *
 * The desktop launcher reads this to find the gamepack; the browser client reads it to find the
 * server. `codebase` is the authority on which host to play against, so it is fetched at boot
 * rather than baked into the build — moving a world means editing one file on the server, and every
 * client, desktop or browser, follows on its next start.
 *
 * The format is one `key=value` per line, `#` comments, and repeated `msg=` lines for launcher
 * strings the browser has no use for.
 */

/** Where the config lives, unless the build or the query string says otherwise. */
export const DEFAULT_JAV_CONFIG_URL = 'https://central.fluxious-rsps.com/jav_config.ws';

export type JavConfig = Record<string, string>;

export function parseJavConfig(text: string): JavConfig {
    const config: JavConfig = {};

    for (const line of text.split('\n')) {
        const trimmed = line.trim();

        if (trimmed === '' || trimmed.startsWith('#')) {
            continue;
        }

        const split = trimmed.indexOf('=');

        if (split <= 0) {
            continue;
        }

        const key = trimmed.slice(0, split);

        // `msg=` repeats for every launcher string, each with its own `name=value` inside it. None
        // of them mean anything here, and keeping them would leave one arbitrary winner under a
        // key that looks meaningful.
        if (key === 'msg') {
            continue;
        }

        config[key] = trimmed.slice(split + 1);
    }

    return config;
}

/**
 * Fetches and parses the config.
 *
 * Throws rather than returning a default, because there is no sensible default: without `codebase`
 * the client does not know which server it is for, and guessing would connect a player to the wrong
 * one — or, more likely, to nothing at all with a confusing error.
 */
export async function loadJavConfig(url: string, timeoutMs = 8000): Promise<JavConfig> {
    const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
        throw new Error(`${url} answered ${response.status}`);
    }

    return parseJavConfig(await response.text());
}

/**
 * The host to play against, from `codebase`.
 *
 * Only the hostname is taken. `codebase` is written for the desktop launcher and normally says
 * `http://`, which a page served over HTTPS may not fetch at all; the scheme is the browser's
 * business and is decided from the page instead.
 */
export function hostFromCodebase(config: JavConfig): string | null {
    const codebase = config.codebase;

    if (!codebase) {
        return null;
    }

    try {
        return new URL(codebase).hostname || null;
    } catch {
        // Some configs give a bare host rather than a URL; take it as written.
        return codebase.replace(/^\w+:\/\//, '').replace(/[/:].*$/, '') || null;
    }
}
