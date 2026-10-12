# Editor telemetry for one person

An editor that reports anonymous diagnostics and editing performance to OpenTelemetry, Sentry, and the console: typing delay, layout and paint times, document opens, and refused edits with their hints. A panel beside the editor shows each event as your backends receive it.

The whole integration is in [`src/telemetry.ts`](src/telemetry.ts) and three lines of [`src/App.tsx`](src/App.tsx). Events hold codes, enums, and bucketed numbers, never document content.

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

3. Open http://localhost:5181 and edit. Then open the **Editor experience** dashboard at http://localhost:3300/d/docx-editor-experience.

A performance summary arrives once a minute of use, and when you switch to another tab. Metrics reach Prometheus within about 10 seconds after that.

To fill the dashboards without typing yourself, run `node examples/telemetry-stack/simulate.mjs` from the repository root.

To also send failures to Sentry, create `examples/telemetry-single-user/.env.local` with your DSN:

```bash
VITE_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
```

## What to try

- Type, add paragraphs, and zoom. Watch **Typing delay** and **Engine work per edit**.
- Open a file that is not a `.docx` file with **Open a .docx file**. The event log shows `open.zip-corrupt` with its hint.
- Select a picture, then drop or paste another picture. The editor refuses the insert with `edit.picture-selected`.
- Clear **Share anonymous diagnostics**. The editor stops recording new telemetry until you select it again. Metrics recorded before stay in the OpenTelemetry SDK and are still exported. Your Sentry and OpenTelemetry SDKs have their own consent settings; apply your consent choice to them as well.

## How it is built

| File | What it does |
| --- | --- |
| `src/telemetry.ts` | Creates the telemetry client with the OpenTelemetry, Sentry, console, and event log exporters, and the consent check. |
| `src/opentelemetry.ts` | Starts the browser OpenTelemetry SDK. Your app already has its own. |
| `src/App.tsx` | Registers `telemetry.module` in the editor's `modules`, next to `reviewModule()`. |
| `../telemetry-stack/client/event-log.tsx` | The panel that lists sent events. |

For the options, see [Telemetry for editors](https://docx-editor.dev/docs/2.x/telemetry/editors).
