# Editor telemetry for collaboration

This example records collaboration status, room size, and editing performance for editors in a shared Hocuspocus room. The server reports room counts, participant counts, memory use, and refused connections to Prometheus. Metrics exclude room names.

The client integration is in [`src/telemetry.ts`](src/telemetry.ts) and [`src/App.tsx`](src/App.tsx). The server calls `withCollaborationTelemetry` in [`server/server.ts`](server/server.ts).

## Run the example

1. Build the packages. The server runs on Node.js and loads packages from `dist/`:

   ```bash
   bun install
   bun run build:packages
   ```

2. Start the dashboards. They need Docker:

   ```bash
   cd examples/telemetry-stack
   docker compose up -d
   ```

3. In a second terminal, start the room server:

   ```bash
   cd examples/telemetry-collaboration
   npm run server
   ```

4. In a third terminal, start the editor:

   ```bash
   cd examples/telemetry-collaboration
   bun run dev
   ```

5. Open the [editor](http://localhost:5182). Select **Open a second person** to add a participant to the room. Then open the [Collaboration dashboard](http://localhost:3300/d/docx-editor-collaboration).

   ![Collaboration dashboard with server status, room counts, participant counts, and memory use.](../../docs/site/content/telemetry/images/collaboration.png)

The server samples rooms every 10 seconds. To view editor metrics, open the **Editor experience** dashboard and select `telemetry-collaboration` in **App**.

## What to try

- Open three editor sessions and type in each. Watch **Rooms, people, and connections** and **Room memory**.
- Stop the server and start it again. The editors report `collab.transport-disconnected`, then `ready`, in the event log and in **Client status changes**.
- Open the [metrics endpoint](http://127.0.0.1:1235/metrics) to view metrics in Prometheus text format.

## How it is built

| File | What it does |
| --- | --- |
| `server/server.ts` | Wraps Hocuspocus hooks with `withCollaborationTelemetry` and exposes `/metrics` through `serveMetrics`. |
| `src/telemetry.ts` | Enables all client telemetry areas, including collaboration. |
| `src/App.tsx` | Passes `telemetry.module` to `useHocuspocusCollaboration`, which adds the collaboration module. |

For the server options, see [Telemetry for collaboration servers](https://docx-editor.dev/docs/2.x/telemetry/servers).
