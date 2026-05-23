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
    name: '@eigenpal/docx-editor-core',
    root: 'packages/core',
    pkgSlug: 'docx-editor-core',
  },
  {
    name: '@eigenpal/docx-editor-i18n',
    root: 'packages/i18n',
    pkgSlug: 'docx-editor-i18n',
  },
  {
    name: '@eigenpal/docx-editor-react',
    root: 'packages/react',
    pkgSlug: 'docx-editor-react',
    // Strips dev-time `paths` so Extractor follows `@eigenpal/...` via
    // node_modules instead of through source mappings (the source
    // imports JSON locale data Extractor can't analyze).
    tsconfigPath: 'packages/react/tsconfig.api.json',
  },
  {
    name: '@eigenpal/docx-editor-vue',
    root: 'packages/vue',
    pkgSlug: 'docx-editor-vue',
    tsconfigPath: 'packages/vue/tsconfig.api.json',
  },
  {
    name: '@eigenpal/docx-editor-agents',
    root: 'packages/agents',
    pkgSlug: 'docx-editor-agents',
    // Excludes Vue source files because the Vue adapter for agents
    // builds with a separate Vite pass.
    tsconfigPath: 'packages/agents/tsconfig.tsup.json',
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
