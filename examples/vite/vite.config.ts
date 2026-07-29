import { defineConfig, type Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path';

const monorepoRoot = path.resolve(__dirname, '../..');

async function fetchGitHubStars(): Promise<number | null> {
  try {
    const res = await fetch('https://api.github.com/repos/eigenpal/docx-editor');
    const data = await res.json();
    if (typeof data.stargazers_count === 'number') return data.stargazers_count;
  } catch {}
  return null;
}

/**
 * Serve the canonical comprehensive fixture from ONE byte source (task M6D.1).
 *
 * The demo's bare `/` must load `e2e/fixtures/comprehensive-word-element-test.docx`.
 * Copying it into `examples/vite/public/` would create a second DOCX that silently
 * drifts from the fixture the e2e suite asserts against — the task explicitly calls
 * for an asset mapping or an automated byte-identical copy instead. This maps the URL
 * onto the real file at request time, so there is exactly one source of bytes and it
 * cannot go stale.
 *
 * `build` copies it once into the output, so the deployed demo serves the same bytes
 * rather than depending on a dev-only route.
 */
function canonicalFixturePlugin(): Plugin {
  const fixtures = new Map([
    [
      '/comprehensive-word-element-test.docx',
      path.join(monorepoRoot, 'e2e/fixtures/comprehensive-word-element-test.docx'),
    ],
    [
      '/harfbuzz-text-fidelity.docx',
      path.join(monorepoRoot, 'e2e/fixtures/harfbuzz-text-fidelity.docx'),
    ],
  ]);
  return {
    name: 'docx-editor-canonical-fixture',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const source = req.url ? fixtures.get(req.url.split('?')[0]!) : undefined;
        if (!source) return next();
        readFile(source)
          .then((bytes) => {
            res.setHeader(
              'Content-Type',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            );
            res.end(bytes);
          })
          .catch(next);
      });
    },
    async generateBundle() {
      for (const [url, source] of fixtures) {
        this.emitFile({
          type: 'asset',
          fileName: url.slice(1),
          source: await readFile(source),
        });
      }
    },
  };
}

export default defineConfig(async () => {
  const stars = await fetchGitHubStars();
  // `@docx-editor.dev/core` lives in a separate repo and is consumed from npm,
  // so it always resolves via node_modules — only workspace-local packages get
  // source aliases.
  // When USE_PUBLISHED_PACKAGES=1 we skip the workspace source aliases so vite
  // resolves package names via node_modules. That hits the workspace's built
  // `dist/` (same code path a `npm install` consumer gets). Used by the parity
  // build so community members see the real installed experience.
  const usePublished = process.env.USE_PUBLISHED_PACKAGES === 'true';

  return {
    base: process.env.VITE_BASE_PATH ?? '/',
    plugins: [react(), canonicalFixturePlugin()],
    root: __dirname,
    resolve: {
      alias: usePublished
        ? [
            {
              find: /^@docx-editor\.dev\/react$/,
              replacement: path.join(monorepoRoot, 'packages/react/dist/index.mjs'),
            },
            { find: '@', replacement: path.join(monorepoRoot, 'packages/react/src') },
          ]
        : [
            // Resolve package imports to source for live development
            // Order matters: more-specific prefixes before less-specific ones
            {
              find: '@docx-editor.dev/react',
              replacement: path.join(monorepoRoot, 'packages/react/src/index.ts'),
            },
            {
              find: '@docx-editor.dev/core-contract/editor',
              replacement: path.join(monorepoRoot, 'packages/core/src/editor/index.ts'),
            },
            {
              find: '@docx-editor.dev/i18n',
              replacement: path.join(monorepoRoot, 'packages/i18n/src/index.ts'),
            },
            {
              find: '@docx-editor.dev/agents/react',
              replacement: path.join(monorepoRoot, 'packages/agents/src/react.ts'),
            },
            {
              find: '@docx-editor.dev/agents/server',
              replacement: path.join(monorepoRoot, 'packages/agents/src/server.ts'),
            },
            {
              find: /^@docx-editor\.dev\/agents$/,
              replacement: path.join(monorepoRoot, 'packages/agents/src/index.ts'),
            },
            { find: '@', replacement: path.join(monorepoRoot, 'packages/react/src') },
          ],
    },
    css: {
      postcss: {
        plugins: [
          tailwindcss({ config: path.join(monorepoRoot, 'tailwind.config.js') }),
          autoprefixer(),
        ],
      },
    },
    define: {
      __ENABLE_FRAMEWORK_SWITCHER__: JSON.stringify(
        process.env.ENABLE_FRAMEWORK_SWITCHER === 'true'
      ),
      __GITHUB_STARS__: JSON.stringify(stars),
    },
    server: {
      port: 5173,
      open: false,
    },
    build: {
      outDir: 'dist',
    },
  };
});
