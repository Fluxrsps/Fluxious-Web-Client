/**
 * `@Subscribe`, for plugins that are TypeScript rather than Java.
 *
 * A desktop plugin annotates a method with the event type it wants and the EventBus finds it by
 * reflection. There is no reflection here, so a plugin asks by name:
 *
 * ```ts
 * context.subscribe('ChatMessage', (event) => console.log(event.getMessage()));
 * ```
 *
 * The name is checked against the generated event map, and the handler's argument is typed for it,
 * so this is as close to the annotation as the language gets.
 *
 * Events cost nothing until somebody wants them. The client is told which ids have subscribers and
 * drops the rest before building a handle — ClientTick and MenuEntryAdded fire constantly, and on
 * desktop an unsubscribed event is a map lookup rather than work.
 */
import { EVENT_CLASSES, EVENT_IDS, type FluxEventMap, type FluxEventName } from './api/events';
import { ApiObject, apiReady, setSubscribed } from './api/runtime';

type Handler = (event: never) => void;

const handlers = new Map<number, Set<Handler>>();

/**
 * Ids whose state the client has not been told about yet.
 *
 * Plugins start before the client finishes booting, so the first subscriptions are made with no
 * bridge to publish them to. They are held here and flushed once there is one.
 */
const pending = new Set<number>();
let flushTimer: number | undefined;

function publish(id: number, on: boolean): void {
    if (apiReady()) {
        setSubscribed(id, on);

        return;
    }

    pending.add(id);

    if (flushTimer !== undefined) {
        return;
    }

    flushTimer = window.setInterval(() => {
        if (!apiReady()) {
            return;
        }

        for (const id of pending) {
            setSubscribed(id, (handlers.get(id)?.size ?? 0) > 0);
        }

        pending.clear();
        window.clearInterval(flushTimer);
        flushTimer = undefined;
    }, 250);
}

/**
 * Registers a handler and returns the function that removes it.
 *
 * Plugins do not normally call this directly: `PluginContext.subscribe` wraps it and drops the
 * subscription when the plugin is switched off, which is what the desktop lifecycle does.
 */
export function subscribe<K extends FluxEventName>(
    name: K,
    handler: (event: FluxEventMap[K]) => void,
): () => void {
    const id = EVENT_IDS[name];

    if (id === undefined) {
        console.warn(`[plugins] no such event: ${name}`);

        return () => undefined;
    }

    let set = handlers.get(id);

    if (!set) {
        set = new Set();
        handlers.set(id, set);
    }

    const wasEmpty = set.size === 0;
    set.add(handler as Handler);

    if (wasEmpty) {
        publish(id, true);
    }

    return () => {
        set.delete(handler as Handler);

        if (set.size === 0) {
            publish(id, false);
        }
    };
}

/**
 * Delivers one posted event.
 *
 * The handle is the event object on the client, and it is dropped the moment this returns — the
 * client releases it as soon as the post is done. A handler that stores the event rather than
 * reading it during the call is left holding a wrapper that reads nothing, which is the one place
 * this differs from desktop, where the event is an ordinary object with an ordinary lifetime.
 */
export function dispatchEvent(id: number, handle: number): void {
    const set = handlers.get(id);

    if (!set || set.size === 0) {
        return;
    }

    const type = EVENT_CLASSES[id] ?? ApiObject;
    const event = new type(handle);

    for (const handler of set) {
        try {
            (handler as (event: ApiObject) => void)(event);
        } catch (e) {
            // One bad handler must not cost the others their event, nor the client its frame.
            console.error('[plugins] event handler threw', e);
        }
    }
}
