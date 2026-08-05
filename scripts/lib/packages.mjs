// Single source of truth for every published package's API Extractor
// configuration. Consumed by `scripts/api-extractor.mjs` (the root
// driver behind `api:extract` / `api:check`) and `scripts/build-docs-json.mjs`
// (the docs JSON orchestrator).
//
// Adding a new published package means adding one entry here. The
// per-package wrappers under `packages/*/scripts/` are gone — each
// package's `package.json` just calls the root driver with
// `--package <name>`.

import path from 'node:path';

export const PACKAGES = [
  {
    name: '@docx-editor.dev/i18n',
    root: 'packages/i18n',
    pkgSlug: 'docx-editor-i18n',
  },
  {
    name: '@docx-editor.dev/react',
    root: 'packages/react',
    pkgSlug: 'docx-editor-react',
    // Strips dev-time `paths` so Extractor follows `@docx-editor.dev/...` via
    // node_modules instead of through source mappings (the source
    // imports JSON locale data Extractor can't analyze).
    tsconfigPath: 'packages/react/tsconfig.api.json',
  },
  {
    name: '@docx-editor.dev/vue',
    root: 'packages/vue',
    pkgSlug: 'docx-editor-vue',
    tsconfigPath: 'packages/vue/tsconfig.api.json',
    // WIP and unpublished (`private: true` in its package.json), so it is off
    // `build:packages` and has no `dist` for Extractor to read. Clear this flag and
    // put the package back in `build:packages` in the same change that starts
    // publishing it again.
    disconnected: 'WIP adapter, not published and not built on the release path',
  },
  {
    name: '@docx-editor.dev/editor-api',
    root: 'packages/editor-api',
    pkgSlug: 'docx-editor-editor-api',
    // Strips dev-time `paths` for the same reason the React entry does: Extractor should
    // read the built `dist/*.d.ts` as a consumer would, not follow `@docx-editor.dev/...`
    // back into workspace source.
    tsconfigPath: 'packages/editor-api/tsconfig.api.json',
    // The one package whose entries are ROLLED UP into a single `.d.ts` each, so a
    // "forgotten export" here means what it says: a name a public signature hands a consumer
    // that the consumer cannot import to write the signature down. The blanket silence exists
    // for the barrel-and-per-file adapters, where the same message is mostly noise.
    forgottenExports: {
      logLevel: 'warning',
      protectedExportFiles: ['src/runtime/public.ts', 'src/model/index.ts'],
      allowlist: {
        index: [
          'CommentBase',
          'ContentControlScope',
          'ContextInternals',
          'HandleCollection',
          'ItemCollection',
          'ModelObject',
          'ObjectAddress',
          'ObjectPath',
          'PromisedItem',
          'QueuedAction',
          'ResolvedLoadOptions',
          'RuntimeManagedObject',
          'RuntimeSession',
          'SpanOwner',
        ],
        browser: [
          'CommentBase',
          'ContentControlScope',
          'ContextInternals',
          'HandleCollection',
          'ItemCollection',
          'ModelObject',
          'ObjectAddress',
          'ObjectPath',
          'PromisedItem',
          'QueuedAction',
          'ResolvedLoadOptions',
          'RuntimeManagedObject',
          'RuntimeSession',
          'SpanOwner',
        ],
      },
    },
  },
  // Every package builds a `dist` and points `exports.types` at the `.d.ts` in it, so the
  // reference below is extracted from the same declarations a consumer installs.
  {
    name: '@docx-editor.dev/core',
    root: 'packages/core',
    pkgSlug: 'docx-editor-core',
    tsconfigPath: 'packages/core/tsconfig.api.json',
  },
  {
    name: '@docx-editor.dev/pro',
    root: 'packages/pro',
    pkgSlug: 'docx-editor-pro',
    tsconfigPath: 'packages/pro/tsconfig.api.json',
  },
  {
    name: '@docx-editor.dev/fonts',
    root: 'packages/fonts',
    pkgSlug: 'docx-editor-fonts',
    tsconfigPath: 'packages/fonts/tsconfig.api.json',
  },
];


// Derived: build invocation hint shown in `api:check` drift error
// output. Every package builds via the same `bun run --filter` shape,
// so it's computed from `name` rather than duplicated per entry.
export function buildHintFor(pkg) {
  return `bun run --filter '${pkg.name}' build`;
}

// Derived: where API Extractor writes (and reads-for-drift-check) the
// committed `<slug>.api.md` snapshots. Same path for all packages — one
// directory per package under `docs/api/`. Co-located with the rest of
// the docs tree, rather than the API Extractor default
// `<packageRoot>/etc/`.
export function reportDirFor(pkg, repoRoot) {
  return path.join(repoRoot, 'docs', 'api', pkg.pkgSlug);
}

export function packageByName(name) {
  return PACKAGES.find((p) => p.name === name);
}
