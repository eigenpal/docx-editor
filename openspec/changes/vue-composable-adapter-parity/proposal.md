## Why

`@docx-editor.dev/vue` is `private: true` and predates the v2 engine. It is removed, and the
Vue adapter is built greenfield against the React adapter's composable surface.

React's adapter holds no editing state: `DocxEditorRoot` owns the facade's lifetime and
publishes it through context, `DocxEditorContent` is the mount point, and every other export is
a hook over that one instance — `useEditorState`, `useEditorCommand`, `useEditorEvent`,
`useZoom`, `usePageSetup`, `useDocumentOutline`, and twenty-two more. That is the surface Vue
needs and does not have, and it is the whole of this change.

Two facts about the repository shape the plan. The Vue package's build aliases
`@docx-editor.dev/core` to source and inlines it, so a page running the adapter beside the
published engine gets two copies — the failure CLAUDE.md describes: the shaper loads twice and
every identity-keyed cache misses, quietly. And no gate compares anything but names, so a
`useZoom` returning nine of React's thirteen members would ship green.

## What Changes

**Greenfield**

`packages/vue/src` and `packages/vue/test` are removed in the first commit. Nothing is ported.
The rebuild MIRRORS `packages/react/src` path for path: a paired export lives at the same
relative path in both adapters, with the framework's extension. `check:feature-parity` walks
both trees and compares them file by file, so shared paths are what make its report mean
anything.

**The old React chrome is deprecated, not twinned**

`Toolbar`, `ToolbarButton`, `ToolbarGroup`, `ToolbarProps`, `TitleBar`, `MenuBar`,
`DocumentName`, `Logo`, `TitleBarRight`, `DocxEditorShell`, `PaginatedDocxEditorShell` and
`PaginatedDocxEditorShellProps` are the pre-v2 shell chrome. The composition layer replaces all
of them — `DocxEditor.Toolbar`, `DocxEditor.Menu`, and the packaged `<DocxEditor>` — nothing in
`examples/` imports one, and building Vue twins of chrome that is on its way out would be work
with a removal date on it.

They are tagged `@deprecated` with the replacement named, and they leave in the next major.
Parity is measured over the NON-DEPRECATED surface, and the gates read the `@deprecated` tag
straight out of the API Extractor snapshot — a fact about the code, not an allowlist.

**The v2 composable surface, at 100%**

Every non-deprecated React export has a Vue export of the same name. There is no divergence set
and no exemption file at the end of this change.

- `DocxEditorRoot` is a renderless component that owns the facade and `provide`s it as a
  `ShallowRef`, paired with `provideDocxEditor()`. `DocxEditorViewport` carries the load-bearing
  scroller classes; `DocxEditorContent` renders the surface element and attaches it.
- `useEditorState(selector, isEqual?)` returns a read-only ref. ONE subscription per Root
  multiplexes `change`, `selectionChange` and `error` into a version tick; each consumer keeps
  the memoized `(snapshot, slice)` pair React's hook keeps, so a page-number consumer sleeps
  through a bold toggle. The notification stays coalesced and deferred, because the facade emits
  `change` before the layout scheduler publishes and that ordering is not a React quirk.
- Twenty-six more composables, each returning a plain object of refs and functions — never a
  `reactive()` — so destructuring keeps reactivity. Return-type NAMES match React exactly; the
  VALUES are ref-shaped, which is the framework difference the two packages are allowed.
- The compounds — `DocxEditorToolbar`, `DocxEditorMenu`, `DocxEditorContextMenu`,
  `DocxEditorNavigation`, `DocxEditorHyperLink`, `DocxEditorContentControl` — with React's
  default-set-plus-in-place-override semantics, ported once and shared by all three surfaces.
  Arrangements derive from `CHROME_GROUPS` / `CHROME_MENUS`, never hand-listed.

**The engine resolves to one copy, and the package installs**

- `@docx-editor.dev/core` moves from `dependencies` to `peerDependencies` + a `workspace:*`
  `devDependency`, the shape `packages/react/package.json` already has and
  `packages/react/test/package-dependencies.test.ts` already pins.
- The build moves to `tsup`, with the engine, `vue`, the i18n package, `harfbuzzjs` and
  `emf-converter` external, and `metafile: true`. The metafile is not optional:
  `scripts/generate-third-party-notices.mjs` reads `dist/metafile-*.json`, the run is
  all-or-nothing, and a publishable package with no attribution path fails the release.
- `@docx-editor.dev/i18n` gets a real semver range. `private: true` goes. The package joins
  `build:packages`.
- Components are render-function TypeScript (`defineComponent` + `h`), not SFCs: `tsup` does not
  compile SFCs, and `max-lines` — the only gate that catches an over-long file — counts `.ts`
  reliably.

**A gate that compares SHAPE, not just names**

Every gate in the repository compares names. `check:export-parity` diffs export sets,
`check:public-docs-surface` asserts a name appears in prose, and `check:parity-contract` — the
only member-level check — covers exactly `DocxEditorProps` and `DocxEditorRef`. So a `useZoom`
returning nine of thirteen members, a `useEditorCommand` returning `{ run, active, enabled,
reason }`, a `useEditorValueCommand` with one overload instead of two, and a `useDocxSource`
that dropped its `options` parameter all ship green.

`scripts/check-composable-parity.mjs` closes it. Over the two API Extractor snapshots, for every
`use*` export, every interface one returns, and every other shared interface, it asserts the
member names, the member types, the parameter names and optionality, the overload count, and the
return type name — in BOTH directions, so a member added to React alone fails too. Exactly two
normalizations carry the framework difference: a ref wrapper unwraps to its inner type, and
`MaybeRefOrGetter<T>` in a parameter position reduces to `T`. Deprecated symbols are skipped by
their tag. No third normalization, no allowlist, no opt-out file.

It is written in phase 2b against an EMPTY Vue package, where it reports twenty-eight missing
composables and each one turns it greener. Shape is not behaviour, so it is paired with a
differential: one table of (composable, action, assertion) run against both adapters from a
single source.

**The gates come back on**

- `check:export-parity` ends with the divergence file at ZERO entries, and the file is deleted.
- `check:parity-contract` is restored to `ci.yml`. `scripts/parity/parity.contract.json` empties
  `deferredInVue` into `paired` and keeps three form categories and no fourth: an EMIT for a
  React callback prop, a SLOT for `children` or a render prop, and native attribute fallthrough
  for `className`.
- `check:public-docs-surface` gains a `vue composition and composables surface` bucket, and
  `docs/site/content/vue/` gets the five pages `react/` has, registered in BOTH `meta.json`
  files.

**Nuxt stops lying**

`packages/nuxt/src/module.ts` imports `@docx-editor.dev/vue/composables` and
`@docx-editor.dev/vue/styles.css` — neither subpath exists — and auto-imports fifteen composable
names from the removed package. Subpath parity is strict and React has one entry, so Vue keeps
one: the module auto-imports from the package root and points at
`@docx-editor.dev/core/styles/editor.css` for the stylesheet.

## Impact

- Affected specs: `vue-adapter-packaging`, `vue-adapter-composition`, `vue-adapter-composables`,
  `vue-adapter-chrome` (all new).
- Affected code: `packages/vue/src/**` and `packages/vue/test/**` (removed and rebuilt),
  `packages/react/src/index.ts` and the pre-v2 chrome files (deprecation tags only),
  `packages/nuxt/src/module.ts`, `scripts/parity/parity.contract.json`,
  `scripts/check-public-docs-surface.mjs`, `scripts/check-composable-parity.mjs` (new),
  `package.json` scripts, `eslint.config.js`, `.github/workflows/ci.yml`,
  `docs/site/content/vue/**`, `docs/site/content/meta.json`, `examples/vue/src/**`.
- ONE additive `packages/core` change: `LOADING_SNAPSHOT` moves from
  `packages/react/src/editor/loading-snapshot.ts` into `core/editor`, because Vue cannot import a
  React file and the two hand-rolled copies have already drifted. Nothing else in the engine
  moves: every capability the Vue surface exposes already exists on the `Editor` facade or in
  `core/editor`, so the rest is wiring.
- `@docx-editor.dev/vue` becomes publishable. Published packages are one fixed group, so the
  changeset declares one bump and the rest follow. A deprecation is a minor; the removal is the
  major that follows.

## Extended scope

- `@docx-editor.dev/pro/vue` now supplies the `DocxEditorReview` rail and review composables.
  The public `Editor.retainSelection()` and `Editor.releaseSelection()` methods let compose
  fields preserve the selected range without using the surface escape hatch.
- `@docx-editor.dev/pro/vue` also supplies `CustomNodeChrome`,
  `CustomNodeContextMenu`, and the activation helpers. These match the React Pro
  chrome for custom-node color, click, hover, edit, and remove actions.

## Out of scope

- REMOVING the deprecated React chrome. That is the next major, and it is not this change's to
  spend.

Vue image AUTHORING chrome is IN scope, because `ImageInsertProvider`, `ImageInsertTrigger`,
`ImageWrap`, `ImageAltText`, `ImagePropertiesTrigger` and `DocxEditorImagePropertiesDialog` are
non-deprecated React exports. That overlaps `vue-drawing-authoring-parity`, which is proposed and
unstarted at 0/14: fold it into phase 8 and archive it, or keep it as the tracking change for
that phase. Owner call, recorded so it is not decided by accident.
