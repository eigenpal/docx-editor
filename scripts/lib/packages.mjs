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
  // Every package builds a `dist` and points `exports.types` at the `.d.ts` in it, so the
  // reference below is extracted from the same declarations a consumer installs.
  {
    name: '@docx-editor.dev/core',
    root: 'packages/core',
    pkgSlug: 'docx-editor-core',
    tsconfigPath: 'packages/core/tsconfig.api.json',
    // Unsupported-content signatures reference types owned by the layout/store subpaths.
    // Keep those graphs at their owning entry points, as with the existing facade escape hatches.
    forgottenExports: {
      logLevel: 'warning',
      allowlist: {
        editor: ['AnchoredDrawingRecord', 'EquationSpanRecord', 'InlineDrawingRecord', 'LayoutBox'],
        index: ['UnsupportedElementRule'],
        layout: ['UnsupportedContentRecord', 'UnsupportedContentResolver'],
        output: [
          'AnchoredDrawingRecord',
          'EquationSpanRecord',
          'InlineDrawingRecord',
          'LayoutBox',
          'OoxmlElement',
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
  {
    name: '@docx-editor.dev/fonts-cjk',
    root: 'packages/fonts-cjk',
    pkgSlug: 'docx-editor-fonts-cjk',
    tsconfigPath: 'packages/fonts-cjk/tsconfig.api.json',
  },
  {
    name: '@docx-editor.dev/docx-to-markdown',
    root: 'packages/docx-to-markdown',
    pkgSlug: 'docx-editor-docx-to-markdown',
    tsconfigPath: 'packages/docx-to-markdown/tsconfig.api.json',
    // This entry is a rolled-up public facade. Direct core types are deliberately re-exported;
    // nested implementation types remain nameable from the declared `core` dependency and are
    // allowlisted here so a newly introduced package-owned forgotten export still fails the gate.
    forgottenExports: {
      logLevel: 'warning',
      allowlist: {
        // The filesystem subpath consumes the result type exported by the main facade.
        node: ['MarkdownExportResult'],
        index: [
          'BlockFragmentRecord',
          'ContentControlBoundaryRecord',
          'DocumentProperties',
          'DrawingClipFallback',
          'DrawingInsets',
          'DrawingPoint',
          'DrawingImageEffects',
          'DrawingTextArtRecord',
          'FontFaceRequest',
          'FontLoadFailure',
          'FontResolver',
          'FontSource',
          'MarkedFontResolver',
          'FontOrigin',
          'HeaderFooterParts',
          'HeaderFooterSectionResolution',
          'HeadlessThemeFonts',
          'ImageResourceLimits',
          'ListMarkerPictureRecord',
          'NoteAreaRecord',
          'OoxmlElement',
          'OoxmlPackage',
          'OoxmlPackageRejection',
          'OoxmlPart',
          'PageRecord',
          'PreservedImageMime',
          'RenderableImageMime',
          'ResolvedRunStyle',
          'RevisionKind',
          'SectionBreakMarkRecord',
          'SemanticDrawingLayer',
          'SemanticRootStoryKind',
          'SemanticStoryKind',
          'SemanticStoryVisit',
          'StoryDrawingContext',
          'StrikeoutStrokePt',
          'SupportedImageMime',
          'TextOutline',
          'TextboxStoryFallbackReason',
          'ValidatedImageBytesHandle',
          'VectorShapeComponent',
          'relationshipTargetIn',
        ],
      },
    },
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
