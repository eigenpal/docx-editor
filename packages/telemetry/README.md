# @docx-editor.dev/telemetry

Anonymous diagnostics, metrics, and error reporting for `@docx-editor.dev` editors and collaboration servers. Send them to OpenTelemetry, Prometheus, Sentry, or your own logger.

Every event contains only codes, booleans, bucketed sizes and counts, and timings. Document text, file names, author names, font names, and room names are never sent. The package sends nothing by itself: you choose the exporters.

## Install the package

```sh
npm install @docx-editor.dev/telemetry @docx-editor.dev/core
```

Add `@sentry/*`, `@opentelemetry/api`, or `@hocuspocus/server` only for the exporters and server integrations that you use.

## Editors

```ts
import { createTelemetry } from '@docx-editor.dev/telemetry';
import { sentryExporter } from '@docx-editor.dev/telemetry/sentry';
import * as Sentry from '@sentry/react';

export const telemetry = createTelemetry({
  exporters: [sentryExporter(Sentry)],
  include: { documentOpen: true, trackedChanges: true, editing: true },
  consent: () => consentManager.analytics === true, // your consent manager
});

// Outside your component, so the array is stable across renders:
export const MODULES = [telemetry.module];
// <DocxEditor document={bytes} modules={MODULES} />
```

A refused tracked change explains itself:

```text
[docx-editor] edit refused: edit.tracked-drawing-delete-unsupported (input, tracked)
  Deleting a drawing is not supported while changes are tracked, so nothing was deleted. Leave the drawing, or ask a person to delete it with tracking off.
  https://docx-editor.dev/docs/2.x/guides/diagnostics#edit-tracked-drawing-delete-unsupported
```

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

## Entry points

| Entry | Contents |
| --- | --- |
| `@docx-editor.dev/telemetry` | `createTelemetry`, `consoleExporter`, `callbackExporter`, `memoryExporter`, `isFailure`, `explainDiagnostic`, the metric catalog |
| `@docx-editor.dev/telemetry/otel` | `otelExporter`, through your OpenTelemetry SDK |
| `@docx-editor.dev/telemetry/sentry` | `sentryExporter`, `dropEditorBreadcrumbs`, `EDITOR_SELECTORS` |
| `@docx-editor.dev/telemetry/prometheus` | `prometheusRegistry`, `metricsHandler`, `fetchMetricsHandler` |
| `@docx-editor.dev/telemetry/server` | `roomTelemetry`, `hmacRoomLabel` |
| `@docx-editor.dev/telemetry/hocuspocus` | `withCollaborationTelemetry`, `serveMetrics`, `requireBearerToken`, `hmacRoomLabel` |

For the full guide, see [Telemetry](https://docx-editor.dev/docs/2.x/pro/telemetry).

## License

EigenPal Pro License. See [LICENSE.md](./LICENSE.md).
