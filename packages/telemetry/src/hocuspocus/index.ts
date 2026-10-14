/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * Hocuspocus: room telemetry in one call. It adds one extension that runs before all others
 * and times each load and store from the first hook to the last, and it observes your hooks
 * and the extensions you pass in `extensions`, so a refusal any of them throws is counted.
 *
 * @packageDocumentation
 */
import type {
  Extension,
  ServerConfiguration,
  afterLoadDocumentPayload,
  afterStoreDocumentPayload,
  afterUnloadDocumentPayload,
  connectedPayload,
  onDisconnectPayload,
  onLoadDocumentPayload,
  onRequestPayload,
  onStoreDocumentPayload,
} from '@hocuspocus/server';
import { timingSafeEqual } from 'node:crypto';
import {
  metricsHandler,
  type MetricsHandlerOptions,
  type PrometheusTextSource,
} from '../prometheus/index.ts';
import {
  roomTelemetry,
  type RoomHandle,
  type RoomTelemetry,
  type RoomTelemetryOptions,
  type SettleOperation,
} from '../server/index.ts';

export {
  hmacRoomLabel,
  type AwarenessLike,
  type RoomHandle,
  type RoomOperation,
  type RoomStats,
  type SettleOperation,
  type RoomTelemetry,
  type RoomTelemetryOptions,
} from '../server/index.ts';
export type { TelemetryExporter, TelemetryPipelineOptions } from '../pipeline.ts';
export type { MetricsHandlerOptions, PrometheusTextSource } from '../prometheus/index.ts';

/** Options for {@link serveMetrics}. @public */
export interface ServeMetricsOptions extends MetricsHandlerOptions {
  /** The path Prometheus scrapes. Defaults to `/metrics`. */
  readonly path?: string;
  /**
   * Also serve `rooms.list()` as JSON at this path. It lists every room, so `authorize` is
   * required with it.
   */
  readonly rooms?: { readonly telemetry: RoomTelemetry; readonly path: string };
  /**
   * Return false to answer 403. Use {@link requireBearerToken} for a shared scrape token.
   * Applies to both paths.
   */
  readonly authorize?: (request: onRequestPayload['request']) => boolean;
  /** Your own `onRequest`, called for every request this hook does not answer. */
  readonly next?: (payload: onRequestPayload) => Promise<unknown>;
  /**
   * Sample this room telemetry before a scrape, for a server that sets `sampleInterval: false`.
   * At most one sample is taken every 5 seconds, so several scrapers do not add extra samples.
   */
  readonly sampleBeforeScrape?: RoomTelemetry;
}

/**
 * An `authorize` check for a shared token, sent as `Authorization: Bearer <token>`. The
 * comparison takes the same time whatever the token, and an empty secret throws at startup
 * rather than letting every request in.
 *
 * @example
 * ```ts
 * serveMetrics(metrics, { authorize: requireBearerToken(process.env.METRICS_TOKEN) });
 * ```
 *
 * @public
 */
export function requireBearerToken(
  secret: string | undefined
): (request: onRequestPayload['request']) => boolean {
  if (typeof secret !== 'string' || secret.length === 0)
    throw new TypeError('requireBearerToken needs a non-empty secret, such as METRICS_TOKEN.');
  const expected = Buffer.from(`Bearer ${secret}`);
  return (request) => {
    const header = request.headers?.authorization;
    const given = Buffer.from(typeof header === 'string' ? header : '');
    return given.length === expected.length && timingSafeEqual(given, expected);
  };
}

/**
 * An `onRequest` hook that serves Prometheus metrics from the Hocuspocus HTTP server itself,
 * for a deployment without a separate web framework. Other requests fall through to the
 * default handler.
 *
 * @example
 * ```ts
 * new Server({
 *   ...config,
 *   onRequest: serveMetrics(metrics, {
 *     rooms: { telemetry: rooms, path: '/rooms' },
 *     authorize: requireBearerToken(process.env.METRICS_TOKEN),
 *   }),
 * });
 * ```
 *
 * @public
 */
export function serveMetrics(
  registry: PrometheusTextSource,
  options: ServeMetricsOptions = {}
): (payload: onRequestPayload) => Promise<void> {
  if (options.rooms && !options.authorize)
    throw new TypeError('serveMetrics needs authorize when it serves rooms: the list is private.');
  const path = options.path ?? '/metrics';
  const handler = metricsHandler(registry, options.merge ? { merge: options.merge } : {});
  let lastSample = 0;
  return async ({ request, response }) => {
    const url = (request.url ?? '').split('?')[0];
    const roomsPath = options.rooms?.path;
    if (url !== path && url !== roomsPath) {
      await options.next?.({ request, response } as onRequestPayload);
      return;
    }
    if (options.authorize && !allows(options.authorize, request)) {
      response.writeHead(403);
      response.end();
    } else if (url === path) {
      // Two scrapers (a high-availability pair) must not double the room samples.
      if (options.sampleBeforeScrape && Date.now() - lastSample >= 5_000) {
        lastSample = Date.now();
        options.sampleBeforeScrape.sample();
      }
      await handler(request, response);
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(options.rooms!.telemetry.list()));
    }
    // Hocuspocus stops at a hook that rejects with no error, so the default reply is skipped.
    throw null;
  };
}

/** What {@link withCollaborationTelemetry} returns. @public */
export interface CollaborationTelemetry<C> {
  /** Your configuration with observed hooks. Pass it to `new Server(config)`. */
  readonly config: C;
  /** The room telemetry, for `list()`, `sample()`, and `shutdown()`. */
  readonly rooms: RoomTelemetry;
}

/**
 * Add room telemetry to a Hocuspocus configuration.
 *
 * It records rooms, connections, the people in each room (from awareness), room memory and
 * size, load and store times, and why connections and messages were refused. Your hooks and
 * your `extensions` run exactly as before, with the same arguments, return values, and `this`;
 * their errors are rethrown. Extensions added later with `server.configure` are not observed.
 * Requires `@hocuspocus/server` 4.6 or later.
 *
 * @example
 * ```ts
 * import { Server } from '@hocuspocus/server';
 * import { withCollaborationTelemetry } from '@docx-editor.dev/telemetry/hocuspocus';
 * import { prometheusRegistry, metricsHandler } from '@docx-editor.dev/telemetry/prometheus';
 *
 * const metrics = prometheusRegistry();
 * const { config, rooms } = withCollaborationTelemetry(
 *   { port: 1234, onAuthenticate, extensions: [new Database({ fetch, store })] },
 *   { exporters: [metrics] }
 * );
 * const server = new Server(config); // telemetry flushes when the server is destroyed
 *
 * app.get('/metrics', metricsHandler(metrics));
 * ```
 *
 * @public
 */
export function withCollaborationTelemetry<C extends Partial<ServerConfiguration>>(
  config: C,
  options: RoomTelemetryOptions
): CollaborationTelemetry<C> {
  const rooms = roomTelemetry(options);
  const open = new Map<string, RoomHandle>();
  const loads = new Map<string, SettleOperation>();
  /** How many afterLoadDocument hooks finished for each loading document. */
  const afterLoadDone = new Map<string, number>();
  const hasAfterLoad = (hooks: object) =>
    typeof (hooks as { afterLoadDocument?: unknown }).afterLoadDocument === 'function';
  /** Ours, every given extension with the hook, and the configuration's own hook. */
  const afterLoadHooks =
    1 +
    (config.extensions ?? []).filter((extension) => hasAfterLoad(extension)).length +
    (hasAfterLoad(config) ? 1 : 0);
  const afterLoadFinished = (name: string) => {
    const done = (afterLoadDone.get(name) ?? 0) + 1;
    afterLoadDone.set(name, done);
    if (done < afterLoadHooks) return;
    afterLoadDone.delete(name);
    settle(loads, name, 'success');
  };
  /** The same count for stores: a store succeeds when its whole afterStoreDocument chain did. */
  const afterStoreDone = new Map<string, number>();
  const hasAfterStore = (hooks: object) =>
    typeof (hooks as { afterStoreDocument?: unknown }).afterStoreDocument === 'function';
  const afterStoreHooks =
    1 +
    (config.extensions ?? []).filter((extension) => hasAfterStore(extension)).length +
    (hasAfterStore(config) ? 1 : 0);
  const afterStoreFinished = (name: string) => {
    const done = (afterStoreDone.get(name) ?? 0) + 1;
    afterStoreDone.set(name, done);
    if (done < afterStoreHooks) return;
    afterStoreDone.delete(name);
    settle(stores, name, 'success');
  };
  const afterLoadFailed = (name: string) => {
    afterLoadDone.delete(name);
    settle(loads, name, 'failure');
    open.get(name)?.close();
    open.delete(name);
  };
  const stores = new Map<string, SettleOperation>();
  /**
   * Connections counted as connected, so a refused connection is never subtracted. One
   * websocket can carry several rooms, and several sessions of one room, so each socket in a
   * room keeps a count.
   */
  const sockets = new Map<string, { readonly room: RoomHandle; count: number }>();
  const connection = (socketId: string, documentName: string) => `${socketId}\u0000${documentName}`;
  const settle = (
    pending: Map<string, SettleOperation>,
    name: string,
    outcome: 'success' | 'failure'
  ) => {
    pending.get(name)?.(outcome);
    pending.delete(name);
  };

  /** Runs before every other extension and after the chain completes, so it times all of it. */
  const timing: Extension = {
    extensionName: 'docx-editor-telemetry',
    priority: Number.MAX_SAFE_INTEGER,
    async onLoadDocument({ documentName }: onLoadDocumentPayload) {
      // A load that never finished its afterLoadDocument chain failed inside Hocuspocus.
      settle(loads, documentName, 'failure');
      loads.set(documentName, rooms.begin('load'));
    },
    // The room opens at once, so a direct connection and the first client's initial sync are
    // counted. The load succeeds when every afterLoadDocument hook has finished; if a later one
    // throws, Hocuspocus discards the document, and the room closes again.
    async afterLoadDocument({ documentName, document }: afterLoadDocumentPayload) {
      open.get(documentName)?.close();
      open.set(
        documentName,
        rooms.open(document, { name: documentName, awareness: document.awareness })
      );
      afterLoadDone.set(documentName, 0);
      afterLoadFinished(documentName);
    },
    async onStoreDocument({ documentName }: onStoreDocumentPayload) {
      // A store left unsettled ended in a hook this wrapper does not observe, perhaps on
      // purpose: its outcome is unknown, so it is dropped rather than guessed.
      stores.delete(documentName);
      afterStoreDone.delete(documentName);
      const room = open.get(documentName);
      stores.set(documentName, room ? room.begin('store') : rooms.begin('store'));
    },
    async afterStoreDocument({ documentName }: afterStoreDocumentPayload) {
      afterStoreDone.set(documentName, 0);
      afterStoreFinished(documentName);
    },
    async connected({ documentName, socketId }: connectedPayload) {
      const room = open.get(documentName);
      const key = connection(socketId, documentName);
      if (!room) return;
      const counted = sockets.get(key);
      if (counted) counted.count += 1;
      else sockets.set(key, { room, count: 1 });
      room.connected();
    },
    async onDisconnect({ documentName, socketId }: onDisconnectPayload) {
      const key = connection(socketId, documentName);
      const counted = sockets.get(key);
      if (!counted) return;
      counted.room.disconnected();
      counted.count -= 1;
      if (counted.count === 0) sockets.delete(key);
    },
    async afterUnloadDocument({ documentName }: afterUnloadDocumentPayload) {
      afterLoadDone.delete(documentName);
      afterStoreDone.delete(documentName);
      settle(loads, documentName, 'failure');
      stores.delete(documentName);
      open.get(documentName)?.close();
      open.delete(documentName);
    },
    // Hocuspocus stops on SIGINT and SIGTERM by default and exits after `onDestroy`: flush here,
    // inside its shutdown, rather than racing it from another signal handler.
    async onDestroy() {
      await rooms.shutdown();
    },
  };

  /** Wraps the hooks that can refuse, so the refusal is counted before it propagates. */
  const observing = <T extends object>(hooks: T): Partial<Record<RefusalHook, unknown>> => {
    const source = hooks as Partial<Record<RefusalHook, (payload: never) => unknown>>;
    const wrapped: Partial<Record<RefusalHook, unknown>> = {};
    const guard = (
      hook: RefusalHook,
      onError: (error: unknown, payload: { documentName?: string }) => void,
      onSuccess?: (payload: { documentName?: string }) => void
    ) => {
      const original = source[hook];
      if (typeof original !== 'function') return;
      wrapped[hook] = async (payload: { documentName?: string }) => {
        let result: unknown;
        try {
          result = await original.call(hooks, payload as never);
        } catch (error) {
          onError(error, payload);
          throw error;
        }
        onSuccess?.(payload);
        return result;
      };
    };
    guard('onConnect', (error) => rooms.rejected(error));
    guard('onAuthenticate', (error) => rooms.rejected(error));
    guard('onTokenSync', (error) => rooms.rejected(error));
    guard('beforeHandleMessage', (error) => rooms.refused(error));
    guard('onLoadDocument', (_error, { documentName }) =>
      settle(loads, documentName ?? '', 'failure')
    );
    guard(
      'afterLoadDocument',
      // Even a skip fails the load here: Hocuspocus does not catch one after a load, so the
      // document never opens.
      (_error, { documentName }) => afterLoadFailed(documentName ?? ''),
      ({ documentName }) => afterLoadFinished(documentName ?? '')
    );
    guard(
      'afterStoreDocument',
      (error, { documentName }) => {
        afterStoreDone.delete(documentName ?? '');
        // Hocuspocus treats a skip after a store as a finished store.
        settle(stores, documentName ?? '', isSkip(error) ? 'success' : 'failure');
      },
      ({ documentName }) => afterStoreFinished(documentName ?? '')
    );
    guard('onStoreDocument', (error, { documentName }) => {
      // The Redis extension skips here when another instance holds the store lock: this
      // instance did not store the room. The store is neither timed nor counted, and the
      // pending updates stay pending.
      if (isSkip(error)) stores.delete(documentName ?? '');
      else settle(stores, documentName ?? '', 'failure');
    });
    return wrapped;
  };

  // Extensions are often class instances that keep state on `this`. A proxy answers the guarded
  // hooks and hands everything else to the extension itself, bound to it, so every hook still
  // reads and writes the same object.
  const wrappedConfig = observing(config) as Record<string, unknown>;
  const extensions = (config.extensions ?? []).map((extension) => {
    const guarded = observing(extension) as Record<string | symbol, unknown>;
    // Use an empty target so frozen methods and accessors impose no proxy invariants.
    // Every property still reads the original extension, including private instance state.
    return new Proxy(Object.create(Object.getPrototypeOf(extension)) as Extension, {
      get(_target, property) {
        if (Object.hasOwn(guarded, property)) return guarded[property];
        const value = Reflect.get(extension, property, extension);
        // Bind methods so `this` is the extension; `constructor` stays itself for its name.
        return typeof value === 'function' && property !== 'constructor'
          ? value.bind(extension)
          : value;
      },
      set(_target, property, value) {
        return Reflect.set(extension, property, value, extension);
      },
      has: (_target, property) => Reflect.has(extension, property),
      ownKeys: () => Reflect.ownKeys(extension),
      getOwnPropertyDescriptor(_target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(extension, property);
        return descriptor ? { ...descriptor, configurable: true } : undefined;
      },
    });
  });
  return {
    config: { ...config, ...wrappedConfig, extensions: [timing, ...extensions] },
    rooms,
  };
}

type RefusalHook =
  | 'onConnect'
  | 'onAuthenticate'
  | 'beforeHandleMessage'
  | 'onTokenSync'
  | 'onLoadDocument'
  | 'afterLoadDocument'
  | 'onStoreDocument'
  | 'afterStoreDocument';

/** A host `authorize` that throws refuses the request rather than the process. */
function allows(
  authorize: (request: onRequestPayload['request']) => boolean,
  request: onRequestPayload['request']
): boolean {
  try {
    return authorize(request) === true;
  } catch {
    return false;
  }
}

function isSkip(error: unknown): boolean {
  // `SkipFurtherHooksError` sets its own `name`, which a minifier does not rename.
  return (error as { name?: unknown } | null)?.name === 'SkipFurtherHooksError';
}
