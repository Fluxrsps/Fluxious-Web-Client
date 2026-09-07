/**
 * The client, as plugin code sees it.
 *
 * Almost the only hand-written line of the API: every method on it is generated from
 * `net.runelite.api.Client`, so a port reads the way its original does —
 *
 * ```ts
 * const player = client.getLocalPlayer();
 * const logout = client.getWidget(InterfaceID.ToplevelPreEoc.ICON10);
 * ```
 *
 * Safe to use before the client has booted. Every call goes through the bridge, which answers with
 * a zero value while it is missing, so a plugin reading on its first frame sees 0 or null rather
 * than throwing.
 */
import { Client } from './Client';
import { clientHandle } from './runtime';

export const client = new Client(clientHandle());

export { apiReady } from './runtime';
