import { readFile } from 'node:fs/promises';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

const monorepoRoot = path.resolve(__dirname, '../..');
const sampleDocument = path.join(monorepoRoot, 'examples/vite/public/sample.docx');
// The vendored Extend UI PDF viewer (shadcn registry item) imports through shadcn's `@/`
// alias; it resolves into the vendored tree only, never into first-party demo code.
const vendoredUi = path.join(__dirname, 'src/vendor/extend-ui');
const SAMPLE_PDF = 'sample-pdf.json';

/** Serve the canonical public sample without checking a second copy into the repository. */
function sampleDocumentPlugin(): Plugin {
  return {
    name: 'docx-to-pdf-sample-document',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/sample.docx') return next();
        void readFile(sampleDocument)
          .then((bytes) => {
            response.setHeader(
              'Content-Type',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            );
            response.end(bytes);
          })
          .catch(next);
      });
    },
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'sample.docx',
        source: await readFile(sampleDocument),
      });
    },
  };
}

/**
 * The built package, not its sources: those need the Node-only font typings this browser
 * project does not load. A variable specifier keeps the type checker out of them.
 */
const PDF_PACKAGE = '@docx-editor.dev/docx-to-pdf';
type ExportPdf = (
  source: Uint8Array,
  options: { fidelityPolicy: 'best-effort'; useSystemFonts: false }
) => Promise<{ bytes: Uint8Array; pageCount: number; diagnostics: readonly unknown[] }>;

/**
 * The sample's conversion, in the `/api/convert` response shape, or `null` when the PDF
 * package is not built.
 *
 * The options are the page's own request (`best-effort`, default display mode and comments)
 * on the hosted function's font set, so the cached preview is the one a live conversion of the
 * unedited sample returns. Fail soft: the source-only preview build has no package `dist/`,
 * and the page converts the sample live when this file is absent.
 */
async function convertSample(): Promise<string | null> {
  try {
    const { exportPdf } = (await import(PDF_PACKAGE)) as { exportPdf: ExportPdf };
    const started = performance.now();
    const result = await exportPdf(new Uint8Array(await readFile(sampleDocument)), {
      fidelityPolicy: 'best-effort',
      useSystemFonts: false,
    });
    return JSON.stringify({
      ok: true,
      pdf: Buffer.from(result.bytes).toString('base64'),
      pageCount: result.pageCount,
      diagnostics: result.diagnostics,
      timings: { generationMs: performance.now() - started },
    });
  } catch (error) {
    console.warn(
      `[docx-to-pdf] ${SAMPLE_PDF} was not generated; the page converts the sample live. ${error}`
    );
    return null;
  }
}

/** Convert the sample once at build time so the page opens with its PDF already shown. */
function samplePdfPlugin(): Plugin {
  let cached: Promise<string | null> | null = null;
  return {
    name: 'docx-to-pdf-sample-pdf',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `/${SAMPLE_PDF}`) return next();
        cached ??= convertSample();
        void cached
          .then((body) => {
            if (body === null) {
              response.statusCode = 404;
              response.end();
              return;
            }
            response.setHeader('Content-Type', 'application/json');
            response.end(body);
          })
          .catch(next);
      });
    },
    async generateBundle() {
      const body = await convertSample();
      if (body !== null) this.emitFile({ type: 'asset', fileName: SAMPLE_PDF, source: body });
    },
  };
}

export default defineConfig(
  (): UserConfig => ({
    // The combined demo deployment serves this app under `/docx-to-pdf/`, the same way it
    // serves the Markdown demo; `bun run dev:pdf` keeps the root.
    base: process.env.VITE_BASE_PATH ?? '/',
    // Tailwind v4 serves only the vendored viewer: `src/pdf-viewer.css` scopes its preflight and
    // scans just `src/vendor/`, so the demo's own chrome keeps its plain CSS.
    plugins: [react(), tailwindcss(), sampleDocumentPlugin(), samplePdfPlugin()],
    root: __dirname,
    resolve: {
      // Build the browser bundle from workspace sources so the preview build needs no
      // package `dist/`. The conversion itself never runs in the browser; the page posts
      // the document to `/api/convert`.
      alias: [
        { find: /^@\//, replacement: `${vendoredUi}/` },
        {
          find: /^@docx-editor\.dev\/react$/,
          replacement: path.join(monorepoRoot, 'packages/react/src/index.ts'),
        },
        {
          find: /^@docx-editor\.dev\/core$/,
          replacement: path.join(monorepoRoot, 'packages/core/src/index.ts'),
        },
        {
          find: '@docx-editor.dev/core/collaboration/replication',
          replacement: path.join(monorepoRoot, 'packages/core/src/collaboration/replication.ts'),
        },
        {
          find: /^@docx-editor\.dev\/core\/(binding|collaboration|editor|export|layout|output|store|sync)$/,
          replacement: path.join(monorepoRoot, 'packages/core/src/$1/index.ts'),
        },
        {
          find: /^@docx-editor\.dev\/core\/contracts\/(.+)$/,
          replacement: path.join(monorepoRoot, 'packages/core/src/contracts/$1.ts'),
        },
        {
          find: '@docx-editor.dev/fonts/google',
          replacement: path.join(monorepoRoot, 'packages/fonts/src/google-fonts.ts'),
        },
        {
          find: /^@docx-editor\.dev\/fonts$/,
          replacement: path.join(monorepoRoot, 'packages/fonts/src/index.ts'),
        },
        {
          find: /^@docx-editor\.dev\/i18n$/,
          replacement: path.join(monorepoRoot, 'packages/i18n/src/index.ts'),
        },
      ],
    },
    css: { postcss: { plugins: [] } },
    build: { outDir: 'dist' },
  })
);
