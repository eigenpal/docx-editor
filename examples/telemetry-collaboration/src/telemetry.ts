// The same telemetry client as one-person editing, with the collaboration area on: status
// changes and their failure codes, connect time, and the number of people in the room.
// The room server reports its own side in `server/server.ts`.
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

startBrowserOpenTelemetry({
  serviceName: 'telemetry-collaboration',
  endpoint: import.meta.env.VITE_OTLP_ENDPOINT ?? 'http://localhost:4318',
});

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    integrations: [Sentry.replayIntegration({ block: [...EDITOR_SELECTORS] })],
    beforeBreadcrumb: dropEditorBreadcrumbs,
  });
}

export const eventLog = createEventLog();

export const telemetry = createTelemetry({
  exporters: [
    otelExporter(),
    ...(sentryDsn ? [sentryExporter(Sentry)] : []),
    ...(import.meta.env.DEV ? [consoleExporter()] : []),
    eventLog.exporter,
  ],
  // Omitted, `include` turns every area on, collaboration included.
  resource: { 'service.name': 'telemetry-collaboration' },
});
