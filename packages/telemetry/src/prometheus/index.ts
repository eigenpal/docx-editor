/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * Prometheus: an in-process registry in the text exposition format, and `/metrics` handlers for
 * Node-style servers ({@link metricsHandler}) and Fetch-style servers
 * ({@link fetchMetricsHandler}). No dependency on `prom-client`; a `prom-client` registry
 * merges into the same endpoint.
 *
 * @packageDocumentation
 */
import { prometheusName, type MetricDefinition } from '../metrics.ts';
import type { Attributes, MetricRecord, TelemetryExporter } from '../pipeline.ts';

/** The Prometheus text exposition content type. @public */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** Anything that renders Prometheus text, such as a `prom-client` `Registry`. @public */
export interface PrometheusTextSource {
  metrics(): string | Promise<string>;
}

/** The exporter returned by {@link prometheusRegistry}. @public */
export interface PrometheusRegistry extends TelemetryExporter, PrometheusTextSource {
  /** Every recorded metric in the Prometheus text format. */
  metrics(): string;
  /** Forget every recorded value. */
  reset(): void;
}

interface Series {
  readonly labels: Attributes;
  value: number;
  /** Histogram only: one count per bucket, then `sum`. */
  buckets?: number[];
  sum?: number;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function renderLabels(labels: Attributes, extra?: string): string {
  const parts = Object.keys(labels)
    .sort()
    .map((key) => `${key.replace(/[^a-zA-Z0-9_]/g, '_')}="${escapeLabel(String(labels[key]))}"`);
  if (extra) parts.push(extra);
  return parts.length ? `{${parts.join(',')}}` : '';
}

function seriesKey(labels: Attributes): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}\u0000${String(labels[key])}`)
    .join('\u0001');
}

function formatNumber(value: number): string {
  if (value === Infinity) return '+Inf';
  if (value === -Infinity) return '-Inf';
  return Number.isNaN(value) ? 'NaN' : String(value);
}

/**
 * Collect metrics in memory and render them for Prometheus to scrape.
 *
 * @example
 * ```ts
 * import { prometheusRegistry, metricsHandler } from '@docx-editor.dev/telemetry/prometheus';
 *
 * const metrics = prometheusRegistry();
 * // Pass `metrics` as an exporter, then serve it:
 * app.get('/metrics', metricsHandler(metrics));
 * ```
 *
 * @public
 */
export function prometheusRegistry(): PrometheusRegistry {
  const families = new Map<string, { definition: MetricDefinition; series: Map<string, Series> }>();

  const seriesFor = (definition: MetricDefinition, attributes: Attributes): Series => {
    let family = families.get(definition.name);
    if (!family) {
      family = { definition, series: new Map() };
      families.set(definition.name, family);
    }
    const key = seriesKey(attributes);
    let series = family.series.get(key);
    if (!series) {
      series = { labels: attributes, value: 0 };
      if (definition.kind === 'histogram') {
        series.buckets = new Array((definition.buckets ?? []).length).fill(0);
        series.sum = 0;
      }
      family.series.set(key, series);
    }
    return series;
  };

  return {
    name: 'prometheus',
    metric(record: MetricRecord) {
      const { definition, value, attributes } = record;
      const series = seriesFor(definition, attributes);
      if (definition.kind === 'counter') series.value += Math.max(0, value);
      else if (definition.kind === 'gauge') series.value = value;
      else {
        series.value += 1;
        series.sum! += value;
        (definition.buckets ?? []).forEach((bound, index) => {
          if (value <= bound) series!.buckets![index]! += 1;
        });
      }
    },
    declare(definition, attributes) {
      seriesFor(definition, attributes);
    },
    forget(definition, attributes) {
      families.get(definition.name)?.series.delete(seriesKey(attributes));
    },
    metrics() {
      const lines: string[] = [];
      for (const { definition, series } of families.values()) {
        const name = prometheusName(definition);
        lines.push(`# HELP ${name} ${definition.description.replace(/\n/g, ' ')}`);
        lines.push(`# TYPE ${name} ${definition.kind}`);
        for (const entry of series.values()) {
          if (definition.kind !== 'histogram') {
            lines.push(`${name}${renderLabels(entry.labels)} ${formatNumber(entry.value)}`);
            continue;
          }
          (definition.buckets ?? []).forEach((bound, index) => {
            const le = `le="${formatNumber(bound)}"`;
            lines.push(`${name}_bucket${renderLabels(entry.labels, le)} ${entry.buckets![index]}`);
          });
          lines.push(`${name}_bucket${renderLabels(entry.labels, 'le="+Inf"')} ${entry.value}`);
          lines.push(`${name}_sum${renderLabels(entry.labels)} ${formatNumber(entry.sum!)}`);
          lines.push(`${name}_count${renderLabels(entry.labels)} ${entry.value}`);
        }
      }
      return lines.length ? `${lines.join('\n')}\n` : '';
    },
    reset() {
      families.clear();
    },
  };
}

/** The part of a Node `ServerResponse` the handler writes to. @public */
export interface NodeResponseLike {
  setHeader(name: string, value: string): unknown;
  end(body: string): unknown;
  statusCode?: number;
}

/** Options for {@link metricsHandler} and {@link fetchMetricsHandler}. @public */
export interface MetricsHandlerOptions {
  /**
   * More sources rendered into the same response, such as your `prom-client` registry:
   * `merge: [register]`.
   */
  readonly merge?: readonly PrometheusTextSource[];
}

async function render(
  registry: PrometheusTextSource,
  options: MetricsHandlerOptions
): Promise<string> {
  const texts = await Promise.all(
    [registry, ...(options.merge ?? [])].map((source) => source.metrics())
  );
  return texts.filter(Boolean).join('\n');
}

/**
 * A Node-style handler, `(request, response)`, for Node `http`, Express, and Koa
 * (`ctx.res`). For Fastify, hijack the reply and pass `reply.raw`. For Fetch-style servers,
 * use {@link fetchMetricsHandler}. Protect the route as you protect other operational
 * endpoints.
 *
 * @example
 * ```ts
 * app.get('/metrics', metricsHandler(metrics, { merge: [promClient.register] })); // Express
 *
 * fastify.get('/metrics', (request, reply) => {
 *   reply.hijack();
 *   return metricsHandler(metrics)(request.raw, reply.raw);
 * });
 * ```
 *
 * @public
 */
export function metricsHandler(
  registry: PrometheusTextSource,
  options: MetricsHandlerOptions = {}
): (request: unknown, response: NodeResponseLike) => Promise<void> {
  return async (_request, response) => {
    let body: string;
    try {
      body = await render(registry, options);
    } catch {
      // A merged registry that throws must not crash the process through an Express handler.
      response.statusCode = 500;
      response.end('metrics unavailable');
      return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', PROMETHEUS_CONTENT_TYPE);
    response.end(body);
  };
}

/**
 * A Fetch-style handler that returns a `Response`, for Next.js route handlers, Hono, Bun,
 * Deno, and workers. It ignores its argument, so a Hono context works as well as a `Request`.
 *
 * @example
 * ```ts
 * // app/metrics/route.ts
 * export const GET = fetchMetricsHandler(metrics);
 * ```
 *
 * @public
 */
export function fetchMetricsHandler(
  registry: PrometheusTextSource,
  options: MetricsHandlerOptions = {}
): (request?: unknown) => Promise<Response> {
  return async () => {
    try {
      return new Response(await render(registry, options), {
        headers: { 'Content-Type': PROMETHEUS_CONTENT_TYPE },
      });
    } catch {
      return new Response('metrics unavailable', { status: 500 });
    }
  };
}

export type { TelemetryExporter } from '../pipeline.ts';
