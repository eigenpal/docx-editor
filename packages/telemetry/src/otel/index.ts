/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * OpenTelemetry: metrics and traces through the OpenTelemetry SDK you already run. This entry
 * depends only on `@opentelemetry/api`; your SDK decides where data goes (OTLP to a
 * collector, Datadog, Grafana, Honeycomb, New Relic, and others).
 *
 * @packageDocumentation
 */
import {
  SpanStatusCode,
  metrics,
  trace,
  type Attributes as OtelAttributes,
  type Context,
  type Counter,
  type Histogram,
  type Meter,
  type MeterProvider,
  type TracerProvider,
} from '@opentelemetry/api';
import type { MetricDefinition } from '../metrics.ts';
import type { MetricRecord, TelemetryEvent, TelemetryExporter } from '../pipeline.ts';

/** Options for {@link otelExporter}. @public */
export interface OtelExporterOptions {
  /** Defaults to the global provider your SDK registered. */
  readonly meterProvider?: MeterProvider;
  /** Defaults to the global provider your SDK registered. */
  readonly tracerProvider?: TracerProvider;
  /**
   * The parent of each `docx_editor.document.open` span. Browsers have no async context, so
   * without this the span is a root span. Return your page-load or route span's context.
   */
  readonly parentContext?: () => Context | undefined;
  /** Instrumentation scope name. Defaults to `@docx-editor.dev/telemetry`. */
  readonly scope?: string;
}

const SCOPE = '@docx-editor.dev/telemetry';

type Gauge = { record(value: number, attributes?: OtelAttributes): void };

function isNoop(provider: unknown): boolean {
  const delegate = (provider as { getDelegate?: () => unknown }).getDelegate?.() ?? provider;
  return /^Noop/.test((delegate as { constructor?: { name?: string } })?.constructor?.name ?? '');
}

let warnedNoop = false;
function warnWhenNoop(meterProvider: MeterProvider, tracerProvider: TracerProvider): void {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.NODE_ENV;
  if (warnedNoop || env === 'production') return;
  if (!isNoop(meterProvider) || !isNoop(tracerProvider)) return;
  warnedNoop = true;
  console.warn(
    '[docx-editor telemetry] otelExporter found no OpenTelemetry SDK. Register a MeterProvider ' +
      'and a TracerProvider before creating the exporter, or pass them as options. Until then ' +
      'every measurement is dropped.'
  );
}

/** A gauge from `createGauge`, or an observable gauge holding the last value per attribute set. */
function createGauge(meter: Meter, definition: MetricDefinition): Gauge {
  const options = { unit: definition.unit, description: definition.description };
  const sync = (meter as { createGauge?: (name: string, o: typeof options) => Gauge }).createGauge;
  if (typeof sync === 'function') return sync.call(meter, definition.name, options);
  const last = new Map<string, { value: number; attributes: OtelAttributes }>();
  meter.createObservableGauge(definition.name, options).addCallback((result) => {
    for (const { value, attributes } of last.values()) result.observe(value, attributes);
  });
  return {
    record(value, attributes = {}) {
      last.set(JSON.stringify(attributes), { value, attributes });
    },
  };
}

function eventAttributes(event: TelemetryEvent): OtelAttributes {
  const attributes: OtelAttributes = { ...event.resource };
  for (const [key, value] of Object.entries(event)) {
    if (key === 'resource' || key === 'hint' || key === 'docs') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      attributes[`docx_editor.${key}`] = value;
  }
  return attributes;
}

/**
 * Record metrics and traces with OpenTelemetry.
 *
 * Metrics use the names in `METRICS`. Each document open becomes a
 * `docx_editor.document.open` span, with an error status when it is refused. Other failures
 * become events on the active span, when one exists.
 *
 * @example
 * ```ts
 * import { createTelemetry } from '@docx-editor.dev/telemetry';
 * import { otelExporter } from '@docx-editor.dev/telemetry/otel';
 *
 * // After your OpenTelemetry SDK starts:
 * export const telemetry = createTelemetry({ exporters: [otelExporter()] });
 * ```
 *
 * @public
 */
export function otelExporter(options: OtelExporterOptions = {}): TelemetryExporter {
  const meterProvider = options.meterProvider ?? metrics.getMeterProvider();
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  warnWhenNoop(meterProvider, tracerProvider);
  const scope = options.scope ?? SCOPE;
  const meter = meterProvider.getMeter(scope);
  const tracer = tracerProvider.getTracer(scope);
  const instruments = new Map<string, Counter | Histogram | Gauge>();

  function instrument(definition: MetricDefinition): Counter | Histogram | Gauge {
    const known = instruments.get(definition.name);
    if (known) return known;
    const base = { unit: definition.unit, description: definition.description };
    const created =
      definition.kind === 'counter'
        ? meter.createCounter(definition.name, base)
        : definition.kind === 'histogram'
          ? meter.createHistogram(definition.name, {
              ...base,
              ...(definition.buckets
                ? { advice: { explicitBucketBoundaries: [...definition.buckets] } }
                : {}),
            })
          : createGauge(meter, definition);
    instruments.set(definition.name, created);
    return created;
  }

  return {
    name: 'otel',
    metric(record: MetricRecord) {
      const target = instrument(record.definition);
      const attributes = record.attributes as OtelAttributes;
      if ('add' in target) target.add(record.value, attributes);
      else target.record(record.value, attributes);
    },
    event(event) {
      if (event.kind === 'document.open') {
        const start = event.time - (event.outcome === 'opened' ? event.durationMs : 0);
        const span = tracer.startSpan(
          'docx_editor.document.open',
          { startTime: start, attributes: eventAttributes(event) },
          options.parentContext?.()
        );
        if (event.outcome === 'rejected')
          span.setStatus({ code: SpanStatusCode.ERROR, message: event.code });
        span.end(event.time);
        return;
      }
      trace.getActiveSpan()?.addEvent(`docx_editor.${event.kind}`, eventAttributes(event));
    },
    async flush() {
      // The API types omit `forceFlush`; the SDK providers have it. Without it, a browser
      // batch processor loses what it holds when the page closes.
      const flushable = (provider: unknown) => {
        const target = (provider as { getDelegate?: () => unknown }).getDelegate?.() ?? provider;
        return (target as { forceFlush?: () => Promise<void> }).forceFlush?.();
      };
      await Promise.all([flushable(meterProvider), flushable(tracerProvider)]);
    },
  };
}

export type { TelemetryExporter } from '../pipeline.ts';
