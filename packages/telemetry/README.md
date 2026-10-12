# @docx-editor.dev/telemetry

Anonymous diagnostics, metrics, and error reporting for `@docx-editor.dev` editors and collaboration servers. Send them to OpenTelemetry, Prometheus, Sentry, or your own logger.

Every event contains only codes, booleans, bucketed sizes and counts, and timings. Document text, file names, author names, font names, and room names are never sent. The package sends nothing by itself: you choose the exporters.

## Install the package

The package is available in version 2.29.0 and later.

```sh
npm install @docx-editor.dev/telemetry @docx-editor.dev/core
```

Add `@opentelemetry/api` or `@hocuspocus/server` only for the exporters and server integrations that you use. The Sentry exporter takes the Sentry SDK your app already loads.

## Editors

```ts
import { createTelemetry } from '@docx-editor.dev/telemetry';
import { otelExporter } from '@docx-editor.dev/telemetry/otel';
import { sentryExporter } from '@docx-editor.dev/telemetry/sentry';
import * as Sentry from '@sentry/react';

export const telemetry = createTelemetry({
  // Sentry for failures, OpenTelemetry for metrics such as typing delay.
  exporters: [sentryExporter(Sentry), otelExporter()],
  include: {
    documentOpen: true,
    trackedChanges: true,
    editing: true,
    performance: true,
  },
  consent: () => consentManager.analytics === true, // your consent manager
});

// Outside your component, so the array is stable across renders:
export const MODULES = [telemetry.module];
// <DocxEditor document={bytes} modules={MODULES} />
```

A refused tracked change explains itself. Here, an agent deleted a picture through the editing API while changes were tracked:

```text
[docx-editor] edit refused: edit.tracked-operation-unsupported (automation, tracked)
  This editing API operation cannot be recorded as a tracked change, so nothing was applied. Use text edits such as range.insertText or range.delete, which tracking records. Never switch tracking off to make the edit succeed.
  https://docx-editor.dev/docs/2.x/guides/diagnostics#edit-tracked-operation-unsupported
```

The `performance` area measures typing delay and engine layout and paint times. Send it to an exporter that records metrics, such as `otelExporter()`. The Sentry exporter records performance only as breadcrumbs.

## Collaboration servers

```ts
import { Server } from '@hocuspocus/server';
import { withCollaborationTelemetry } from '@docx-editor.dev/telemetry/hocuspocus';
import { metricsHandler, prometheusRegistry } from '@docx-editor.dev/telemetry/prometheus';

const metrics = prometheusRegistry();
const { config, rooms } = withCollaborationTelemetry(
  { port: 1234, onAuthenticate, onLoadDocument, onStoreDocument },
  { exporters: [metrics] }
);
new Server(config);

app.get('/metrics', metricsHandler(metrics));
app.get('/admin/rooms', requireAdmin, (_request, response) => response.json(rooms.list()));
```

For other Yjs servers, use `roomTelemetry` from `@docx-editor.dev/telemetry/server`.

## Dashboards and alerts

Ready Grafana dashboards show input delay, engine work, opens, and refused edits from your editors, and rooms, people, memory, and refusals from your collaboration server. Prometheus alert rules cover clear faults.

![The Editor experience dashboard: input delay median and 95th percentile, presses over 1 second, opens succeeding, open time, browser tabs reporting, unexpected refusals, and charts of input delay over time, by delay band, and by document size.](https://raw.githubusercontent.com/eigenpal/docx-editor/main/assets/observability/screenshots/editor-experience.png)

Download [`editor-experience.json`](https://raw.githubusercontent.com/eigenpal/docx-editor/main/assets/observability/grafana/editor-experience.json), [`collaboration.json`](https://raw.githubusercontent.com/eigenpal/docx-editor/main/assets/observability/grafana/collaboration.json), and [`rules.yml`](https://raw.githubusercontent.com/eigenpal/docx-editor/main/assets/observability/prometheus/rules.yml), then import them into Grafana and Prometheus. For the setup each one needs, see [Dashboards and alerts](https://docx-editor.dev/docs/2.x/telemetry/dashboards).

## Entry points

| Entry | Contents |
| --- | --- |
| `@docx-editor.dev/telemetry` | `createTelemetry`, `consoleExporter`, `callbackExporter`, `memoryExporter`, `isFailure`, `explainDiagnostic`, the metric catalog |
| `@docx-editor.dev/telemetry/otel` | `otelExporter`, through your OpenTelemetry SDK |
| `@docx-editor.dev/telemetry/sentry` | `sentryExporter`, `dropEditorBreadcrumbs`, `EDITOR_SELECTORS` |
| `@docx-editor.dev/telemetry/prometheus` | `prometheusRegistry`, `metricsHandler`, `fetchMetricsHandler`, for server processes. Browser metrics go through `otelExporter()` and an OpenTelemetry collector. |
| `@docx-editor.dev/telemetry/server` | `roomTelemetry`, `hmacRoomLabel` |
| `@docx-editor.dev/telemetry/hocuspocus` | `withCollaborationTelemetry`, `serveMetrics`, `requireBearerToken`, `hmacRoomLabel` |

For the full guide, see [Telemetry](https://docx-editor.dev/docs/2.x/telemetry).

## License

EigenPal Pro License. See [LICENSE.md](./LICENSE.md).
