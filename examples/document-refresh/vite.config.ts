import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { strToU8, zipSync } from 'fflate';

// Generate controlled fixtures. This is not a general DOCX processor.
function sampleDocx(updated: boolean) {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const ct = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const office = 'http://schemas.openxmlformats.org/officeDocument/2006';
  const paragraphs = Array.from({ length: 40 }, (_, index) => {
    const text =
      updated && index === 20
        ? 'Delivery date: October 12.'
        : `Section ${index + 1}: Project schedule.`;
    return `<w:p><w:pPr><w:spacing w:after="480"/></w:pPr>
      <w:r><w:t>${text}</w:t></w:r></w:p>`;
  }).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(`<Types xmlns="${ct}">
      <Default Extension="rels"
        ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Override PartName="/word/document.xml"
        ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      </Types>`),
    '_rels/.rels': strToU8(`<Relationships xmlns="${rel}">
      <Relationship Id="rId1" Type="${office}/relationships/officeDocument"
        Target="word/document.xml"/></Relationships>`),
    'word/document.xml': strToU8(`<w:document xmlns:w="${w}"><w:body>
      ${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/>
      </w:sectPr></w:body></w:document>`),
  });
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mock-document-server',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === '/api/document' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.end(sampleDocx(false));
            return;
          }
          if (req.url !== '/api/update' || req.method !== 'POST') {
            next();
            return;
          }
          const submissionId = req.headers['x-submission-id'];
          if (typeof submissionId !== 'string' || !submissionId) {
            res.statusCode = 400;
            res.end('Missing submission ID');
            return;
          }
          // Simulate a server job. No uploaded document enters this mock.
          await new Promise((resolve) => setTimeout(resolve, 1500));
          if (res.destroyed) return;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              documentId: 'schedule',
              submissionId,
              sequence: 1,
              bytes: Buffer.from(sampleDocx(true)).toString('base64'),
              changes: [
                {
                  id: 'delivery-date',
                  location: {
                    paragraphIndex: 20,
                    start: 15,
                    end: 25,
                    text: 'October 12',
                  },
                },
              ],
            })
          );
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 5177, strictPort: true },
});
