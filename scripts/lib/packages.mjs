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
  },
  {
    name: '@docx-editor.dev/agents',
    root: 'packages/agents',
    pkgSlug: 'docx-editor-agents',
    // Excludes Vue source files because the Vue adapter for agents
    // builds with a separate Vite pass.
    tsconfigPath: 'packages/agents/tsconfig.tsup.json',
    // Cannot build against the current engine: `src/bridge.ts` imports
    // `@docx-editor.dev/core/headless`, which the greenfield migration removed. The
    // package's own `typecheck` script already skips for exactly this reason. Without
    // this flag `api:check` failed on the missing `dist` for every other package too, so
    // one legacy package took the whole API gate down and no snapshot drift anywhere
    // could be detected. Clear it when the agent bridge is rebuilt over engine-core.
    disconnected:
      'legacy package pending rebuild over engine-core; @docx-editor.dev/core/headless imports were removed in the greenfield migration',
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
