/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * The metric catalog: one definition per metric, in OpenTelemetry terms. Prometheus names are
 * derived from it mechanically by {@link prometheusName}, so the two outputs cannot drift.
 *
 * Every label is a bounded enum. No metric carries a room name, a user, or a document.
 */

/** How a metric aggregates. @public */
export type MetricKind = 'counter' | 'gauge' | 'histogram';

/** One metric in the catalog. @public */
export interface MetricDefinition {
  /** OpenTelemetry name, such as `docx_editor.collab.room.load.duration`. */
  readonly name: string;
  readonly kind: MetricKind;
  /** UCUM unit as OpenTelemetry writes it: `s`, `By`, `1`, or a `{annotation}`. */
  readonly unit: string;
  readonly description: string;
  /** The label keys this metric may carry. Each value is a bounded enum. */
  readonly labels: readonly string[];
  /** Histogram bucket upper bounds, in the metric's unit. */
  readonly buckets?: readonly number[];
}

/**
 * The label every editor metric carries: the version of the editor packages that measured it,
 * so a dashboard can compare editor releases. One value per release.
 */
const EDITOR_VERSION = 'docx_editor.version';

const SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];
const BYTES = [
  1024,
  16 * 1024,
  64 * 1024,
  256 * 1024,
  1024 * 1024,
  4 * 1024 * 1024,
  16 * 1024 * 1024,
  64 * 1024 * 1024,
  256 * 1024 * 1024,
  1024 * 1024 * 1024,
];
/** The bands of a performance summary, in seconds. */
const EDITOR_TIMING = [0.016, 0.033, 0.05, 0.1, 0.2, 0.5, 1];
const PEOPLE = [1, 2, 3, 5, 10, 20, 50, 100, 250];
const NODES = [1_000, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const RATIO = [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 1];
const LIFETIME = [60, 300, 900, 3_600, 4 * 3_600, 24 * 3_600, 7 * 24 * 3_600];

function metric(
  name: string,
  kind: MetricKind,
  unit: string,
  description: string,
  labels: readonly string[] = [],
  buckets?: readonly number[]
): MetricDefinition {
  return Object.freeze({ name, kind, unit, description, labels, ...(buckets ? { buckets } : {}) });
}

/**
 * Every metric the package records.
 *
 * @example
 * ```ts
 * import { METRICS, prometheusName } from '@docx-editor.dev/telemetry';
 * prometheusName(METRICS.roomLoadDuration); // 'docx_editor_collab_room_load_duration_seconds'
 * ```
 *
 * @public
 */
export const METRICS = Object.freeze({
  // Editor clients.
  documentOpens: metric(
    'docx_editor.document.opens',
    'counter',
    '{open}',
    'Documents opened or refused, by outcome, refusal code, engine reason, and part role.',
    ['outcome', 'code', 'cause', 'part', EDITOR_VERSION]
  ),
  documentOpenDuration: metric(
    'docx_editor.document.open.duration',
    'histogram',
    's',
    'Time from the start of an open to the laid-out document.',
    [EDITOR_VERSION],
    SECONDS
  ),
  editRejections: metric(
    'docx_editor.edit.rejections',
    'counter',
    '{edit}',
    'Edits, commands, and tracked changes refused, by public code and engine reason.',
    ['code', 'cause', 'origin', 'tracked', EDITOR_VERSION]
  ),
  reviewSkipped: metric(
    'docx_editor.review.skipped',
    'counter',
    '{change}',
    'Tracked changes skipped by accept, reject, or reassign requests, by engine reason, operation, and change kind.',
    ['code', 'cause', 'operation', 'change_kind', EDITOR_VERSION]
  ),
  fontFailures: metric(
    'docx_editor.font.failures',
    'counter',
    '{failure}',
    'Font faces that failed to load and were substituted.',
    ['code', EDITOR_VERSION]
  ),
  historyDiagnostics: metric(
    'docx_editor.history.diagnostics',
    'counter',
    '{event}',
    'Undo steps that did not group as the gesture intended, by code.',
    ['code', EDITOR_VERSION]
  ),
  customNodeDiagnostics: metric(
    'docx_editor.custom_node.diagnostics',
    'counter',
    '{node}',
    'Custom node payloads that could not be read, by code.',
    ['code', EDITOR_VERSION]
  ),
  collabClientStatusTransitions: metric(
    'docx_editor.collab.client.status_transitions',
    'counter',
    '{transition}',
    'Collaboration status changes on clients, by new status and failure code.',
    ['status', 'code', EDITOR_VERSION]
  ),
  collabClientConnectDuration: metric(
    'docx_editor.collab.client.connect.duration',
    'histogram',
    's',
    'Time from an editor attaching a room to its first ready status, when the editor attached before the room was ready.',
    [EDITOR_VERSION],
    SECONDS
  ),
  collabClientParticipants: metric(
    'docx_editor.collab.client.participants',
    'histogram',
    '{participant}',
    'People in the room, as each client sees it when the count changes.',
    [EDITOR_VERSION],
    PEOPLE
  ),

  editorInteractionDuration: metric(
    'docx_editor.editor.interaction.duration',
    'histogram',
    's',
    'Key presses and pointer presses on the pages, to the next frame on screen, by page count bucket. Bucket counts are exact; the sum is estimated from the bands.',
    ['pages', EDITOR_VERSION],
    EDITOR_TIMING
  ),
  editorLayoutDuration: metric(
    'docx_editor.editor.layout.duration',
    'histogram',
    's',
    'Engine layout passes after edits and view changes, background work included, by page count bucket. Bucket counts are exact; the sum is estimated from the bands.',
    ['pages', EDITOR_VERSION],
    EDITOR_TIMING
  ),
  editorPaintDuration: metric(
    'docx_editor.editor.paint.duration',
    'histogram',
    's',
    'Engine paints of the pages, by page count bucket. Bucket counts are exact; the sum is estimated from the bands.',
    ['pages', EDITOR_VERSION],
    EDITOR_TIMING
  ),

  droppedEvents: metric(
    'docx_editor.telemetry.dropped_events',
    'counter',
    '{event}',
    'Events the anonymity guard dropped, by reason. Usually a version mismatch.',
    ['reason', EDITOR_VERSION]
  ),

  // Collaboration servers.
  roomsActive: metric('docx_editor.collab.rooms.active', 'gauge', '{room}', 'Rooms loaded.'),
  connectionsActive: metric(
    'docx_editor.collab.connections.active',
    'gauge',
    '{connection}',
    'Open client connections. One person with two tabs is two connections.'
  ),
  participantsActive: metric(
    'docx_editor.collab.participants.active',
    'gauge',
    '{participant}',
    'People present in all rooms, from awareness states.'
  ),
  roomParticipants: metric(
    'docx_editor.collab.room.participants',
    'histogram',
    '{participant}',
    'People present in each room, sampled once per room per interval.',
    [],
    PEOPLE
  ),
  roomParticipantsMax: metric(
    'docx_editor.collab.room.participants.max',
    'gauge',
    '{participant}',
    'People in the fullest room now.'
  ),
  roomMemory: metric(
    'docx_editor.collab.room.memory',
    'histogram',
    'By',
    'Bytes each room holds, sampled per room: encoded state, blobs, and updates not yet stored.',
    ['kind'],
    BYTES
  ),
  roomsMemory: metric(
    'docx_editor.collab.rooms.memory',
    'gauge',
    'By',
    'Bytes all rooms hold together at the last sample.',
    ['kind']
  ),
  roomNodes: metric(
    'docx_editor.collab.room.nodes',
    'histogram',
    '{node}',
    'Shared document nodes per room, live and tombstoned.',
    ['state'],
    NODES
  ),
  roomResourceUsage: metric(
    'docx_editor.collab.room.resource_usage',
    'histogram',
    '1',
    'Share of each room resource limit in use, from 0 to 1.',
    ['resource'],
    RATIO
  ),
  roomAge: metric(
    'docx_editor.collab.room.age',
    'histogram',
    's',
    'How long each room has been loaded.',
    [],
    LIFETIME
  ),
  roomIdle: metric(
    'docx_editor.collab.room.idle',
    'histogram',
    's',
    'Time since each room last changed.',
    [],
    LIFETIME
  ),
  roomLoadDuration: metric(
    'docx_editor.collab.room.load.duration',
    'histogram',
    's',
    'Time to load a room, by outcome.',
    ['outcome'],
    SECONDS
  ),
  roomStoreDuration: metric(
    'docx_editor.collab.room.store.duration',
    'histogram',
    's',
    'Time to store a room, by outcome.',
    ['outcome'],
    SECONDS
  ),
  admissionRejections: metric(
    'docx_editor.collab.admission.rejections',
    'counter',
    '{connection}',
    'Connections refused at admission, by reason.',
    ['reason']
  ),
  messageRefusals: metric(
    'docx_editor.collab.message.refusals',
    'counter',
    '{message}',
    'Messages refused before they applied, by reason, such as room-generation-changed.',
    ['reason']
  ),
  updates: metric(
    'docx_editor.collab.updates',
    'counter',
    '{update}',
    'Document updates applied to rooms.'
  ),
  updateBytes: metric(
    'docx_editor.collab.update.bytes',
    'counter',
    'By',
    'Bytes of document updates applied to rooms.'
  ),
  roomParticipantsByRoom: metric(
    'docx_editor.collab.room.participants.current',
    'gauge',
    '{participant}',
    'People in each room, labeled by room. Recorded only with perRoomSeries.',
    ['room']
  ),
  roomMemoryByRoom: metric(
    'docx_editor.collab.room.memory.current',
    'gauge',
    'By',
    'Bytes each room holds, labeled by room and kind. Recorded only with perRoomSeries.',
    ['room', 'kind']
  ),
  migrations: metric(
    'docx_editor.collab.migrations',
    'counter',
    '{room}',
    'Room migrations, by outcome.',
    ['outcome']
  ),
});

/** A key of {@link METRICS}. @public */
export type MetricId = keyof typeof METRICS;

const UNIT_SUFFIX: Readonly<Record<string, string>> = { s: 'seconds', By: 'bytes' };

/**
 * The Prometheus name of a metric: dots become underscores, the unit becomes a suffix, and a
 * counter ends in `_total`, as the OpenTelemetry Prometheus exporter writes it.
 *
 * @example
 * ```ts
 * prometheusName(METRICS.editRejections); // 'docx_editor_edit_rejections_total'
 * prometheusName(METRICS.editorInteractionDuration); // 'docx_editor_editor_interaction_duration_seconds'
 * ```
 *
 * @public
 */
export function prometheusName(definition: MetricDefinition): string {
  let name = definition.name.replace(/[^a-zA-Z0-9_]/g, '_');
  // `_ratio` goes on gauges with unit `1` only; other unit-`1` metrics get no unit suffix.
  const suffix =
    definition.unit === '1'
      ? definition.kind === 'gauge'
        ? 'ratio'
        : undefined
      : UNIT_SUFFIX[definition.unit];
  if (suffix && !name.endsWith(`_${suffix}`)) name += `_${suffix}`;
  if (definition.kind === 'counter') name += '_total';
  return name;
}
