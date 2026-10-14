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
import { diagnosticCodes } from '@docx-editor.dev/core';
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
   * Also record each room's people and memory as gauges labeled `room`. Off by default: a label
   * per room makes one series per room, and a large server has many rooms. A closed room's
   * series is dropped. Only the default label or `hmacRoomLabel` is accepted, so no room name
   * can become a label; any other `roomLabel` throws.
   */
  readonly perRoomSeries?: boolean;
  /**
   * Your own reading of a refusal, for errors whose `reason` or `code` is free text. Return a
   * common reason such as `unauthorized`, a collaboration failure code, or one of `reasons`;
   * anything else is counted as `other`. Return undefined to use the default reading.
   */
  readonly reasonOf?: (error: unknown) => string | undefined;
  /**
   * Refusal reasons to keep as metric labels. Compared without case and recorded in lowercase. Collaboration failure codes are always kept.
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

/** Records a started operation's duration with its outcome. Later calls do nothing. @public */
export type SettleOperation = (outcome: 'success' | 'failure') => void;

/** One open room. Returned by {@link RoomTelemetry.open}. @public */
export interface RoomHandle {
  /** The room's label, as {@link RoomTelemetryOptions.roomLabel} made it. */
  readonly label: string;
  /** Run `operation` and record its duration and outcome. Rethrows its error. */
  time<T>(operation: RoomOperation, run: () => T | Promise<T>): Promise<T>;
  /** Start timing `operation` where `time` cannot wrap it; call the result once it settles. */
  begin(operation: RoomOperation): SettleOperation;
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
  /** Start timing an operation that has no room yet; call the result once it settles. */
  begin(operation: RoomOperation): SettleOperation;
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
 * @example
 * ```ts
 * const rooms = roomTelemetry({
 *   exporters: [metrics],
 *   roomLabel: hmacRoomLabel(process.env.ROOM_LABEL_SECRET),
 * });
 * ```
 *
 * @public
 */
export function hmacRoomLabel(secret: string | undefined): (name: string) => string {
  if (typeof secret !== 'string' || secret.length === 0)
    throw new TypeError('hmacRoomLabel needs a non-empty secret, such as an environment variable.');
  const label = (name: string) =>
    `room-${createHmac('sha256', secret).update(name).digest('hex').slice(0, 16)}`;
  NAME_FREE_LABELS.add(label);
  return label;
}

/** Room label functions that cannot reveal a room name, so they may become a metric label. */
const NAME_FREE_LABELS = new WeakSet<(name: string) => string>();

/**
 * The refusal reason of a string, or of an error carrying `reason` or `code`. A reason that is
 * not a collaboration failure code, a common reason, or one listed in `reasons` is `other`.
 */
function readReason(value: unknown, known: ReadonlySet<string>): string {
  // Hocuspocus answers a refusal with no reason as `permission-denied`; count it the same.
  if (!value) return 'permission-denied';
  const fields = value as { reason?: unknown; code?: unknown; message?: unknown };
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? (fields.reason ??
          fields.code ??
          // `new Error('Unauthorized')`: the message counts only when it is a known reason.
          (typeof fields.message === 'string' && known.has(fields.message.toLowerCase())
            ? fields.message
            : undefined))
        : undefined;
  // An error with no reason is often a bug in the hook, not a decision: `other`, not a denial.
  if (raw === undefined) return 'other';
  if (typeof raw === 'number') return HOCUSPOCUS_CLOSE_CODES[raw] ?? 'other';
  if (typeof raw !== 'string') return 'other';
  if (isCollaborationFailureCode(raw)) return raw;
  // Hocuspocus's own close events say `Unauthorized` and `Forbidden`.
  const lower = raw.toLowerCase();
  return known.has(lower) ? lower : 'other';
}

/** Hocuspocus close codes, for an error that carries only `code`. */
const HOCUSPOCUS_CLOSE_CODES: Readonly<Record<number, string>> = {
  4401: 'unauthorized',
  4403: 'forbidden',
};

/** Every collaboration failure code, which a refusal may carry as its reason. */
const FAILURE_REASONS = diagnosticCodes()
  .map((code) => code.replace(/^collab\./, ''))
  .filter(isCollaborationFailureCode);

const COMMON_REASONS = [
  'unauthorized',
  'forbidden',
  'permission-denied',
  'unknown-room',
  'rate-limited',
];

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
  /** Loads in progress through the handle; their updates are the saved state. */
  loading: number;
  /** Whether the room has been sampled at least once. */
  sampled: boolean;
  stateBytes: number | null;
  blobBytes: number | null;
  nodes: number | null;
  limitRatio: number | null;
  /** The last resource ratios and node counts read, recorded again at each sample. */
  ratios?: Record<string, number>;
  nodeStates?: Record<string, number>;
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
 * await room.time('load', () => loadRoom(ydoc)); // the loaded state is not counted as edits
 * room.connected();
 * ```
 *
 * @public
 */
export function roomTelemetry(options: RoomTelemetryOptions): RoomTelemetry {
  const pipeline = createPipeline(options);
  // Compared without case and recorded in lowercase, so `quotaExceeded` matches itself.
  const known = new Set(
    [...COMMON_REASONS, ...(options.reasons ?? [])].map((reason) => reason.toLowerCase())
  );
  const measureState = options.measureState ?? true;
  // Known series start at zero, so a scraper counts the first refusal and the first failed store.
  for (const reason of new Set([...known, ...FAILURE_REASONS, 'other'])) {
    pipeline.declare(METRICS.admissionRejections, { reason });
    pipeline.declare(METRICS.messageRefusals, { reason });
  }
  for (const outcome of ['success', 'failure']) {
    pipeline.declare(METRICS.roomLoadDuration, { outcome });
    pipeline.declare(METRICS.roomStoreDuration, { outcome });
  }
  for (const outcome of ['migrated', 'unchanged', 'failed'])
    pipeline.declare(METRICS.migrations, { outcome });
  pipeline.declare(METRICS.updates);
  pipeline.declare(METRICS.updateBytes);
  // A reason the host chose still has to be a known one, so no free value becomes a series.
  const classify = (error: unknown) => {
    try {
      return readReason(options.reasonOf?.(error) ?? error, known);
    } catch {
      // The host's reader failed: count the refusal, never replace the error the client gets.
      return 'other';
    }
  };
  const perRoom = options.perRoomSeries === true;
  if (perRoom && options.roomLabel && !NAME_FREE_LABELS.has(options.roomLabel))
    throw new TypeError(
      'perRoomSeries puts the room label into every series, so it accepts only the default ' +
        'label or hmacRoomLabel(secret). A custom roomLabel could put a room name in a metric.'
    );
  for (const exporter of options.exporters)
    if (!exporter.metric)
      console.warn(
        `[docx-editor telemetry] exporter "${exporter.name}" records no metrics, and room ` +
          'telemetry sends only metrics. Use otelExporter or prometheusRegistry on a server.'
      );
  const rooms = new Set<Room>();
  let next = 0;
  const label = options.roomLabel ?? (() => `room-${(next += 1)}`);
  const now = () => Date.now();

  function totals(): void {
    let connections = 0;
    let participants = 0;
    let fullest = 0;
    for (const room of rooms) {
      const people = participantsOf(room);
      connections += room.connections;
      participants += people;
      fullest = Math.max(fullest, people);
    }
    pipeline.metric(METRICS.roomsActive, rooms.size);
    pipeline.metric(METRICS.connectionsActive, connections);
    pipeline.metric(METRICS.participantsActive, participants);
    // Live, as the people total is, so the two never disagree.
    pipeline.metric(METRICS.roomParticipantsMax, fullest);
  }

  function begin(operation: RoomOperation, room?: Room): SettleOperation {
    const metric = operation === 'load' ? METRICS.roomLoadDuration : METRICS.roomStoreDuration;
    const start = globalThis.performance?.now() ?? now();
    // Updates that arrive while the store runs are not in it, so only what was pending clears.
    const pending = room?.pendingBytes ?? 0;
    let settled = false;
    return (outcome) => {
      if (settled) return;
      settled = true;
      pipeline.metric(metric, elapsed(start), { outcome });
      if (outcome === 'success' && operation === 'store' && room)
        room.pendingBytes = Math.max(0, room.pendingBytes - pending);
    };
  }

  async function time<T>(
    operation: RoomOperation,
    run: () => T | Promise<T>,
    room?: Room
  ): Promise<T> {
    const settle = begin(operation, room);
    try {
      const result = await run();
      settle('success');
      return result;
    } catch (error) {
      settle('failure');
      throw error;
    }
  }

  /** One room's sample. A host awareness or document that throws skips the room, never the server. */
  function trySampleRoom(room: Room, at: number): void {
    try {
      sampleRoom(room, at);
    } catch {
      // The room keeps its last values and is sampled again next time.
      room.changed = true;
    }
  }

  function sampleRoom(room: Room, at: number): void {
    if (room.changed || !room.sampled) {
      room.changed = false;
      room.sampled = true;
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
        room.ratios = ratios;
        room.nodeStates = {
          live: usage.nodes - usage.tombstonedNodes,
          tombstoned: usage.tombstonedNodes,
        };
      } catch {
        // A room that holds no docx-editor document yet has no usage to read.
      }
    }
    // Every room contributes to every histogram each sample, changed or not, so quantiles
    // weigh quiet rooms the same as active ones.
    for (const [resource, ratio] of Object.entries(room.ratios ?? {}))
      pipeline.metric(METRICS.roomResourceUsage, ratio, { resource });
    for (const [state, count] of Object.entries(room.nodeStates ?? {}))
      pipeline.metric(METRICS.roomNodes, count, { state });
    pipeline.metric(METRICS.roomParticipants, participantsOf(room));
    if (room.stateBytes !== null)
      pipeline.metric(METRICS.roomMemory, room.stateBytes, { kind: 'state' });
    if (room.blobBytes !== null)
      pipeline.metric(METRICS.roomMemory, room.blobBytes, { kind: 'blobs' });
    pipeline.metric(METRICS.roomMemory, room.pendingBytes, { kind: 'pending_updates' });
    pipeline.metric(METRICS.roomAge, (at - room.openedAt) / 1000);
    pipeline.metric(METRICS.roomIdle, (at - room.lastChange) / 1000);
    if (perRoom) {
      const label = room.handle.label;
      pipeline.metric(METRICS.roomParticipantsByRoom, participantsOf(room), { room: label });
      for (const [kind, bytes] of memoryOf(room))
        pipeline.metric(METRICS.roomMemoryByRoom, bytes, { room: label, kind });
    }
  }

  /** The cross-room gauges, from each room's last sample. */
  function recordTotals(): void {
    const memory = { state: 0, blobs: 0, pending_updates: 0 };
    for (const room of rooms) {
      memory.state += room.stateBytes ?? 0;
      memory.blobs += room.blobBytes ?? 0;
      memory.pending_updates += room.pendingBytes;
    }
    for (const [kind, bytes] of Object.entries(memory))
      pipeline.metric(METRICS.roomsMemory, bytes, { kind });
    totals();
  }

  function sample(): void {
    const at = now();
    for (const room of rooms) trySampleRoom(room, at);
    recordTotals();
  }

  /**
   * The interval's sample: one room per macrotask, so encoding many large rooms never holds the
   * event loop for the whole pass. `sample()` stays synchronous for callers that need it now.
   */
  let sampling = false;
  async function sampleGradually(): Promise<void> {
    if (sampling) return;
    sampling = true;
    try {
      const at = now();
      for (const room of [...rooms]) {
        if (rooms.has(room)) trySampleRoom(room, at);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      recordTotals();
    } finally {
      sampling = false;
    }
  }

  // A scrape before the first sample reads zero rooms, never an empty body.
  recordTotals();

  const interval = options.sampleInterval ?? 60_000;
  const timer = interval === false ? null : setInterval(() => void sampleGradually(), interval);
  (timer as { unref?: () => void } | null)?.unref?.();

  return {
    open(doc, roomOptions = {}) {
      const opened = now();
      const onUpdate = (update: Uint8Array, origin?: unknown) => {
        // Every update changes what the room holds, so the next sample measures it again.
        room.changed = true;
        if (room.loading > 0) return;
        // An edit from another instance is still an edit to this room: it is not idle.
        room.lastChange = now();
        // Hocuspocus marks updates that arrive from another instance or skip storing; they are
        // not this server's writes, so they neither count nor wait to be stored here.
        const source = (origin as { source?: unknown; skipStoreHooks?: unknown } | null)?.source;
        if (
          source === 'redis' ||
          (source === 'local' && (origin as { skipStoreHooks?: unknown }).skipStoreHooks === true)
        )
          return;
        room.pendingBytes += update.byteLength;
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
        async time(operation, run) {
          // The saved state applied by a load is not new writes: updates during it are ignored.
          if (operation === 'load') room.loading += 1;
          try {
            return await time(operation, run, room);
          } finally {
            if (operation === 'load') room.loading -= 1;
          }
        },
        begin: (operation) => begin(operation, room),
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
          if (perRoom) {
            const label = handle.label;
            pipeline.forget(METRICS.roomParticipantsByRoom, { room: label });
            for (const [kind] of memoryOf(room))
              pipeline.forget(METRICS.roomMemoryByRoom, { room: label, kind });
          }
          // Memory and the fullest room come from the rooms left, so a closed room leaves no
          // stale total behind.
          recordTotals();
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
        loading: 0,
        sampled: false,
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
      pipeline.metric(METRICS.admissionRejections, 1, { reason: classify(reason) });
    },
    refused(reason) {
      pipeline.metric(METRICS.messageRefusals, 1, { reason: classify(reason) });
    },
    migrated(outcome) {
      pipeline.metric(METRICS.migrations, 1, { outcome });
    },
    time: (operation, run) => time(operation, run),
    begin: (operation) => begin(operation),
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

/** The bytes a room holds, by kind, for the per-room gauges. */
function memoryOf(room: Room): [string, number][] {
  return [
    ['state', room.stateBytes ?? 0],
    ['blobs', room.blobBytes ?? 0],
    ['pending_updates', room.pendingBytes],
  ];
}

/** People in the room, from awareness; connections when awareness is absent or throws. */
function participantsOf(room: Room): number {
  if (!room.awareness) return room.connections;
  try {
    return room.awareness.getStates().size;
  } catch {
    return room.connections;
  }
}

function elapsed(start: number): number {
  return Math.max(0, ((globalThis.performance?.now() ?? Date.now()) - start) / 1000);
}

export type { TelemetryExporter, TelemetryPipelineOptions } from '../pipeline.ts';
