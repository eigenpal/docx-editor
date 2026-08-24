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
    name: '@docx-editor.dev/collaboration-yjs',
    root: 'packages/collaboration-yjs',
    pkgSlug: 'docx-editor-collaboration-yjs',
    tsconfigPath: 'packages/collaboration-yjs/tsconfig.api.json',
  },
  {
    name: '@docx-editor.dev/pro',
    root: 'packages/pro',
    pkgSlug: 'docx-editor-pro',
    tsconfigPath: 'packages/pro/tsconfig.api.json',
    // Rolled up into one `.d.ts` per entry, exactly like `editor-api` — so the same reasoning
    // applies: a forgotten export here is a name a public signature hands a consumer that the
    // consumer cannot import to write the signature down. `StandardSchemaV1` reached the
    // published surface unexported on eight declarations, and nothing said so.
    forgottenExports: {
      logLevel: 'warning',
      allowlist: {
        // Owned by `core` and imported from there — a consumer CAN name these, just not
        // through this package, which is the boundary `contracts/modules.ts` documents.
        index: ['Editor', 'EditorModule', 'ExecResult', 'OoxmlPart'],
        // The react entry is a compound-parts barrel: every `Review*` here is a namespace
        // member reachable as `DocxEditorReview.Card`, and the three custom-node types are
        // re-exports of names the package's own index publishes. This is the noise case the
        // comment above describes; the gate earns its keep on `index`.
        react: [
          'ActivatedCustomNode',
          'AnyCustomNodeDefinition',
          'CustomNodeDefinition',
          'Editor',
          'EditorModule',
          'ReviewAccept',
          'ReviewAddComment',
          'ReviewAuthor',
          'ReviewAvatar',
          'ReviewBalloon',
          'ReviewCard',
          'ReviewDelete',
          'ReviewDraft',
          'ReviewEmpty',
          'ReviewItemPlacement',
          'ReviewItemQuery',
          'ReviewList',
          'ReviewMarkers',
          'ReviewReject',
          'ReviewReopen',
          'ReviewResolve',
          'ReviewReplies',
          'ReviewReply',
          'ReviewRoot',
          'ReviewSummary',
          'ReviewTime',
        ],
        // Vue compounds follow the same rule as React. Custom-node types come from this
        // package's main entry, and editor contracts come from core.
        vue: [
          'ActivatedCustomNode',
          'AnyCustomNodeDefinition',
          'CustomNodeDefinition',
          'Editor',
          'EditorModule',
          'ReviewItemPlacement',
          'ReviewItemQuery',
        ],
      },
    },
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
