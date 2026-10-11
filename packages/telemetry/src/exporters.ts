/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import type { MetricRecord, TelemetryEvent, TelemetryExporter } from './pipeline.ts';

/**
 * Send each event to your own function: Datadog RUM, PostHog, a logger, or an API route.
 *
 * @example
 * ```ts
 * callbackExporter((event) => datadogRum.addError(event.kind, event));
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

/** The headline for an event, such as `edit refused: edit.read-only (command, untracked)`. */
export function describeEvent(event: TelemetryEvent): string {
  const repeated = event.repeated ? ` (and ${event.repeated} more)` : '';
  switch (event.kind) {
    case 'document.open':
      return event.outcome === 'opened'
        ? `document opened: ${event.pagesBucket} pages, ${event.sizeBucket}, ${event.durationMs} ms`
        : `document refused: ${event.code}`;
    case 'edit.rejected': {
      const via = event.command ? `${event.origin} ${event.command}` : event.origin;
      return `edit refused: ${event.code} (${via}, ${event.tracked ? 'tracked' : 'untracked'})${repeated}`;
    }
    case 'review.skipped':
      return `tracked changes skipped: ${event.code} x${event.count}`;
    case 'font.failed':
      return `font substituted: ${event.code}${repeated}`;
    case 'collab.participants':
      return `collaboration: ${event.count} people in the room`;
    case 'collab.status': {
      const code = event.code ? `: ${event.code}` : '';
      const connected = event.connectMs !== undefined ? ` after ${event.connectMs} ms` : '';
      return `collaboration ${event.status}${code}${event.recovering ? ' (recovering)' : ''}${connected}`;
    }
  }
}

/** Whether an event is a failure, which consoles print as a warning. */
export function isFailure(event: TelemetryEvent): boolean {
  switch (event.kind) {
    case 'document.open':
      return event.outcome === 'rejected';
    case 'collab.participants':
      return false;
    case 'collab.status':
      return event.status === 'error';
    default:
      return true;
  }
}

/**
 * Print each event with its hint and docs link. Use it during development to see why a
 * document did not open or why a tracked change was refused.
 *
 * @example
 * ```ts
 * createTelemetry({ exporters: [consoleExporter()] });
 * // [docx-editor] edit refused: edit.tracked-drawing-delete-unsupported (input, tracked)
 * //   Deleting a drawing is not supported while changes are tracked. ...
 * //   https://docx-editor.dev/docs/2.x/guides/diagnostics#edit
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
      (isFailure(event) ? out.warn : out.info).call(out, lines.join('\n'));
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
