# Editor telemetry for collaboration

Editors in a shared Hocuspocus room report their collaboration status, room size, and editing performance, and the room server reports its rooms, people, memory, and refused connections to Prometheus. Room names never reach a metric.

The client integration is in [`src/telemetry.ts`](src/telemetry.ts) and [`src/App.tsx`](src/App.tsx). The server integration is one call to `withCollaborationTelemetry` in [`server/server.ts`](server/server.ts).

## Run the example

1. Build the packages once, because the server runs on Node and loads them from `dist/`:

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

5. Open http://localhost:5182, then **Open a second person** to add someone to the same room. Open the **Collaboration** dashboard at http://localhost:3300/d/docx-editor-collaboration.

The server samples rooms every 10 seconds. The editors' own metrics are on the **Editor experience** dashboard too: choose `telemetry-collaboration` in **App**.

## What to try

- Open three people and type in each. Watch **Rooms, people, and connections** and **Room memory**.
- Stop the server and start it again. The editors report `collab.transport-disconnected`, then `ready`, in the event log and in **Client status changes**.
- Open http://127.0.0.1:1235/metrics to see the Prometheus text the server serves.

## How it is built

| File | What it does |
| --- | --- |
| `server/server.ts` | A Hocuspocus server whose hooks `withCollaborationTelemetry` wraps, with `/metrics` from `serveMetrics`. |
| `src/telemetry.ts` | The client's telemetry, with every area on, collaboration included. |
| `src/App.tsx` | Passes `telemetry.module` to `useHocuspocusCollaboration`, which adds the collaboration module. |

For the server options, see [Telemetry for collaboration servers](https://docx-editor.dev/docs/2.x/telemetry/servers).
