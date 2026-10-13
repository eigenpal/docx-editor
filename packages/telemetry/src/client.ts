/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { explainDiagnostic } from '@docx-editor.dev/core';
import type {
  EditorDiagnostic,
  EditorDiagnosticKind,
  EditorModule,
  TimingSummary,
} from '@docx-editor.dev/core';
import { METRICS, type MetricDefinition } from './metrics.ts';
import { checkAttributes, checkEvent } from './anonymous.ts';
import {
  ENGINE_VERSION,
  createPipeline,
  type AttributeValue,
  type Attributes,
  type Pipeline,
  type TelemetryEvent,
  type TelemetryPipelineOptions,
} from './pipeline.ts';

/**
 * The areas you can switch on. Each one selects diagnostic kinds:
 *
 * - `documentOpen`: documents opened and refused (`document.open`).
 * - `editing`: edits and commands refused while changes are not tracked (`edit.rejected`).
 * - `trackedChanges`: refusals while suggesting, refusals about tracking itself, and skipped
 *   tracked changes
 *   (`edit.rejected` with `tracked: true`, `review.skipped`).
 * - `fonts`: fonts that failed and were substituted (`font.failed`).
 * - `history`: undo steps that did not group as the gesture intended (`history`).
 * - `customNodes`: custom node payloads that could not be read (`custom-node`).
 * - `collaborationClient`: collaboration status changes and room size (`collab.*`).
 * - `performance`: how fast the editor responds: key presses and clicks to the next frame,
 *   and engine layout and paint times, as one summary per minute of use (`performance`).
 *
 * @public
 */
export type TelemetryArea =
  | 'documentOpen'
  | 'editing'
  | 'trackedChanges'
  | 'fonts'
  | 'history'
  | 'customNodes'
  | 'collaborationClient'
  | 'performance';

/** Options for one area. @public */
export interface TelemetryAreaOptions {
  /**
   * Share of events to send, from 0 to 1. Metrics count every event, except that a
   * `performance` rate of 0 turns performance off, metrics included. Defaults to 1.
   * Each event is sampled on its own, except in `performance`: there the choice is made once
   * for each editor, which sends all of its summaries or none.
   */
  readonly sampleRate?: number;
}

/** Which areas to record. An area that is absent or `false` records nothing. @public */
export type TelemetryInclude = { readonly [A in TelemetryArea]?: boolean | TelemetryAreaOptions };

/** Options for {@link createTelemetry}. @public */
export interface TelemetryOptions extends TelemetryPipelineOptions {
  /**
   * The areas to record. Omitted, every area is on.
   *
   * @example
   * ```ts
   * include: { documentOpen: true, trackedChanges: true, editing: { sampleRate: 0.2 } }
   * ```
   */
  readonly include?: TelemetryInclude;
  /**
   * Identical refusals inside this window are sent once, then summarized with `repeated`.
   * Holding Backspace on a locked drawing is one event, not hundreds. Defaults to 10 000 ms.
   * Set 0 to send every event.
   */
  readonly dedupeWindowMs?: number;
  /**
   * How much of an opened document's shape to send. `'basic'`, the default, sends the size and
   * page buckets. `'detailed'` also sends part, paragraph, review item, and embedded font
   * buckets: useful to group open times, but several counts together describe a document more
   * closely, so ask for it only when you need it.
   */
  readonly documentShape?: 'basic' | 'detailed';
  /**
   * Your identifiers on every event, such as a tenant or a pseudonymous user id. A function is
   * read at each event, so it can follow sign-in and tenant switches. Events only: to label
   * metrics with a key, list it in `metricLabels`. For values that belong to one editor, such as
   * its room or document, use {@link Telemetry.moduleFor}.
   *
   * These values are yours and go only to your exporters. Keys follow attribute rules: letters,
   * digits, `_`, `.`, and `-`, up to 64 characters. Values are strings, numbers, or booleans;
   * strings are cut at 256 characters.
   *
   * @example
   * ```ts
   * attributes: () => ({ 'tenant.id': session.tenantId, 'user.id': session.pseudonymousId })
   * ```
   */
  readonly attributes?: Attributes | (() => Attributes);
  /**
   * Which events go to your exporters, after the privacy check and sampling. Metrics still count
   * every event. A filter that throws drops the event.
   *
   * @example
   * ```ts
   * // Failures and performance summaries only: no event for an open that succeeded.
   * filter: (event) => isFailure(event) || event.kind === 'performance'
   * ```
   */
  readonly filter?: (event: TelemetryEvent) => boolean;
}

/** A configured telemetry client. Create it once, outside any component. @public */
export interface Telemetry {
  /**
   * Register this in the editor's `modules`. It observes every editor created with it, from
   * the first open on.
   *
   * @example
   * ```tsx
   * const MODULES = [reviewModule(), telemetry.module];
   * <DocxEditor document={bytes} modules={MODULES} />;
   * ```
   */
  readonly module: EditorModule;
  /**
   * A module for one editor, whose events also carry `attributes`, such as its collaboration
   * room, document, or workspace. Create one for each editor, and keep it stable across renders.
   * Use it in place of `module`, not next to it.
   *
   * @example
   * ```tsx
   * const modules = useMemo(
   *   () => [reviewModule(), telemetry.moduleFor({ 'room.id': roomId, 'document.id': documentId })],
   *   [roomId, documentId]
   * );
   * ```
   */
  moduleFor(attributes: Attributes): EditorModule;
  /**
   * Record one diagnostic yourself, for example from a runtime you created without `module`.
   * Use `module` or `record`, not both, or every event is recorded twice. `attributes` are added
   * to this event, as `moduleFor` adds them.
   */
  record(event: EditorDiagnostic, attributes?: Attributes): void;
  /** Send summaries of open deduplication windows, then flush every exporter. */
  flush(): Promise<void>;
  /** Flush, then stop. Later events are dropped. */
  shutdown(): Promise<void>;
}

const ALL_AREAS: TelemetryInclude = {
  documentOpen: true,
  editing: true,
  trackedChanges: true,
  fonts: true,
  history: true,
  customNodes: true,
  collaborationClient: true,
  performance: true,
};

/** Refusals about tracking itself, reported under `trackedChanges` even with tracking off. */
const TRACKING_CODES: ReadonlySet<string> = new Set([
  'edit.tracking-required',
  'edit.suggesting-needs-author',
  'edit.tracking-mode-unsupported',
  'edit.tracking-author-required',
  'edit.tracking-unsupported-host',
]);

function areaOf(event: EditorDiagnostic): TelemetryArea | null {
  switch (event.kind) {
    case 'document.open':
      return 'documentOpen';
    case 'edit.rejected':
      return event.tracked || TRACKING_CODES.has(event.code) ? 'trackedChanges' : 'editing';
    case 'review.skipped':
      return 'trackedChanges';
    case 'font.failed':
      return 'fonts';
    case 'history':
      return 'history';
    case 'custom-node':
      return 'customNodes';
    case 'collab.status':
    case 'collab.participants':
      return 'collaborationClient';
    case 'performance':
      return 'performance';
    default:
      return null;
  }
}

/** Events that repeat in bursts, and the fields that make two of them the same. */
function dedupeKey(event: EditorDiagnostic): string | null {
  if (event.kind === 'edit.rejected')
    return [
      event.editorSessionId,
      event.code,
      event.cause,
      event.errorName,
      event.stage,
      event.origin,
      event.tracked,
      event.command,
    ].join('|');
  if (event.kind === 'font.failed') return `${event.editorSessionId}|font|${event.code}`;
  if (event.kind === 'history' || event.kind === 'custom-node')
    return `${event.editorSessionId}|${event.kind}|${event.code}`;
  // People join and leave in bursts; inside a window only the latest count matters.
  if (event.kind === 'collab.participants') return `${event.editorSessionId}|participants`;
  if (event.kind === 'collab.status')
    return `${event.editorSessionId}|status|${event.status}|${event.code ?? ''}|${event.recovering}`;
  return null;
}

/**
 * Create a telemetry client for editors.
 *
 * Nothing is sent unless you pass an exporter. With `consent`, nothing is sent while it is
 * false; without it, events are sent. Every event is anonymous: codes, enums, and bucketed
 * numbers only.
 *
 * @example
 * ```ts
 * import { createTelemetry, consoleExporter } from '@docx-editor.dev/telemetry';
 *
 * export const telemetry = createTelemetry({
 *   exporters: [consoleExporter()],
 *   include: { documentOpen: true, trackedChanges: true },
 * });
 * ```
 *
 * @public
 */
export function createTelemetry(options: TelemetryOptions): Telemetry {
  const pipeline = createPipeline(options);
  const metricLabels = options.metricLabels ?? [];
  /** The client's attributes now, then the editor's. A function that throws adds nothing. */
  function attributesFor(editor: Attributes): Attributes {
    let client: Attributes = {};
    try {
      const value =
        typeof options.attributes === 'function' ? options.attributes() : options.attributes;
      client = checkAttributes(value ?? {}, 'attributes');
    } catch {
      /* the host's attribute problem, not the editor's */
    }
    return Object.freeze({ ...client, ...editor });
  }
  /** Your attributes listed in `metricLabels`, as metric labels. */
  function hostLabels(attributes: Attributes): Attributes {
    const out: Record<string, AttributeValue> = {};
    for (const key of metricLabels) if (attributes[key] !== undefined) out[key] = attributes[key];
    return out;
  }
  const include = options.include ?? ALL_AREAS;
  const windowMs = options.dedupeWindowMs ?? 10_000;
  /** Every event goes out here, so the host's filter sees summaries and repeats too. */
  const send = (event: TelemetryEvent): void => {
    try {
      if (options.filter && !options.filter(event)) return;
    } catch {
      return;
    }
    pipeline.event(event);
  };
  const detailedShape = options.documentShape === 'detailed';
  interface Window {
    readonly event: TelemetryEvent;
    repeated: number;
    /** For a participants window: the latest count seen while the window was open. */
    latest?: EditorDiagnostic;
    readonly timer: unknown;
  }
  const windows = new Map<string, Window>();
  let pageHooked = false;
  let unhookPage = (): void => {};
  let closed = false;

  function rate(area: TelemetryArea): number | null {
    const setting = include[area];
    if (!setting) return null;
    if (setting === true) return 1;
    return Math.min(1, Math.max(0, setting.sampleRate ?? 1));
  }

  /** For `performance`, one choice per editor, so one person's summaries stay together. */
  const editorSamples = new Map<string, boolean>();
  function sampled(diagnostic: EditorDiagnostic, area: TelemetryArea, sampleRate: number) {
    if (sampleRate >= 1) return true;
    if (area !== 'performance') return Math.random() < sampleRate;
    let keep = editorSamples.get(diagnostic.editorSessionId);
    if (keep === undefined) {
      if (editorSamples.size >= 1000) editorSamples.clear();
      keep = Math.random() < sampleRate;
      editorSamples.set(diagnostic.editorSessionId, keep);
    }
    return keep;
  }

  function hookPage(): void {
    if (pageHooked) return;
    pageHooked = true;
    const page = globalThis as {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };
    // Read lazily: during server rendering there is no window, and nothing to flush.
    if (typeof page.addEventListener !== 'function') return;
    // Closing first, so the summaries the flush emits go out with delivery that survives the page.
    const onPageHide = () => {
      pipeline.setPageClosing(true);
      void flush();
    };
    // A mobile browser often closes a background tab without `pagehide`. The event reaches the
    // window after the document's own listeners, where each editor sends its last summary.
    const onVisibility = () => {
      const hidden = globalThis.document?.visibilityState === 'hidden';
      pipeline.setPageClosing(hidden);
      if (hidden) void flush();
    };
    page.addEventListener('pagehide', onPageHide);
    page.addEventListener('visibilitychange', onVisibility);
    unhookPage = () => {
      page.removeEventListener?.('pagehide', onPageHide);
      page.removeEventListener?.('visibilitychange', onVisibility);
    };
  }

  function close(key: string): void {
    const open = windows.get(key);
    if (!open) return;
    windows.delete(key);
    clearTimeout(open.timer as ReturnType<typeof setTimeout>);
    if (open.latest) {
      // A count is a state, not a repeat: send the latest one if it differs.
      const sent = open.event as { count?: number };
      if ((open.latest as { count?: number }).count !== sent.count)
        send(enrich(withShape(open.latest, detailedShape), pipeline, open.event.attributes));
    } else if (open.repeated > 0) {
      send({ ...open.event, repeated: open.repeated });
    }
  }

  function record(diagnostic: EditorDiagnostic, editorAttributes: Attributes = {}): void {
    // Consent first: a window opened before consent would later send a summary of an event
    // that was never delivered.
    if (closed || !pipeline.consented()) return;
    const attributes = attributesFor(editorAttributes);
    // The guard runs before the metrics, so a value outside the closed lists never becomes a
    // metric label, and an event the guard drops is counted.
    const checked = checkEvent(enrich(diagnostic, pipeline, attributes));
    if ('dropped' in checked) {
      // Your labels too, so a dashboard filtered by environment or version still shows drops.
      pipeline.metric(METRICS.droppedEvents, 1, {
        ...hostLabels(attributes),
        reason: checked.dropped,
        'docx_editor.version': ENGINE_VERSION,
      });
      return;
    }
    const area = areaOf(diagnostic);
    const sampleRate = area ? rate(area) : null;
    // A performance rate of 0 is off, even when another listener keeps the editor measuring.
    if (sampleRate === null || (area === 'performance' && sampleRate === 0)) return;
    hookPage();
    recordMetrics(pipeline, checked.event as unknown as EditorDiagnostic, hostLabels(attributes));
    const key = windowMs > 0 ? dedupeKey(diagnostic) : null;
    const open = key ? windows.get(key) : undefined;
    if (open) {
      if (diagnostic.kind === 'collab.participants') open.latest = diagnostic;
      else open.repeated += 1;
      return;
    }
    if (!sampled(diagnostic, area!, sampleRate)) return;
    const event = enrich(withShape(diagnostic, detailedShape), pipeline, attributes);
    send(event);
    if (key) {
      const timer = setTimeout(() => close(key), windowMs);
      (timer as { unref?: () => void }).unref?.();
      windows.set(key, { event, repeated: 0, timer });
    }
  }

  function moduleFor(attributes: Attributes): EditorModule {
    return Object.freeze({
      id: 'telemetry',
      onDiagnostic: (event: EditorDiagnostic) => record(event, attributes),
      // The editor times key presses only while performance would be recorded.
      wantsDiagnostic: (kind: EditorDiagnosticKind) =>
        !closed &&
        (kind !== 'performance' || ((rate('performance') ?? 0) > 0 && pipeline.consented())),
    });
  }

  async function flush(): Promise<void> {
    for (const key of [...windows.keys()]) close(key);
    await pipeline.flush();
  }

  return {
    module: moduleFor({}),
    moduleFor(attributes) {
      return moduleFor(checkAttributes(attributes, 'moduleFor'));
    },
    record,
    flush,
    async shutdown() {
      for (const key of [...windows.keys()]) close(key);
      closed = true;
      unhookPage();
      await pipeline.shutdown();
    },
  };
}

/** The diagnostic without its detailed document shape, unless the host asked for it. */
function withShape(diagnostic: EditorDiagnostic, detailed: boolean): EditorDiagnostic {
  if (detailed || diagnostic.kind !== 'document.open' || diagnostic.outcome !== 'opened')
    return diagnostic;
  if (!('shape' in diagnostic)) return diagnostic;
  const { shape: _shape, ...rest } = diagnostic;
  return rest as EditorDiagnostic;
}

/** Adds the hint, the docs link, the version, and the host's resource values. */
function enrich(
  diagnostic: EditorDiagnostic,
  pipeline: Pipeline,
  attributes: Attributes
): TelemetryEvent {
  const code = 'code' in diagnostic ? diagnostic.code : undefined;
  return {
    ...diagnostic,
    ...(code ? explainDiagnostic(code) : {}),
    engineVersion: ENGINE_VERSION,
    resource: pipeline.resource,
    attributes,
  };
}

/** Metrics count every event, before sampling and deduplication. */
function recordMetrics(pipeline: Pipeline, event: EditorDiagnostic, labels: Attributes): void {
  // Your labels from `metricLabels` go on every measurement of this event.
  const labelled: Pick<Pipeline, 'metric'> = {
    metric: (definition, value, attributes = {}) =>
      pipeline.metric(definition, value, {
        ...attributes,
        ...labels,
        'docx_editor.version': ENGINE_VERSION,
      }),
  };
  switch (event.kind) {
    case 'document.open':
      if (event.outcome === 'opened') {
        labelled.metric(METRICS.documentOpens, 1, {
          outcome: 'opened',
          code: 'none',
          cause: 'none',
          part: 'none',
        });
        labelled.metric(METRICS.documentOpenDuration, event.durationMs / 1000);
      } else
        labelled.metric(METRICS.documentOpens, 1, {
          outcome: 'rejected',
          code: event.code,
          cause: event.cause ?? 'none',
          part: event.part ?? 'none',
        });
      return;
    case 'edit.rejected':
      labelled.metric(METRICS.editRejections, 1, {
        code: event.code,
        cause: event.cause ?? 'none',
        origin: event.origin,
        tracked: event.tracked,
      });
      return;
    case 'review.skipped':
      labelled.metric(METRICS.reviewSkipped, event.count, {
        code: event.code,
        cause: event.cause ?? 'none',
        operation: event.operation ?? 'none',
        change_kind: event.changeKind ?? 'none',
      });
      return;
    case 'font.failed':
      labelled.metric(METRICS.fontFailures, 1, { code: event.code });
      return;
    case 'history':
      labelled.metric(METRICS.historyDiagnostics, 1, { code: event.code });
      return;
    case 'custom-node':
      labelled.metric(METRICS.customNodeDiagnostics, 1, { code: event.code });
      return;
    case 'collab.status':
      labelled.metric(METRICS.collabClientStatusTransitions, 1, {
        status: event.status,
        code: event.code ?? 'none',
      });
      if (event.connectMs !== undefined)
        labelled.metric(METRICS.collabClientConnectDuration, event.connectMs / 1000);
      return;
    case 'collab.participants':
      labelled.metric(METRICS.collabClientParticipants, event.count);
      return;
    case 'performance': {
      const pages = event.pagesBucket ?? 'unknown';
      recordTiming(labelled, METRICS.editorInteractionDuration, pages, event.interaction);
      recordTiming(labelled, METRICS.editorLayoutDuration, pages, event.layout);
      recordTiming(labelled, METRICS.editorPaintDuration, pages, event.paint);
    }
  }
}

/**
 * A summary's bands as histogram samples: each band's count at the middle of the band, and the
 * band above the last bound at the slowest timing. Every sample lands in its own bucket, so the
 * bucket counts are exact.
 */
function recordTiming(
  pipeline: Pick<Pipeline, 'metric'>,
  definition: MetricDefinition,
  pages: string,
  summary?: TimingSummary
) {
  if (!summary) return;
  const bounds = definition.buckets ?? [];
  summary.bands.forEach((count, band) => {
    const upper = bounds[band];
    const lower = band === 0 ? 0 : bounds[band - 1]!;
    // `maxMs` is rounded: a press of 1000.3 ms reports 1000, which must stay above the bound.
    const seconds =
      upper === undefined ? Math.max(summary.maxMs / 1000, lower + 1e-6) : (lower + upper) / 2;
    for (let sample = 0; sample < count; sample += 1)
      pipeline.metric(definition, seconds, { pages });
  });
}
