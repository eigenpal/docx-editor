// A Hocuspocus room server with room telemetry, for the collaboration telemetry example.
//
// `withCollaborationTelemetry` wraps the server's own hooks: it times each room load and
// store, counts refused connections by reason, and follows the people and memory of each room.
// Prometheus scrapes `/metrics`. No room name reaches a metric.
//
// Rooms live in memory only, so a restart starts empty. For storage, see
// `examples/collaboration-hocuspocus`.
//
// Run it with Node 22.18 or later: `node server/server.ts`. Node strips the types.
import { Server } from '@hocuspocus/server';
import {
  checkCollaborationRoomGeneration,
  prepareCollaborationServerDocument,
} from '@docx-editor.dev/pro/collaboration';
import { serveMetrics, withCollaborationTelemetry } from '@docx-editor.dev/telemetry/hocuspocus';
import { prometheusRegistry } from '@docx-editor.dev/telemetry/prometheus';

const PORT = Number(process.env.PORT ?? 1235);

const metrics = prometheusRegistry();

const { config } = withCollaborationTelemetry(
  {
    port: PORT,
    name: 'telemetry-collaboration',
    async onLoadDocument({ document }) {
      prepareCollaborationServerDocument(document);
      return document;
    },
    async beforeHandleMessage(payload) {
      checkCollaborationRoomGeneration(payload);
    },
  },
  // Sample people and memory every 10 seconds, so the dashboard moves quickly in the demo.
  { exporters: [metrics], sampleInterval: 10_000 }
);

const server = new Server({ ...config, onRequest: serveMetrics(metrics) });
await server.listen();
console.log(`Hocuspocus is listening on ws://127.0.0.1:${PORT}`);
console.log(`Metrics: http://127.0.0.1:${PORT}/metrics`);
