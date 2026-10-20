# Editor telemetry for one person

This example sends anonymous editor diagnostics and performance measurements to OpenTelemetry, Sentry, and the console. It records typing delay, layout and paint times, document opens, and refused edits with their hints. A panel beside the editor lists exported events.

The integration is in [`src/telemetry.ts`](src/telemetry.ts) and [`src/App.tsx`](src/App.tsx). Events contain codes, predefined values, and numbers grouped into ranges. They exclude document content.

## Run the example

1. Start the dashboards. They need Docker:

   ```bash
   cd examples/telemetry-stack
   docker compose up -d
   ```

2. In a second terminal, start the editor:

   ```bash
   bun install
   cd examples/telemetry-single-user
   bun run dev
   ```

3. Open the [editor](http://localhost:5181) and edit a document. Then open the [Editor experience dashboard](http://localhost:3300/d/docx-editor-experience).

   ![Editor experience dashboard with input delay, document opens, and refused edits.](../../docs/site/content/telemetry/images/editor-experience.png)

The editor sends a performance summary after each minute of use and when you switch to another tab. Metrics reach Prometheus about 10 seconds later.

To generate sample data for the dashboards, run `node examples/telemetry-stack/simulate.mjs` from the repository root.

To send failures to Sentry, add your Sentry data source name (DSN) to `examples/telemetry-single-user/.env.local`:

```bash
VITE_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
```

## What to try

- Type, add paragraphs, and zoom. Watch **Typing delay** and **Engine work per edit**.
- Open a file that is not a `.docx` file with **Open a .docx file**. The event log shows `open.zip-corrupt` with its hint.
- Select a picture, then drop or paste another picture. The editor refuses the insert with `edit.picture-selected`.
- Clear **Share anonymous diagnostics**. The editor stops recording new telemetry until you select it again. The OpenTelemetry SDK still exports previously recorded metrics. Apply the same consent choice to your Sentry and OpenTelemetry SDKs.

## How it is built

| File | What it does |
| --- | --- |
| `src/telemetry.ts` | Creates the telemetry client with the OpenTelemetry, Sentry, console, and event log exporters, and the consent check. |
| `src/opentelemetry.ts` | Starts the browser OpenTelemetry SDK. In your app, use your existing SDK setup. |
| `src/App.tsx` | Registers `telemetry.module` in the editor's `modules`, next to `reviewModule()`. |
| `../telemetry-stack/client/event-log.tsx` | The panel that lists sent events. |

For configuration options, see [Set up an editor](https://docx-editor.dev/docs/2.x/telemetry/editors).
