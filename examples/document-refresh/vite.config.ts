import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sampleDocx, sampleUpdate } from './sample-document';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mock-document-server',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === '/api/document' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.end(sampleDocx());
            return;
          }
          const url = new URL(req.url ?? '/', 'http://localhost');
          if (url.pathname !== '/api/update' || req.method !== 'POST') {
            next();
            return;
          }
          const submissionId = req.headers['x-submission-id'];
          if (typeof submissionId !== 'string' || !submissionId) {
            res.statusCode = 400;
            res.end('Missing submission ID');
            return;
          }
          const round = Number(url.searchParams.get('round'));
          const sequence = Number(url.searchParams.get('sequence'));
          if (
            !Number.isSafeInteger(round) ||
            round < 1 ||
            round > 10000 ||
            ![1, 2].includes(sequence)
          ) {
            res.statusCode = 400;
            res.end('Invalid sample request');
            return;
          }
          // Discard the uploaded sample. This mock generates controlled fixtures only.
          req.resume();
          await new Promise((resolve) => setTimeout(resolve, 1500));
          if (res.destroyed) return;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(sampleUpdate(submissionId, round, sequence)));
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 5177, strictPort: true },
});
