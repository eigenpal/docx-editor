# @docx-editor.dev/telemetry

Anonymous diagnostics, metrics, and error reporting for `@docx-editor.dev` editors and collaboration servers. Send them to OpenTelemetry, Prometheus, Sentry, or your own logger.

Every event contains only codes, booleans, and bucketed numbers. Document text, file names, author names, font names, and room names are never sent. The package sends nothing by itself: you choose the exporters.

## Editors

```ts
import { createTelemetry, consoleExporter } from '@docx-editor.dev/telemetry';
import { sentryExporter } from '@docx-editor.dev/telemetry/sentry';
import * as Sentry from '@sentry/react';

export const telemetry = createTelemetry({
  exporters: [sentryExporter(Sentry), consoleExporter()],
  include: { documentOpen: true, trackedChanges: true, editing: true },
  consent: () => window.cookieConsent?.analytics === true,
});

// Register the module once: <DocxEditor document={bytes} modules={[telemetry.module]} />
```

A refused tracked change explains itself:

```text
[docx-editor] edit refused: edit.tracked-drawing-delete-unsupported (input, tracked)
  Deleting a drawing is not supported while changes are tracked, so nothing was deleted. Leave the drawing, or ask a person to delete it with tracking off.
  https://docx-editor.dev/docs/2.x/guides/diagnostics#edit
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
| `@docx-editor.dev/telemetry` | `createTelemetry`, `consoleExporter`, `callbackExporter`, `memoryExporter`, the metric catalog |
| `@docx-editor.dev/telemetry/otel` | `otelExporter`, through your OpenTelemetry SDK |
| `@docx-editor.dev/telemetry/sentry` | `sentryExporter` |
| `@docx-editor.dev/telemetry/prometheus` | `prometheusRegistry`, `metricsHandler`, `fetchMetricsHandler` |
| `@docx-editor.dev/telemetry/server` | `roomTelemetry`, `hmacRoomLabel` |
| `@docx-editor.dev/telemetry/hocuspocus` | `withCollaborationTelemetry`, `serveMetrics` |

For the full guide, see [Telemetry](https://docx-editor.dev/docs/2.x/pro/telemetry).

## License

EigenPal Pro License. See [LICENSE.md](./LICENSE.md).
