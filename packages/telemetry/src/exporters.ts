/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import type { TimingSummary } from '@docx-editor.dev/core';
import type { MetricRecord, TelemetryEvent, TelemetryExporter } from './pipeline.ts';

/**
 * Send each event to your own function: Datadog RUM, PostHog, a logger, or an API route.
 *
 * `onMetric` receives every measurement. A performance summary arrives as one histogram sample
 * for each timing in it, at the middle of the timing's band, so the bucket counts are exact.
 * To chart percentiles, read `p50Ms` and `p95Ms` from the `performance` event instead.
 *
 * @example
 * ```ts
 * callbackExporter((event) =>
 *   isFailure(event)
 *     ? datadogRum.addError(new Error(event.kind), event)
 *     : datadogRum.addAction(event.kind, event)
 * );
 * ```
 *
 * @public
 */
export function callbackExporter(
  onEvent: (event: TelemetryEvent) => void,
  onMetric?: (record: MetricRecord) => void
): TelemetryExporter {
  return { name: 'callback', event: onEvent, ...(onMetric ? { metric: onMetric } : {}) };
}

/** Options for {@link consoleExporter}. @public */
export interface ConsoleExporterOptions {
  /** Also print every metric measurement. Defaults to `false`. */
  readonly metrics?: boolean;
  /** Where to print. Defaults to the global `console`. */
  readonly console?: Pick<Console, 'info' | 'warn'>;
}

/** The anonymous detail of a failure, as ` [cause, part]`, or nothing. */
function detailText(event: TelemetryEvent): string {
  const fields = event as unknown as Record<string, unknown>;
  const parts = ['operation', 'changeKind', 'formattingKind', 'cause', 'errorName', 'stage', 'part']
    .map((key) => fields[key])
    .filter((value): value is string => typeof value === 'string');
  return parts.length ? ` [${parts.join(', ')}]` : '';
}

/** The headline for an event, such as `edit refused: edit.read-only (command, untracked)`. */
export function describeEvent(event: TelemetryEvent): string {
  const repeated = event.repeated ? ` (and ${event.repeated} more)` : '';
  switch (event.kind) {
    case 'document.open':
      if (event.outcome === 'rejected')
        return `document refused: ${event.code}${detailText(event)}`;
      return event.pagesBucket === undefined
        ? `document opened: ${event.sizeBucket}, ${event.durationMs} ms`
        : `document opened: ${event.pagesBucket} pages, ${event.sizeBucket}, ${event.durationMs} ms`;
    case 'edit.rejected': {
      const via = event.command ? `${event.origin} ${event.command}` : event.origin;
      return `edit refused: ${event.code}${detailText(event)} (${via}, ${event.tracked ? 'tracked' : 'untracked'})${repeated}`;
    }
    case 'review.skipped':
      return `tracked changes skipped: ${event.code}${detailText(event)} x${event.count}`;
    case 'font.failed':
      return `font substituted: ${event.code}${repeated}`;
    case 'history':
      return `undo history: ${event.code}${repeated}`;
    case 'custom-node':
      return `custom node payload unreadable: ${event.code}${repeated}`;
    case 'collab.participants':
      return `collaboration: ${event.count} ${event.count === 1 ? 'person' : 'people'} in the room`;
    case 'collab.status': {
      const code = event.code ? `: ${event.code}` : '';
      const connected = event.connectMs !== undefined ? ` after ${event.connectMs} ms` : '';
      return `collaboration ${event.status}${code}${event.recovering ? ' (recovering)' : ''}${connected}`;
    }
    case 'performance': {
      const parts = [
        timingText('key presses and clicks', event.interaction),
        timingText('layout', event.layout),
        timingText('paint', event.paint),
      ].filter(Boolean);
      const pages = event.pagesBucket === undefined ? '' : `, ${event.pagesBucket} pages`;
      return `performance over ${Math.round(event.windowMs / 1000)} s${pages}: ${parts.join('; ')}`;
    }
    case 'document.save':
      return event.outcome === 'saved'
        ? `document saved: ${event.sizeBucket}, ${event.durationMs} ms`
        : `save failed: ${event.code}${detailText(event)} after ${event.durationMs} ms`;
    case 'session': {
      if (event.phase === 'start') return 'editor session started';
      const edits = event.inputEdits + event.commandEdits + event.automationEdits;
      const activity = `${Math.round(event.activeMs / 1000)} s active, ${edits} ${edits === 1 ? 'edit' : 'edits'}`;
      return event.phase === 'end'
        ? `editor session ended after ${Math.round(event.durationMs / 1000)} s: ${activity}`
        : `editor activity over ${Math.round(event.durationMs / 1000)} s: ${activity}`;
    }
  }
}

/** `layout p50 4 ms, p95 12 ms, max 30 ms (x120)`, or an empty string. */
function timingText(label: string, summary?: TimingSummary): string {
  if (!summary) return '';
  return `${label} p50 ${summary.p50Ms} ms, p95 ${summary.p95Ms} ms, max ${summary.maxMs} ms (x${summary.count})`;
}

/**
 * Whether an event is a failure: a refused open, a refused edit other than an expected one
 * (a stale range, a read-only document, protected content, a session or refresh not ready
 * yet), an unreadable payload, a font that did not load, or a collaboration error. A missing
 * font that was substituted and a tracked change someone else already reviewed are not. Use it
 * in a callback to send failures as errors and the rest as actions or logs.
 *
 * @example
 * ```ts
 * callbackExporter((event) => {
 *   const code = 'code' in event ? event.code : undefined;
 *   if (isFailure(event)) myLogger.error(event.kind, { code, hint: event.hint });
 *   else myLogger.info(event.kind);
 * });
 * ```
 *
 * A deduplication summary returns `false`: it repeats an event already reported. To total
 * failures with summaries included, use {@link failureCount}.
 *
 * @public
 */
export function isFailure(event: TelemetryEvent): boolean {
  return event.repeated === undefined && isFailureKind(event);
}

/**
 * How many failures an event adds to a failure total: `0` when it is not a failure, `1` for a
 * failure, and `repeated` for a deduplication summary of one. The sum over every event a
 * client sends equals the number of failures the editor reported, which {@link isFailure}
 * alone undercounts. Sampling still applies: a sampled area sends a share of its events.
 *
 * @example
 * ```ts
 * let failures = 0;
 * callbackExporter((event) => {
 *   failures += failureCount(event);
 * });
 * ```
 *
 * @public
 */
export function failureCount(event: TelemetryEvent): number {
  if (!isFailureKind(event)) return 0;
  return event.repeated ?? 1;
}

/** Whether the event's kind and code are a failure, for the first event or its summary. */
function isFailureKind(event: TelemetryEvent): boolean {
  switch (event.kind) {
    case 'document.open':
      return event.outcome === 'rejected';
    case 'document.save':
      return event.outcome === 'rejected';
    case 'collab.participants':
    case 'history':
    case 'performance':
    case 'session':
      return false;
    case 'collab.status':
      // An expired token and a compacted room end in a rejoin; they are not faults.
      return (
        event.status === 'error' &&
        event.code !== 'collab.authentication-failed' &&
        event.code !== 'collab.room-generation-changed'
      );
    case 'edit.rejected':
      return !EXPECTED_REFUSALS.has(event.code);
    case 'font.failed':
      // A font the app does not ship is substituted; the document still renders.
      return event.code !== 'font.missing';
    case 'review.skipped':
      // A tracked change another person already accepted or rejected.
      return event.code !== 'review.stale-revision';
    default:
      return true;
  }
}

/**
 * Refusals that are part of normal use, not faults: a stale range the guide says to read
 * again, typing in a read-only document, a refresh or a session that is not ready yet.
 */
const EXPECTED_REFUSALS: ReadonlySet<string> = new Set([
  'edit.stale-target',
  'edit.read-only',
  'edit.protected-content',
  'edit.refresh-in-progress',
  'edit.collaboration-not-ready',
]);

/**
 * Print each event with its hint and docs link. Use it during development to see why a
 * document did not open or why a tracked change was refused.
 *
 * @example
 * ```ts
 * createTelemetry({ exporters: [consoleExporter()] });
 * // An agent deletes a picture while changes are tracked:
 * // [docx-editor] edit refused: edit.tracked-operation-unsupported (automation, tracked)
 * //   This editing API operation cannot be recorded as a tracked change, so nothing was ...
 * //   https://docx-editor.dev/docs/2.x/guides/diagnostics#edit-tracked-operation-unsupported
 * ```
 *
 * @public
 */
export function consoleExporter(options: ConsoleExporterOptions = {}): TelemetryExporter {
  const out = options.console ?? console;
  return {
    name: 'console',
    event(event) {
      const lines = [`[docx-editor] ${describeEvent(event)}`];
      if (event.hint) lines.push(`  ${event.hint}`);
      if (event.docs) lines.push(`  ${event.docs}`);
      const warn = isFailure(event) || (event.kind === 'performance' && event.code !== undefined);
      (warn ? out.warn : out.info).call(out, lines.join('\n'));
    },
    ...(options.metrics
      ? {
          metric(record: MetricRecord) {
            out.info(`[docx-editor] ${record.definition.name} ${record.value}`, record.attributes);
          },
        }
      : {}),
  };
}

/** An exporter that keeps what it receives. Returned by {@link memoryExporter}. @public */
export interface MemoryExporter extends TelemetryExporter {
  readonly events: readonly TelemetryEvent[];
  readonly metrics: readonly MetricRecord[];
  /** Forget everything received so far. */
  clear(): void;
}

/**
 * Keep events and metrics in memory, for tests in your own suite.
 *
 * @example
 * ```ts
 * const memory = memoryExporter();
 * const telemetry = createTelemetry({ exporters: [memory] });
 * // ...open a file that fails...
 * expect(memory.events).toContainEqual(
 *   expect.objectContaining({ code: 'open.missing-main-document' })
 * );
 * ```
 *
 * @public
 */
export function memoryExporter(): MemoryExporter {
  const events: TelemetryEvent[] = [];
  const metrics: MetricRecord[] = [];
  return {
    name: 'memory',
    events,
    metrics,
    event: (event) => void events.push(event),
    metric: (record) => void metrics.push(record),
    clear() {
      events.length = 0;
      metrics.length = 0;
    },
  };
}
