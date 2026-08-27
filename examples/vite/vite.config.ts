import { defineConfig, type Plugin, type UserConfig } from 'vite';
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
 * Serve named test fixtures without copying them into the demo.
 *
 * The default document stays in `public/sample.docx`. In development, the
 * `?fixture=<name>.docx` query loads that name from `e2e/fixtures/`. Production
 * builds include only the named entries below.
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
        const url = req.url ? req.url.split('?')[0]! : '';
        // The named entries above are what BUILD emits. In dev, any fixture is reachable by
        // name so `?fixture=<name>.docx` can point at one without editing this file — the
        // name is sanitized to a bare filename and resolved inside `e2e/fixtures/`, so a
        // crafted URL cannot walk out of it.
        const devFixture =
          fixtures.get(url) ??
          (/^\/[\w.-]+\.docx$/.test(url)
            ? path.join(monorepoRoot, 'e2e/fixtures', path.basename(url))
            : undefined);
        const source = devFixture;
        if (!source) return next();
        readFile(source)
          .then((bytes) => {
            res.setHeader(
              'Content-Type',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            );
            res.end(bytes);
          })
          // Not a fixture name (the demo's own `public/sample.docx` is the common case):
          // fall through so vite serves it statically. Forwarding the error instead would
          // turn every non-fixture `.docx` request into a 500.
          .catch(() => next());
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

// Annotated rather than inferred: inferring this object against Vite's `UserConfigExport`
// union blows the comparison depth limit, and the resulting error names the whole config
// instead of whatever is actually wrong in it.
export default defineConfig(async (): Promise<UserConfig> => {
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
              find: '@docx-editor.dev/core/editor',
              replacement: path.join(monorepoRoot, 'packages/core/src/editor/index.ts'),
            },
            // Nested, so the single-segment lane capture below cannot reach it. Without this
            // the replication seam is the ONE core subpath in this graph that resolves to
            // `dist` while everything around it resolves to source — two copies of the engine,
            // and a node_modules dep vite re-optimizes mid-run.
            {
              find: '@docx-editor.dev/core/collaboration/replication',
              replacement: path.join(
                monorepoRoot,
                'packages/core/src/collaboration/replication.ts'
              ),
            },
            // The remaining core lane subpaths, one rule. `@docx-editor.dev/react`
            // above resolves to package SOURCE, so the whole `packages/react/src` graph is
            // compiled here and its own bare specifiers resolve through these aliases too.
            // `editor` and the `contracts/*` single-file entries are matched above / by the
            // capture.
            {
              find: /^@docx-editor\.dev\/core\/(binding|collaboration|layout|output|store|sync|clients|server)$/,
              replacement: path.join(monorepoRoot, 'packages/core/src/$1/index.ts'),
            },
            {
              find: /^@docx-editor\.dev\/core\/contracts\/(.+)$/,
              replacement: path.join(monorepoRoot, 'packages/core/src/contracts/$1.ts'),
            },
            {
              find: '@docx-editor.dev/pro/collaboration/webrtc',
              replacement: path.join(monorepoRoot, 'packages/pro/src/collaboration/webrtc.ts'),
            },
            {
              find: '@docx-editor.dev/pro/collaboration',
              replacement: path.join(monorepoRoot, 'packages/pro/src/collaboration/index.ts'),
            },
            {
              find: '@docx-editor.dev/pro/react/webrtc',
              replacement: path.join(monorepoRoot, 'packages/pro/src/react/webrtc.ts'),
            },
            {
              find: '@docx-editor.dev/pro/react',
              replacement: path.join(monorepoRoot, 'packages/pro/src/react/index.ts'),
            },
            {
              find: '@docx-editor.dev/pro',
              replacement: path.join(monorepoRoot, 'packages/pro/src/index.ts'),
            },
            {
              find: '@docx-editor.dev/fonts/google',
              replacement: path.join(monorepoRoot, 'packages/fonts/src/google-fonts.ts'),
            },
            // Every package points its export map at `dist/`, so a specifier missing from
            // this list resolves through node_modules to a build instead of to source.
            // That is the whole reason the list exists, and `pro` and `fonts` were simply
            // never added to it: the demo built anyway on any machine that had run
            // `build:packages`, and only failed on the CI job that had not.
            {
              find: '@docx-editor.dev/fonts',
              replacement: path.join(monorepoRoot, 'packages/fonts/src/index.ts'),
            },
            {
              find: '@docx-editor.dev/i18n',
              replacement: path.join(monorepoRoot, 'packages/i18n/src/index.ts'),
            },
          ],
    },
    css: {
      postcss: {
        // Two copies of postcss are installed, so `tailwindcss` and `autoprefixer` are typed
        // against a different one than vite's `AcceptedPlugin`. Identical shapes, unrelated
        // types. Deduplicating the dependency is the real fix; casting keeps that a dependency
        // problem rather than a reason to leave this whole project unchecked.
        plugins: [
          tailwindcss({ config: path.join(monorepoRoot, 'tailwind.config.js') }),
          autoprefixer(),
        ] as UserConfig['css'] extends { postcss?: { plugins?: infer P } } ? P : never,
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
      // Collaboration Playwright starts its own Vite. Disable HMR there so a
      // concurrent edit of engine source cannot remount the editor mid-suite.
      ...(process.env.COLLAB_E2E === '1' ? { hmr: false, watch: null } : {}),
    },
    build: {
      outDir: 'dist',
    },
  };
});
