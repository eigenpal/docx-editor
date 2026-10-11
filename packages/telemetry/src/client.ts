/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { explainDiagnostic } from '@docx-editor.dev/core';
import type { EditorDiagnostic, EditorModule } from '@docx-editor.dev/core';
import { METRICS } from './metrics.ts';
import {
  ENGINE_VERSION,
  createPipeline,
  type Pipeline,
  type TelemetryEvent,
  type TelemetryPipelineOptions,
} from './pipeline.ts';

/**
 * The areas you can switch on. Each one selects diagnostic kinds:
 *
 * - `documentOpen`: documents opened and refused (`document.open`).
 * - `editing`: edits and commands refused while changes are not tracked (`edit.rejected`).
 * - `trackedChanges`: refusals while suggesting, and skipped tracked changes
 *   (`edit.rejected` with `tracked: true`, `review.skipped`).
 * - `fonts`: fonts that failed and were substituted (`font.failed`).
 * - `collaborationClient`: collaboration status changes and room size (`collab.*`).
 *
 * @public
 */
export type TelemetryArea =
  | 'documentOpen'
  | 'editing'
  | 'trackedChanges'
  | 'fonts'
  | 'collaborationClient';

/** Options for one area. @public */
export interface TelemetryAreaOptions {
  /**
   * Share of events to send, from 0 to 1. Metrics always count every event. Defaults to 1.
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
   * Record one diagnostic yourself, for example from a runtime you created without `module`.
   * Use `module` or `record`, not both, or every event is recorded twice.
   */
  record(event: EditorDiagnostic): void;
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
  collaborationClient: true,
};

function areaOf(event: EditorDiagnostic): TelemetryArea | null {
  switch (event.kind) {
    case 'document.open':
      return 'documentOpen';
    case 'edit.rejected':
      return event.tracked ? 'trackedChanges' : 'editing';
    case 'review.skipped':
      return 'trackedChanges';
    case 'font.failed':
      return 'fonts';
    case 'collab.status':
    case 'collab.participants':
      return 'collaborationClient';
    default:
      return null;
  }
}

/** Events that repeat in bursts, and the fields that make two of them the same. */
function dedupeKey(event: EditorDiagnostic): string | null {
  if (event.kind === 'edit.rejected')
    return `${event.editorSessionId}|${event.code}|${event.origin}|${event.tracked}|${event.command ?? ''}`;
  if (event.kind === 'font.failed') return `${event.editorSessionId}|font|${event.code}`;
  // People join and leave in bursts; inside a window only the latest count matters.
  if (event.kind === 'collab.participants') return `${event.editorSessionId}|participants`;
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
  const include = options.include ?? ALL_AREAS;
  const windowMs = options.dedupeWindowMs ?? 10_000;
  interface Window {
    readonly event: TelemetryEvent;
    repeated: number;
    /** For a participants window: the latest count seen while the window was open. */
    latest?: EditorDiagnostic;
    readonly timer: unknown;
  }
  const windows = new Map<string, Window>();
  let pageHooked = false;
  let closed = false;

  function rate(area: TelemetryArea): number | null {
    const setting = include[area];
    if (!setting) return null;
    if (setting === true) return 1;
    return Math.min(1, Math.max(0, setting.sampleRate ?? 1));
  }

  function hookPage(): void {
    if (pageHooked) return;
    pageHooked = true;
    const target = (globalThis as { addEventListener?: typeof addEventListener }).addEventListener;
    // Read lazily: during server rendering there is no window, and nothing to flush.
    if (typeof target === 'function') target('pagehide', () => void flush());
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
        pipeline.event(enrich(open.latest, pipeline));
    } else if (open.repeated > 0) {
      pipeline.event({ ...open.event, repeated: open.repeated });
    }
  }

  function record(diagnostic: EditorDiagnostic): void {
    if (closed) return;
    const area = areaOf(diagnostic);
    const sampleRate = area ? rate(area) : null;
    if (sampleRate === null) return;
    hookPage();
    recordMetrics(pipeline, diagnostic);
    const key = windowMs > 0 ? dedupeKey(diagnostic) : null;
    const open = key ? windows.get(key) : undefined;
    if (open) {
      if (diagnostic.kind === 'collab.participants') open.latest = diagnostic;
      else open.repeated += 1;
      return;
    }
    if (sampleRate < 1 && Math.random() >= sampleRate) return;
    const event = enrich(diagnostic, pipeline);
    pipeline.event(event);
    if (key) {
      const timer = setTimeout(() => close(key), windowMs);
      (timer as { unref?: () => void }).unref?.();
      windows.set(key, { event, repeated: 0, timer });
    }
  }

  async function flush(): Promise<void> {
    for (const key of [...windows.keys()]) close(key);
    await pipeline.flush();
  }

  return {
    module: Object.freeze({
      id: 'telemetry',
      onDiagnostic: record,
    }),
    record,
    flush,
    async shutdown() {
      for (const key of [...windows.keys()]) close(key);
      closed = true;
      await pipeline.shutdown();
    },
  };
}

/** Adds the hint, the docs link, the version, and the host's resource values. */
function enrich(diagnostic: EditorDiagnostic, pipeline: Pipeline): TelemetryEvent {
  const code = 'code' in diagnostic ? diagnostic.code : undefined;
  return {
    ...diagnostic,
    ...(code ? explainDiagnostic(code) : {}),
    engineVersion: ENGINE_VERSION,
    resource: pipeline.resource,
  };
}

/** Metrics count every event, before sampling and deduplication. */
function recordMetrics(pipeline: Pipeline, event: EditorDiagnostic): void {
  switch (event.kind) {
    case 'document.open':
      if (event.outcome === 'opened') {
        pipeline.metric(METRICS.documentOpens, 1, { outcome: 'opened' });
        pipeline.metric(METRICS.documentOpenDuration, event.durationMs / 1000);
      } else pipeline.metric(METRICS.documentOpens, 1, { outcome: 'rejected', code: event.code });
      return;
    case 'edit.rejected':
      pipeline.metric(METRICS.editRejections, 1, {
        code: event.code,
        origin: event.origin,
        tracked: event.tracked,
      });
      return;
    case 'review.skipped':
      pipeline.metric(METRICS.reviewSkipped, event.count, { code: event.code });
      return;
    case 'font.failed':
      pipeline.metric(METRICS.fontFailures, 1, { code: event.code });
      return;
    case 'collab.status':
      pipeline.metric(METRICS.collabClientStatusTransitions, 1, {
        status: event.status,
        ...(event.code ? { code: event.code } : {}),
      });
      if (event.connectMs !== undefined)
        pipeline.metric(METRICS.collabClientConnectDuration, event.connectMs / 1000);
      return;
    case 'collab.participants':
      pipeline.metric(METRICS.collabClientParticipants, event.count);
  }
}
