import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

/** Use the deployed PDF function contract in the React and Vue development servers. */
export function pdfExportPlugin(): Plugin {
  return {
    name: 'docx-pdf-export',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/api/convert') return next();
        const handlerPath = fileURLToPath(new URL('../../api/convert.ts', import.meta.url));
        void server
          .ssrLoadModule(handlerPath)
          .then(({ default: handler }) => handler(request, response))
          .catch((error: unknown) => {
            server.config.logger.error(String(error));
            if (response.headersSent) return response.end();
            response.writeHead(503, { 'Content-Type': 'application/json' });
            response.end(
              JSON.stringify({
                message:
                  'PDF export requires @docx-editor.dev/docx-to-pdf on Node.js. Run bun run build:pdf and restart the development server.',
              })
            );
          });
      });
    },
  };
}
