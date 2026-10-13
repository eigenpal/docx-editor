// The whole integration: one telemetry client, created once, outside any component.
//
// Events and metrics go to your OpenTelemetry SDK (metrics to Prometheus or Grafana, spans to
// your tracing backend), to Sentry when a DSN is set, and to the console in development.
// Every event is anonymous: codes, enums, and bucketed numbers, never document content.
import * as Sentry from '@sentry/react';
import { consoleExporter, createTelemetry } from '@docx-editor.dev/telemetry';
import { otelExporter } from '@docx-editor.dev/telemetry/otel';
import {
  EDITOR_SELECTORS,
  dropEditorBreadcrumbs,
  sentryExporter,
} from '@docx-editor.dev/telemetry/sentry';
import { startBrowserOpenTelemetry } from './opentelemetry';
import { createEventLog } from '../../telemetry-stack/client/event-log';

// Your app already has this: the OpenTelemetry SDK with its global providers.
startBrowserOpenTelemetry({
  serviceName: 'telemetry-single-user',
  endpoint: import.meta.env.VITE_OTLP_ENDPOINT ?? 'http://localhost:4318',
});

// Your app already has this too, when it uses Sentry. The editor shows the document, so Replay
// blocks it, and click breadcrumbs from inside it are dropped.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    integrations: [Sentry.replayIntegration({ block: [...EDITOR_SELECTORS] })],
    beforeBreadcrumb: dropEditorBreadcrumbs,
  });
}

/** Your consent manager. The example keeps the choice in memory and starts with consent. */
export const consent = { analytics: true };

/** The events this page sent, for the panel beside the editor. */
export const eventLog = createEventLog();

// Labels the dashboards filter and compare by. Few distinct values each, so they may label
// metrics. `?version=` lets the simulation show two releases side by side.
const release = {
  'deployment.environment': import.meta.env.MODE,
  'app.version': new URLSearchParams(location.search).get('version') ?? '1.0.0',
};

export const telemetry = createTelemetry({
  attributes: release,
  metricLabels: ['deployment.environment', 'app.version'],
  exporters: [
    otelExporter(),
    ...(sentryDsn ? [sentryExporter(Sentry)] : []),
    ...(import.meta.env.DEV ? [consoleExporter()] : []),
    eventLog.exporter,
  ],
  include: {
    documentOpen: true,
    documentSave: true,
    sessions: true,
    editing: true,
    trackedChanges: true,
    fonts: true,
    history: true,
    performance: true,
  },
  consent: () => consent.analytics,
  resource: { 'service.name': 'telemetry-single-user' },
});
