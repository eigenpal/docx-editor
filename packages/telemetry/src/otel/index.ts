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
import { nodeEnv } from '../env.ts';
import { isFailure } from '../exporters.ts';
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

type Gauge = {
  record(value: number, attributes?: OtelAttributes): void;
  forget(attributes: OtelAttributes): void;
};

/**
 * Best effort: the API exports no way to ask whether an SDK is registered, so this reads the
 * no-op class name, which a minified copy of the API may not keep.
 */
function isNoop(provider: unknown): boolean {
  const delegate = (provider as { getDelegate?: () => unknown }).getDelegate?.() ?? provider;
  return /^Noop/.test((delegate as { constructor?: { name?: string } })?.constructor?.name ?? '');
}

let warnedNoop = false;
function warnWhenNoop(meterProvider: MeterProvider, tracerProvider: TracerProvider): void {
  const env = nodeEnv();
  if (warnedNoop || env === 'production') return;
  if (!isNoop(meterProvider) || !isNoop(tracerProvider)) return;
  warnedNoop = true;
  console.warn(
    '[docx-editor telemetry] otelExporter found no OpenTelemetry SDK. Register a MeterProvider ' +
      'and a TracerProvider before creating the exporter, or pass them as options. Until then ' +
      'every measurement is dropped.'
  );
}

/**
 * An observable gauge holding the last value per attribute set. Observable rather than
 * synchronous, so a series that no longer exists, such as a closed room's, can be dropped.
 */
function createGauge(
  meter: Meter,
  definition: MetricDefinition,
  last: Map<string, { value: number; attributes: OtelAttributes }>
): Gauge {
  meter
    .createObservableGauge(definition.name, {
      unit: definition.unit,
      description: definition.description,
    })
    .addCallback((result) => {
      for (const { value, attributes } of last.values()) result.observe(value, attributes);
    });
  return {
    record(value, attributes = {}) {
      last.set(attributeKey(attributes), { value, attributes });
    },
    forget(attributes) {
      last.delete(attributeKey(attributes));
    },
  };
}

function attributeKey(attributes: OtelAttributes): string {
  return JSON.stringify(
    Object.keys(attributes)
      .sort()
      .map((key) => [key, attributes[key]])
  );
}

function eventAttributes(event: TelemetryEvent): OtelAttributes {
  // Your resource values and identifiers keep their own keys, such as `room.id`.
  const attributes: OtelAttributes = { ...event.resource, ...event.attributes };
  for (const [key, value] of Object.entries(event)) {
    if (key === 'resource' || key === 'attributes' || key === 'hint' || key === 'docs') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      attributes[`docx_editor.${key}`] = value;
    else if (key === 'shape' && value && typeof value === 'object') {
      for (const [field, bucket] of Object.entries(value))
        if (typeof bucket === 'string') attributes[`docx_editor.shape.${field}`] = bucket;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // A timing summary: its numbers, such as `docx_editor.layout.p95Ms`. Bands go to metrics.
      for (const [field, number] of Object.entries(value))
        if (typeof number === 'number') attributes[`docx_editor.${key}.${field}`] = number;
    }
  }
  return attributes;
}

/**
 * Record metrics and traces with OpenTelemetry. The exporter reads the global providers at
 * each use, so it can be created before your SDK starts.
 *
 * Metrics use the names in `METRICS`. Each document open becomes a
 * `docx_editor.document.open` span, with an error status when it is refused. Other events
 * become events on the active span; without one, a failure gets a short span of its own.
 *
 * @example
 * ```ts
 * import { createTelemetry } from '@docx-editor.dev/telemetry';
 * import { otelExporter } from '@docx-editor.dev/telemetry/otel';
 *
 * // Before or after your OpenTelemetry SDK starts: the exporter reads the global providers at
 * // each use.
 * export const telemetry = createTelemetry({ exporters: [otelExporter()] });
 * ```
 *
 * @public
 */
export function otelExporter(options: OtelExporterOptions = {}): TelemetryExporter {
  const scope = options.scope ?? SCOPE;
  // Read the providers at each use, not once: telemetry is often created at module scope, and
  // an SDK that registers later must still receive every measurement after it starts.
  const meterProviderNow = () => options.meterProvider ?? metrics.getMeterProvider();
  const tracerProviderNow = () => options.tracerProvider ?? trace.getTracerProvider();
  let meterProvider: MeterProvider | undefined;
  let meter: Meter | undefined;
  const instruments = new Map<string, Counter | Histogram | Gauge>();
  /** Gauge values by metric, kept across a provider change so the new meter reports them. */
  const gaugeValues = new Map<string, Map<string, { value: number; attributes: OtelAttributes }>>();
  let checked = false;

  function gaugeValuesOf(name: string) {
    let values = gaugeValues.get(name);
    if (!values) {
      values = new Map();
      gaugeValues.set(name, values);
    }
    return values;
  }

  function currentMeter(): Meter {
    const provider = meterProviderNow();
    if (provider !== meterProvider || !meter) {
      meterProvider = provider;
      meter = provider.getMeter(scope);
      instruments.clear();
    }
    return meter;
  }

  function instrument(definition: MetricDefinition): Counter | Histogram | Gauge {
    const meter = currentMeter();
    if (!checked) {
      checked = true;
      // Look again a little later: an SDK that starts just after the first measurement is fine.
      const timer = setTimeout(() => warnWhenNoop(meterProviderNow(), tracerProviderNow()), 5_000);
      (timer as { unref?: () => void }).unref?.();
    }
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
          : createGauge(meter, definition, gaugeValuesOf(definition.name));
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
        const span = tracerProviderNow()
          .getTracer(scope)
          .startSpan(
            'docx_editor.document.open',
            { startTime: start, attributes: eventAttributes(event) },
            options.parentContext?.()
          );
        if (event.outcome === 'rejected')
          span.setStatus({ code: SpanStatusCode.ERROR, message: event.code });
        span.end(event.time);
        return;
      }
      const active = trace.getActiveSpan();
      if (active) {
        active.addEvent(`docx_editor.${event.kind}`, eventAttributes(event));
        return;
      }
      // Browsers rarely have an active span: a failure gets a short span of its own, so it is
      // visible in traces too. Deduplication keeps bursts to one span per window.
      if (!isFailure(event)) return;
      const span = tracerProviderNow()
        .getTracer(scope)
        .startSpan(
          `docx_editor.${event.kind}`,
          { startTime: event.time, attributes: eventAttributes(event) },
          options.parentContext?.()
        );
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'code' in event ? event.code : event.kind,
      });
      span.end(event.time);
    },
    forget(definition, attributes) {
      gaugeValues.get(definition.name)?.delete(attributeKey(attributes as OtelAttributes));
    },
    async flush() {
      // The API types omit `forceFlush`; the SDK providers have it. Without it, a browser
      // batch processor loses what it holds when the page closes.
      const flushable = (provider: unknown) => {
        const target = (provider as { getDelegate?: () => unknown }).getDelegate?.() ?? provider;
        return (target as { forceFlush?: () => Promise<void> }).forceFlush?.();
      };
      await Promise.all([flushable(meterProviderNow()), flushable(tracerProviderNow())]);
    },
  };
}

export type { TelemetryExporter } from '../pipeline.ts';
