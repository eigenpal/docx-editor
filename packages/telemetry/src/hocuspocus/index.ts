/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * Hocuspocus: room telemetry in one call. The wrapper times your hooks and reads why they
 * refused, which a separate extension cannot see: your own `onAuthenticate`,
 * `beforeHandleMessage`, and `onLoadDocument` throw the error, and Hocuspocus stops there.
 *
 * @packageDocumentation
 */
import type {
  Extension,
  ServerConfiguration,
  afterUnloadDocumentPayload,
  beforeHandleMessagePayload,
  connectedPayload,
  onAuthenticatePayload,
  onDisconnectPayload,
  onLoadDocumentPayload,
  onRequestPayload,
  onStoreDocumentPayload,
} from '@hocuspocus/server';
import { metricsHandler, type PrometheusTextSource } from '../prometheus/index.ts';
import {
  roomTelemetry,
  type RoomHandle,
  type RoomTelemetry,
  type RoomTelemetryOptions,
} from '../server/index.ts';

export {
  hmacRoomLabel,
  type AwarenessLike,
  type RoomHandle,
  type RoomOperation,
  type RoomStats,
  type RoomTelemetry,
  type RoomTelemetryOptions,
} from '../server/index.ts';
export type { TelemetryExporter, TelemetryPipelineOptions } from '../pipeline.ts';
export type { PrometheusTextSource } from '../prometheus/index.ts';

/** The hooks the wrapper observes. Every other configuration key passes through unchanged. @public */
export type ObservedHocuspocusHooks = Pick<
  Extension,
  | 'onAuthenticate'
  | 'onLoadDocument'
  | 'connected'
  | 'beforeHandleMessage'
  | 'onStoreDocument'
  | 'onDisconnect'
  | 'afterUnloadDocument'
>;

/** Options for {@link serveMetrics}. @public */
export interface ServeMetricsOptions {
  /** The path Prometheus scrapes. Defaults to `/metrics`. */
  readonly path?: string;
  /** Also serve `rooms.list()` as JSON at this path. Protect it: it lists every room. */
  readonly rooms?: { readonly telemetry: RoomTelemetry; readonly path: string };
  /** Return false to answer 403, for example to accept only your scraper's address. */
  readonly authorize?: (request: onRequestPayload['request']) => boolean;
  /**
   * Sample people and memory before each scrape. Defaults to `false`, because the room
   * telemetry also samples on its own interval. Turn it on together with
   * `sampleInterval: false`, so each scrape samples exactly once.
   */
  readonly sampleBeforeScrape?: boolean;
}

/**
 * An `onRequest` hook that serves Prometheus metrics from the Hocuspocus HTTP server itself,
 * for a deployment without a separate web framework. Other requests fall through to the
 * default handler.
 *
 * @example
 * ```ts
 * const metrics = prometheusRegistry();
 * const { config, rooms } = withCollaborationTelemetry({ ... }, { exporters: [metrics] });
 * new Server({ ...config, onRequest: serveMetrics(metrics, { rooms: { telemetry: rooms, path: '/rooms' } }) });
 * ```
 *
 * @public
 */
export function serveMetrics(
  registry: PrometheusTextSource,
  options: ServeMetricsOptions = {}
): (payload: onRequestPayload) => Promise<void> {
  const path = options.path ?? '/metrics';
  const handler = metricsHandler(registry);
  return async ({ request, response }) => {
    const url = (request.url ?? '').split('?')[0];
    const roomsPath = options.rooms?.path;
    if (url !== path && url !== roomsPath) return;
    if (options.authorize && !options.authorize(request)) {
      response.writeHead(403);
      response.end();
    } else if (url === path) {
      if (options.sampleBeforeScrape === true) options.rooms?.telemetry.sample();
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
 * size, load and store times, and why connections and messages were refused. Your hooks run
 * exactly as before, with the same arguments and return values; their errors are rethrown.
 *
 * @example
 * ```ts
 * import { Server } from '@hocuspocus/server';
 * import { withCollaborationTelemetry } from '@docx-editor.dev/telemetry/hocuspocus';
 * import { prometheusRegistry, metricsHandler } from '@docx-editor.dev/telemetry/prometheus';
 *
 * const metrics = prometheusRegistry();
 * const { config, rooms } = withCollaborationTelemetry(
 *   { port: 1234, onAuthenticate, onLoadDocument, onStoreDocument },
 *   { exporters: [metrics] }
 * );
 * const server = new Server(config);
 *
 * app.get('/metrics', metricsHandler(metrics));
 * app.get('/admin/rooms', requireAdmin, (_req, res) => res.json(rooms.list()));
 * process.on('SIGTERM', () => void rooms.shutdown());
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
  /**
   * Connections counted as connected, so a refused connection is never subtracted. One
   * websocket can carry several rooms, so a connection is a socket in a room.
   */
  const sockets = new Map<string, RoomHandle>();
  const connection = (socketId: string, documentName: string) => `${socketId}\u0000${documentName}`;

  const observed: ObservedHocuspocusHooks = {
    async onAuthenticate(payload: onAuthenticatePayload) {
      try {
        return await config.onAuthenticate?.(payload);
      } catch (error) {
        rooms.rejected(error);
        throw error;
      }
    },
    async onLoadDocument(payload: onLoadDocumentPayload) {
      const result = await rooms.time('load', () => config.onLoadDocument?.(payload));
      open.get(payload.documentName)?.close();
      open.set(
        payload.documentName,
        rooms.open(payload.document, {
          name: payload.documentName,
          awareness: payload.document.awareness,
        })
      );
      return result;
    },
    async connected(payload: connectedPayload) {
      const room = open.get(payload.documentName);
      const key = connection(payload.socketId, payload.documentName);
      if (room && !sockets.has(key)) {
        sockets.set(key, room);
        room.connected();
      }
      return config.connected?.(payload);
    },
    async beforeHandleMessage(payload: beforeHandleMessagePayload) {
      try {
        return await config.beforeHandleMessage?.(payload);
      } catch (error) {
        rooms.refused(error);
        throw error;
      }
    },
    async onStoreDocument(payload: onStoreDocumentPayload) {
      const run = () => config.onStoreDocument?.(payload);
      const room = open.get(payload.documentName);
      return room ? room.time('store', run) : rooms.time('store', run);
    },
    async onDisconnect(payload: onDisconnectPayload) {
      const key = connection(payload.socketId, payload.documentName);
      sockets.get(key)?.disconnected();
      sockets.delete(key);
      return config.onDisconnect?.(payload);
    },
    async afterUnloadDocument(payload: afterUnloadDocumentPayload) {
      open.get(payload.documentName)?.close();
      open.delete(payload.documentName);
      return config.afterUnloadDocument?.(payload);
    },
  };

  return { config: { ...config, ...observed }, rooms };
}
