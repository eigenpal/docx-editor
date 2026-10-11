/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * Room telemetry for any Yjs collaboration server: rooms, connections, the people in each
 * room, the memory each room holds, and why connections and messages were refused.
 *
 * No metric carries a room name. Per-room detail is in {@link RoomTelemetry.list}, for an
 * admin endpoint you protect.
 *
 * @packageDocumentation
 */
import { createHmac } from 'node:crypto';
import { readCollaborationResourceUsage } from '@docx-editor.dev/pro/collaboration';
import { isCollaborationFailureCode } from '@docx-editor.dev/core/collaboration';
import * as Y from 'yjs';
import { METRICS } from '../metrics.ts';
import { createPipeline, type TelemetryPipelineOptions } from '../pipeline.ts';

/** The part of a `y-protocols` `Awareness` the telemetry reads. @public */
export interface AwarenessLike {
  getStates(): Map<number, unknown>;
  on(event: 'change', listener: (...args: unknown[]) => void): void;
  off(event: 'change', listener: (...args: unknown[]) => void): void;
}

/** Options for {@link roomTelemetry}. @public */
export interface RoomTelemetryOptions extends TelemetryPipelineOptions {
  /**
   * How often to sample people, memory, and room size, in milliseconds. Defaults to 60 000.
   * `false` turns the timer off; call `sample()` yourself, for example before each scrape.
   */
  readonly sampleInterval?: number | false;
  /**
   * Measure each room's encoded Yjs state. This encodes the room once per sample, and only when
   * it changed since the last one. Defaults to `true`.
   */
  readonly measureState?: boolean;
  /**
   * How a room appears in {@link RoomTelemetry.list}. Defaults to an index that is valid only
   * inside this process, such as `room-3`. Use `(name) => name` to see real names, or
   * {@link hmacRoomLabel} for a stable label that does not reveal the name.
   */
  readonly roomLabel?: (name: string) => string;
  /**
   * Refusal reasons to keep as metric labels. Collaboration failure codes are always kept.
   * Any other reason is counted as `other`, so a free-text error never becomes a time series.
   */
  readonly reasons?: readonly string[];
}

/** One room in {@link RoomTelemetry.list}. @public */
export interface RoomStats {
  readonly room: string;
  /** People present, from awareness states. A person with two tabs counts twice. */
  readonly participants: number;
  readonly connections: number;
  /** Encoded Yjs state at the last sample, or `null` before the first one. */
  readonly stateBytes: number | null;
  readonly blobBytes: number | null;
  /** Bytes of updates applied since the room was last stored. */
  readonly pendingBytes: number;
  readonly nodes: number | null;
  /** The largest share of any room limit in use, from 0 to 1. */
  readonly limitRatio: number | null;
  readonly ageSeconds: number;
  readonly idleSeconds: number;
}

/** What a timed room operation is. @public */
export type RoomOperation = 'load' | 'store';

/** One open room. Returned by {@link RoomTelemetry.open}. @public */
export interface RoomHandle {
  /** The room's label, as {@link RoomTelemetryOptions.roomLabel} made it. */
  readonly label: string;
  /** Run `operation` and record its duration and outcome. Rethrows its error. */
  time<T>(operation: RoomOperation, run: () => T | Promise<T>): Promise<T>;
  connected(): void;
  disconnected(): void;
  /** Stop tracking the room, for example when the server unloads it. */
  close(): void;
}

/** Room telemetry for one server process. @public */
export interface RoomTelemetry {
  /**
   * Start tracking a loaded room. Pass the room's awareness to count people; without it the
   * number of connections stands in.
   */
  open(
    doc: Y.Doc,
    options?: { readonly name?: string; readonly awareness?: AwarenessLike }
  ): RoomHandle;
  /** A connection refused at admission. `reason` can be a string or an error with `reason`. */
  rejected(reason: unknown): void;
  /** A message refused before it applied, such as `room-generation-changed`. */
  refused(reason: unknown): void;
  /** A room migration finished. */
  migrated(outcome: 'migrated' | 'unchanged' | 'failed'): void;
  /** Time an operation that happens before the room is open, such as a load that fails. */
  time<T>(operation: RoomOperation, run: () => T | Promise<T>): Promise<T>;
  /** Every open room, for an admin endpoint you protect. */
  list(): readonly RoomStats[];
  /** Sample people, memory, and size now. */
  sample(): void;
  flush(): Promise<void>;
  /** Stop the timer, close every room, and shut the exporters down. */
  shutdown(): Promise<void>;
}

/**
 * A stable room label that does not reveal the name: an HMAC of the name with your secret.
 * The same name gives the same label across processes and restarts.
 *
 * @public
 */
export function hmacRoomLabel(secret: string | undefined): (name: string) => string {
  if (typeof secret !== 'string' || secret.length === 0)
    throw new TypeError('hmacRoomLabel needs a non-empty secret, such as an environment variable.');
  return (name) => `room-${createHmac('sha256', secret).update(name).digest('hex').slice(0, 16)}`;
}

/** The refusal reason of a string, or of an error carrying `reason` or `code`. */
export function reasonOf(value: unknown, known: ReadonlySet<string>): string {
  const raw =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object'
        ? ((value as { reason?: unknown }).reason ?? (value as { code?: unknown }).code)
        : undefined;
  if (typeof raw !== 'string') return 'other';
  return known.has(raw) || isCollaborationFailureCode(raw) ? raw : 'other';
}

const COMMON_REASONS = ['unauthorized', 'forbidden', 'unknown-room', 'rate-limited'];

interface Room {
  readonly handle: RoomHandle;
  readonly doc: Y.Doc;
  readonly awareness: AwarenessLike | undefined;
  readonly openedAt: number;
  readonly dispose: () => void;
  lastChange: number;
  connections: number;
  pendingBytes: number;
  changed: boolean;
  stateBytes: number | null;
  blobBytes: number | null;
  nodes: number | null;
  limitRatio: number | null;
}

/**
 * Track rooms on a Yjs server.
 *
 * @example
 * ```ts
 * import { roomTelemetry } from '@docx-editor.dev/telemetry/server';
 * import { prometheusRegistry, metricsHandler } from '@docx-editor.dev/telemetry/prometheus';
 *
 * const metrics = prometheusRegistry();
 * const rooms = roomTelemetry({ exporters: [metrics] });
 *
 * const room = rooms.open(ydoc, { name, awareness });
 * await room.time('load', () => loadRoom(ydoc));
 * room.connected();
 * ```
 *
 * @public
 */
export function roomTelemetry(options: RoomTelemetryOptions): RoomTelemetry {
  const pipeline = createPipeline(options);
  const known = new Set([...COMMON_REASONS, ...(options.reasons ?? [])]);
  const measureState = options.measureState ?? true;
  const rooms = new Set<Room>();
  let next = 0;
  const label = options.roomLabel ?? (() => `room-${(next += 1)}`);
  const now = () => Date.now();

  function totals(): void {
    let connections = 0;
    let participants = 0;
    for (const room of rooms) {
      connections += room.connections;
      participants += participantsOf(room);
    }
    pipeline.metric(METRICS.roomsActive, rooms.size);
    pipeline.metric(METRICS.connectionsActive, connections);
    pipeline.metric(METRICS.participantsActive, participants);
  }

  async function time<T>(
    operation: RoomOperation,
    run: () => T | Promise<T>,
    room?: Room
  ): Promise<T> {
    const metric = operation === 'load' ? METRICS.roomLoadDuration : METRICS.roomStoreDuration;
    const start = globalThis.performance?.now() ?? now();
    // Updates that arrive while the store runs are not in it, so only what was pending clears.
    const pending = room?.pendingBytes ?? 0;
    try {
      const result = await run();
      pipeline.metric(metric, elapsed(start), { outcome: 'success' });
      if (operation === 'store' && room)
        room.pendingBytes = Math.max(0, room.pendingBytes - pending);
      return result;
    } catch (error) {
      pipeline.metric(metric, elapsed(start), { outcome: 'failure' });
      throw error;
    }
  }

  function sampleRoom(room: Room, at: number): void {
    if (room.changed || room.stateBytes === null) {
      room.changed = false;
      if (measureState) room.stateBytes = Y.encodeStateAsUpdate(room.doc).byteLength;
      try {
        const usage = readCollaborationResourceUsage(room.doc);
        room.blobBytes = usage.blobBytes;
        room.nodes = usage.nodes;
        const ratios = {
          nodes: usage.nodes / usage.maxNodes,
          relationships: usage.relationships / usage.maxRelationships,
          parts: usage.parts / usage.maxParts,
          blobBytes: usage.blobBytes / usage.maxBlobBytes,
        };
        room.limitRatio = Math.max(...Object.values(ratios));
        for (const [resource, ratio] of Object.entries(ratios))
          pipeline.metric(METRICS.roomResourceUsage, ratio, { resource });
        pipeline.metric(METRICS.roomNodes, usage.nodes - usage.tombstonedNodes, { state: 'live' });
        pipeline.metric(METRICS.roomNodes, usage.tombstonedNodes, { state: 'tombstoned' });
      } catch {
        // A room that holds no docx-editor document yet has no usage to read.
      }
    }
    pipeline.metric(METRICS.roomParticipants, participantsOf(room));
    if (room.stateBytes !== null)
      pipeline.metric(METRICS.roomMemory, room.stateBytes, { kind: 'state' });
    if (room.blobBytes !== null)
      pipeline.metric(METRICS.roomMemory, room.blobBytes, { kind: 'blobs' });
    pipeline.metric(METRICS.roomMemory, room.pendingBytes, { kind: 'pending_updates' });
    pipeline.metric(METRICS.roomAge, (at - room.openedAt) / 1000);
    pipeline.metric(METRICS.roomIdle, (at - room.lastChange) / 1000);
  }

  function sample(): void {
    const at = now();
    const memory = { state: 0, blobs: 0, pending_updates: 0 };
    let fullest = 0;
    for (const room of rooms) {
      sampleRoom(room, at);
      memory.state += room.stateBytes ?? 0;
      memory.blobs += room.blobBytes ?? 0;
      memory.pending_updates += room.pendingBytes;
      fullest = Math.max(fullest, participantsOf(room));
    }
    for (const [kind, bytes] of Object.entries(memory))
      pipeline.metric(METRICS.roomsMemory, bytes, { kind });
    pipeline.metric(METRICS.roomParticipantsMax, fullest);
    totals();
  }

  const interval = options.sampleInterval ?? 60_000;
  const timer = interval === false ? null : setInterval(sample, interval);
  (timer as { unref?: () => void } | null)?.unref?.();

  return {
    open(doc, roomOptions = {}) {
      const opened = now();
      const onUpdate = (update: Uint8Array) => {
        room.lastChange = now();
        room.pendingBytes += update.byteLength;
        room.changed = true;
        pipeline.metric(METRICS.updates, 1);
        pipeline.metric(METRICS.updateBytes, update.byteLength);
      };
      // A cursor move also changes awareness; only a join or a leave changes the totals.
      const onAwareness = (change: unknown) => {
        const { added, removed } = (change ?? {}) as { added?: unknown[]; removed?: unknown[] };
        if ((added?.length ?? 0) + (removed?.length ?? 0) > 0) totals();
      };
      doc.on('update', onUpdate);
      roomOptions.awareness?.on('change', onAwareness);
      const handle: RoomHandle = {
        label: label(roomOptions.name ?? ''),
        time: (operation, run) => time(operation, run, room),
        connected() {
          room.connections += 1;
          totals();
        },
        disconnected() {
          room.connections = Math.max(0, room.connections - 1);
          totals();
        },
        close() {
          if (!rooms.delete(room)) return;
          room.dispose();
          totals();
        },
      };
      const room: Room = {
        handle,
        doc,
        awareness: roomOptions.awareness,
        openedAt: opened,
        lastChange: opened,
        connections: 0,
        pendingBytes: 0,
        changed: true,
        stateBytes: null,
        blobBytes: null,
        nodes: null,
        limitRatio: null,
        dispose() {
          doc.off('update', onUpdate);
          roomOptions.awareness?.off('change', onAwareness);
        },
      };
      rooms.add(room);
      totals();
      return handle;
    },
    rejected(reason) {
      pipeline.metric(METRICS.admissionRejections, 1, { reason: reasonOf(reason, known) });
    },
    refused(reason) {
      pipeline.metric(METRICS.messageRefusals, 1, { reason: reasonOf(reason, known) });
    },
    migrated(outcome) {
      pipeline.metric(METRICS.migrations, 1, { outcome });
    },
    time: (operation, run) => time(operation, run),
    list() {
      const at = now();
      return [...rooms].map((room) => ({
        room: room.handle.label,
        participants: participantsOf(room),
        connections: room.connections,
        stateBytes: room.stateBytes,
        blobBytes: room.blobBytes,
        pendingBytes: room.pendingBytes,
        nodes: room.nodes,
        limitRatio: room.limitRatio,
        ageSeconds: Math.round((at - room.openedAt) / 1000),
        idleSeconds: Math.round((at - room.lastChange) / 1000),
      }));
    },
    sample,
    flush: () => pipeline.flush(),
    async shutdown() {
      if (timer) clearInterval(timer);
      for (const room of [...rooms]) room.handle.close();
      await pipeline.shutdown();
    },
  };
}

function participantsOf(room: Room): number {
  return room.awareness ? room.awareness.getStates().size : room.connections;
}

function elapsed(start: number): number {
  return Math.max(0, ((globalThis.performance?.now() ?? Date.now()) - start) / 1000);
}

export type { TelemetryExporter, TelemetryPipelineOptions } from '../pipeline.ts';
