// The browser OpenTelemetry SDK the telemetry examples send to. Your app has its own setup;
// `otelExporter()` uses whichever global providers it registers.
//
// Metrics go to an OpenTelemetry Protocol (OTLP) collector over HTTP every few seconds, and
// spans in batches. `examples/telemetry-stack` runs that collector, with Prometheus, Grafana,
// and Jaeger behind it.
import { metrics, trace } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';

export interface BrowserOpenTelemetryOptions {
  /** Becomes the `job` label in Prometheus. */
  readonly serviceName: string;
  /** The collector's OTLP HTTP endpoint, such as `http://localhost:4318`. */
  readonly endpoint: string;
  /** How often metrics are sent. Defaults to 10 seconds. */
  readonly exportIntervalMs?: number;
}

/** Register global meter and tracer providers that send to an OTLP collector. */
export function startBrowserOpenTelemetry(options: BrowserOpenTelemetryOptions): void {
  const resource = resourceFromAttributes({
    'service.name': options.serviceName,
    // Each tab sends its own cumulative totals; a distinct instance keeps them apart.
    'service.instance.id': crypto.randomUUID(),
  });
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${options.endpoint}/v1/metrics` }),
        exportIntervalMillis: options.exportIntervalMs ?? 10_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);
  const tracerProvider = new WebTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${options.endpoint}/v1/traces` })),
    ],
  });
  trace.setGlobalTracerProvider(tracerProvider);
  // A closing tab sends what it holds. The telemetry client flushes on the same events.
  addEventListener('pagehide', () => {
    void meterProvider.forceFlush();
    void tracerProvider.forceFlush();
  });
}
