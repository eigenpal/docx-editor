# docx-editor.dev

WYSIWYG editor and rendering engine for DOCX. Output must match MS Word: fonts,
theme colors, styles, tables, headers/footers, section layout.

## Packages

One engine. Thin chrome on top.

| Package       | What                                                                                                                                                                                           | Status                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `core`        | **The engine.** `store/` (canonical tree, ops, OPC read/write), `layout/` (DOM-free), `output/` (paint), `editor/` (facade, surface, chrome registry), `contracts/`, `binding/`, `automation/` | published, external to `react`               |
| `react`       | The adapter: provider + hooks, holds no editing state                                                                                                                                          | published                                    |
| `i18n`        | Shared strings                                                                                                                                                                                 | published                                    |
| `editor-api`  | `DocxEditor` automation object model, headless/server                                                                                                                                          | published, Pro license                       |
| `pro`         | Review module (comments, tracked changes) + custom nodes, as `EditorModule`s                                                                                                                   | published, Pro license                       |
| `fonts`       | Metric-compatible substitutes for Word's defaults                                                                                                                                              | published                                    |
| `vue`, `nuxt` | WIP, not shipping                                                                                                                                                                              | private                                      |

React is the only real adapter today. Parity rules below are the target, not the
state.

**The engine must resolve to ONE copy.** It holds module-level state — the
HarfBuzz shaper and its cache budget, the grapheme boundary strategy, layout
caches keyed by object identity. Two copies in a tree do not crash; they load the
shaper twice and miss every identity-keyed cache, quietly. So `core` is external
to `react` (not inlined) and a **peer** of both `react` and `pro`, which makes the
package manager resolve one and say so at install when it cannot. Both adapters
assert their own dependency shape:
`packages/{react,pro}/src/__tests__/package-dependencies.test.ts`. Never move
`core` back to a regular `dependency`.

Inside `core`, each directory is a guarded lane with a declared dependency edge
and environment (`store` and `layout` are DOM-free, `binding` is the only
PM-aware one). The DAG is machine-readable in
`packages/core/src/__tests__/core-lane-graph.ts` and documented in
`docs/architecture/production-engine-packages.md`. A lane taking a new dependency
edits that DAG.

Active production authority: `openspec/changes/typed-ooxml-paragraph-editor/`.
Superseded proposals are not requirements.

## Architecture — one pipeline

```
bytes → readOoxmlPackage (bounded OPC/XML) → canonical OoxmlNode tree per part
→ TreeDocumentStore → semantic-layout → semantic-paint → serializeOoxmlPart
```

**The tree store is the only source of truth.** Painted pages ARE the editable
surface — contenteditable, but the DOM is a picture: browser mutations are
prevented and re-expressed as tree ops.

**ProseMirror is only a projection** of one tree revision. The reverse direction
never reconstructs the tree from it: it diffs the edited doc against the tree it
came from, emits the smallest `TreeDocOp`s that explain the difference, or
refuses outright (`TreeBindingRejection`). A silently-dropped edit is worse than
a refused one, because only the refusal can be reconciled. PM exists only in
`core/src/binding/`; `store`, `layout`, `output` and `contracts` are PM-free,
enforced by `store/__tests__/prosemirror-isolation.test.ts`.

- **Canonical tree** — typed kinds where layout needs them (paragraph/run/table);
  everything else is a lossless `generic` node. Invalid or misplaced known
  elements demote to generic. Unknown content never locks editing.
- **Fidelity** — structural, gated by two D9 oracles: `canonicalOoxmlFingerprint`
  and a save/reopen `semanticDigest`. Modeled XML parts re-emit normalized; byte
  identity applies to non-XML parts only.
- **Mutation** — `TreeDocumentStore.transact` over `TreeDocOp`s (node id + UTF-16
  offset) is the only write path. The node index makes cell and nested paragraphs
  ordinary. Cross-cell joins refused (`not-adjacent-siblings`).
- **Layout** (`layout/semantic-layout.ts`) — DOM-free, injected `TextMeasurer`,
  points everywhere (twips convert at property-read boundaries). `storyBlocks`
  walks body/hdr/ftr roots and flattens block SDTs. Tables: row pagination,
  header-row repeats, vMerge, clamped gridSpan. Headers/footers laid out once per
  variant at flow height, attached per page. Incremental: per-block cache keys +
  flow checkpoints + convergence; a no-change pass returns previous pages by
  identity. Paragraph fidelity resolves through `layout/style-cascade.ts`:
  `w:spacing` line rules, first-line/hanging indents, `w:contextualSpacing`,
  `w:pBdr` on all edges, tab stops and leaders, `w:vanish` (not measured, not
  painted), list markers from `numbering.xml`, table styles via `basedOn` gated
  by `w:tblLook`.
- **Selection** — maps only through `data-paragraph-id`/`data-start`. Page
  furniture is `contenteditable=false` + `[data-docx-hf]`, excluded from
  selection.
- **Caret** (`editor/surface-caret.ts`) — the engine paints its own and
  suppresses the native one (`caret-color: transparent` on the pages layer) for
  exactly as long as it does. Geometry comes from `caretAt` on the layout, never
  the DOM, so an empty paragraph gets a caret too. The element is furniture
  (`data-docx-marker`, `contenteditable=false`) on the page content box, not on a
  line. Fails soft: range selection, IME composition or an unplaced position
  hands the native caret back rather than leaving none.
- **Input** (`editor/surface-input.ts`) — one keymap for every host (Word's
  paragraph shortcuts, `beforeinput` dispatch, clipboard, IME readback) as
  factories over `PaginatedSurface`, so hosts cannot drift into separate
  hand-written keymaps.
- **`createDocxEditor`** (`editor/docx-editor.ts`) — the full `Editor` contract
  over the surface; unimplemented reads return typed empty values. `snapshot()`
  is version-cached: same reference until state moves, sub-objects
  reference-stable (`useSyncExternalStore` contract), `perf` outside it.
  `attach(el)`/`detach()` split creation from mounting; detach remounts from
  saved bytes (undo/caret reset).
- **Chrome registry** (`editor/chrome-controls.ts`) — `CHROME_GROUPS` is the
  toolbar taxonomy; `ChromeSlotId` (`text.bold`, `font.family`, …) is public API,
  so renames are breaking. `commandForSlot`/`commandForSlotValue` is the command
  table; `toolbarCommandState`/`runToolbarCommand` give shared can-before-exec.
  `ChromeControlState` says HOW a control dispatches (`command`/`value`/`save`),
  never whether it is enabled — enabled state has exactly one source,
  `toolbarCommandState`. Unwired slots render disabled with the engine's reason.

## React adapter

`DocxEditor.Root` (owns the instance, created in an effect, StrictMode-safe,
container-less) → `.Viewport` (the engine's load-bearing scroll classes) →
`.Content` (attach/detach in a layout effect). All chrome is a hook consumer.

- `useDocxEditor()`, `useEditorState(selector, isEqual?)` (one multiplexed
  subscription + slice memoization — a page selector must NOT re-render on a bold
  toggle), `useEditorCommand(slotId)` → `{execute, isActive, isEnabled,
disabledReason}`, `useEditorEvent`, `useFontFamily`.
- `DocxEditor.Toolbar` arrangement derives FROM `CHROME_GROUPS`, never
  hand-listed. Customization ladder: `className`/`data-active` → `icon` prop →
  `asChild` → in-place slot override (`hidden` removes, `preset={false}` opts
  out) → raw hooks. Complex parts are compounds
  (`FontFamily.Trigger/Content/Item`) over a part-level context.
- `<DocxEditor>` (props + the 7-member `DocxEditorRef`) is sugar over the same
  primitives. Parity-contract gated; do not widen the ref.
- Chrome mousedown must `preventDefault()` (skip INPUT/SELECT/TEXTAREA) or it
  steals the caret.
- Exported names describe capabilities, never engine internals (no "tree").

Not built yet: structural table ops (insert row/column, merge),
comments/tracked-changes derivation, caret scroll-into-view,
zoom-without-remount, the Vue twin of provider/hooks.

## Verify

```bash
bun run typecheck
bun run test
bun run check:parity
bun run api:check
bun run i18n:validate
openspec validate typed-ooxml-paragraph-editor --strict
```

- `bun run test` shards the suite one process per file across a worker pool
  (`scripts/test/run-parallel.mjs`, `--jobs N` to pin the width). That is also
  what CI runs. `bun test` still works and is the one to reach for when you want
  a single file, `-t`, or `--watch`; `bun run test:serial` is the whole suite the
  old way.
- A file that leaves state on `document` can only be caught by the serial run —
  per-file processes hide it. Scope DOM queries to the container you mounted.
- `git commit --no-verify` is fine locally. Run the relevant scoped checks first,
  and report a bypassed failing gate instead of calling it passing.
- Compare the run against the non-clean baseline in the active change.
- `bun run format` before pushing.

## Parity and styling

Platform-neutral logic goes in the engine; adapter-only glue may diverge.
`scripts/parity/parity.contract.json` enumerates paired
`DocxEditorProps`/`DocxEditorRef` members. Adding an adapter prop or ref method:
edit the adapter, `bun run api:extract`, add it to the right bucket (`paired`,
`deferredInVue`, `pairedViaInheritance`, `vueExclusive`), rerun `bun run
check:parity-contract`.

All editor chrome CSS and color tokens live in the core stylesheet; adapters only
`@import` it (enforced by `bun run check:adapter-css-thin`). Never hardcode
hex/rgba — use `--doc-*` tokens or shadcn utilities. The document canvas is not
themed; it stays Word-faithful.

## Public API

API Extractor snapshots live in `docs/api/<pkg-slug>/<entry>.api.md`; CI runs
`bun run api:check`. On drift: `bun run api:extract`, commit. Changing a
`@public` symbol: tag it in TSDoc, rebuild, re-extract, commit. `bun run
docs:json` generates consumer JSON (gitignored, CI smoke test).

Vue composables must declare a named `Use<Name>Return` interface and annotate the
return type, or core's internal types leak into the snapshot.

## Security — untrusted input

**Every value from a DOCX, pasted HTML or embedded part is attacker-controlled.**
A `.docx` is a zip of XML the sender fully controls: font names, hyperlink
targets, shape attrs, image rels, run text. Sanitize at the bounded parse/trust
boundary (XML read + typed/generic tree construction), never at render time, so
every downstream sink receives a sanitized projection. Contract:
`openspec/changes/typed-ooxml-paragraph-editor/specs/typed-ooxml-canonical-tree/`.

Audit these whenever you touch parsing, serialization, `output/semantic-paint*`,
clipboard or print:

- **No HTML from strings** — no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/
  `document.write` on file-derived values. Use `createElement(NS)` +
  `setAttribute`/`textContent`.
- **URLs through `sanitizeHref`** — allowlist `http(s)/mailto/tel/ftp`, drop
  `javascript:`/`data:`/`vbscript:`/`file:`, strip embedded tab/LF/CR. Every
  `href`, image `hlinkHref`, and `window.open(...)` arg.
- **Escape strings interpolated into CSS** — `@font-face` family names, and any
  inline `style` built from file data.
- **XML** — no DTD/external entity resolution (XXE), no nested entity expansion
  (billion-laughs).
- **Zip** — decompression ratio/size cap; reject part/rel/media paths with `..`
  or a leading `/`.
- **No zero-click external fetch** — never auto-load `TargetMode="External"`
  rels, remote `src`, or CSS `url()`/`@import`. Gate remote loads behind an
  explicit user action.
- **Resource limits** — cap recursion depth (nested tables/shapes/SDT/groups) and
  element counts. Never feed a file-supplied number into allocation, `.repeat()`
  or a loop bound. No catastrophic-backtracking regex on file-derived strings.
- **Escape on save** — `escapeXml` every attacker-derived string; never template
  a raw value into markup.
- **Prototype pollution** — guard `JSON.parse` merges and any
  XML-attribute-name → object-key assignment against
  `__proto__`/`constructor`/`prototype`.
- **Field codes / OLE** — never execute or auto-resolve field instructions (DDE,
  `INCLUDE*`) or embedded OLE/macro content. Render inert.

```bash
grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document\.write|window\.open\(|\.href\s*=|font-family:.*\$\{" packages --include="*.ts" --include="*.tsx" --include="*.vue" | grep -viE "test|\.spec\."
```

Fix sibling sinks when you fix one. `openPrintWindow` still builds its popup via
`document.write` with an unescaped `title`/`content` — a known sink to harden,
not a reference.

## i18n

`packages/i18n/en.json` is source of truth; other locales mirror its shape with
`null` = fall back to English. A missing key fails CI.

```ts
const { t } = useTranslation();
t('toolbar.bold');
t('dialogs.findReplace.matchCount', { current: 3, total: 15 });
```

New string: add to `en.json`, use `t('key')`, `bun run i18n:fix`. New language:
`bun run i18n:new <code>`, fill nulls, `bun run i18n:status`. Never hardcode
user-facing English in components.

## Docs site

Authored here in `docs/site/content/` (MDX), synced by the site repo at build
time. Feature-support claims live in `docs/site/data/word-features.ts` (typed
matrix), never hand-written in prose. A PR that changes user-visible behavior
updates both.

**Two `meta.json` must agree.** The `"root": true`
`docs/site/content/meta.json` drives the sidebar with full paths; each subfolder
has its own. Register a new page in BOTH, or it is URL-reachable but missing from
the sidebar.

OOXML reference: `reference/quick-ref/wordprocessingml.md`, `themes-colors.md`;
schemas in `reference/ecma-376/part1/schemas/`. PDFs are gitignored — run `bun
run reference:fetch` once when needed.

## Releasing

Every code PR gets a changeset (`bun changeset`, or a correct hand-written
`.changeset/*.md`). Skip only for test/docs/CI-only PRs.

- The frontmatter package name must exactly match a published package and the
  bump must be `patch`/`minor`/`major`. A wrong name crashes the Release
  workflow — copy it from an existing changeset.
- Published packages are one fixed group: declare one bump, the rest follow.
- Default `patch`; `minor` for additive public API; `major` for breaks.
- The summary lands verbatim in CHANGELOG: consumer-facing, what changed not how,
  `Fixes #N` at the end if relevant. No emojis, no marketing.
- Keep the summary minimal: one sentence, two at most. No bullet lists, no
  implementation detail.

Never push the `chore: release` commit by hand, delete `.changeset/*.md` outside
`changeset version`, or hand-edit `CHANGELOG.md` / `package.json#version`.

**Third-party notices.** Every publishable package ships a
`THIRD_PARTY_NOTICES.md` reproducing the license of each package esbuild inlines
into its bundles — core pulls in fast-xml-parser, fflate and prosemirror-\*, and
MIT/Apache-2.0 both require the notice to travel with the copy. The Release
workflow generates it from `dist/metafile-*.json` just before publishing; the
file is gitignored, so regenerate with `bun run build:packages && bun run
notices:generate`. `notices:check` compares against the CURRENT `dist/`, so it
only means anything right after a build and reports "missing" on a clean tree by
design. The run is all-or-nothing: a tsup config that stops emitting `metafile:
true`, a bundled dependency with no license text, or a `files` array that forgets
the notice fails it — and a failure deletes the notices rather than shipping a
stale one. A publishable package that is not a tsup bundle has no metafile and
fails until it gets an attribution path; `packages/fonts` carries OFL text in
`licenses/`, which no metafile can see.

## Conventions

- **PRs** — short factual title (conventional-commit prefix); body is the minimum
  the diff doesn't show, often one sentence. No `@`-mentions, unrelated issue
  numbers, file lists, tooling footers or emojis.
- **Bugs** — `gh issue view <N> --repo eigenpal/docx-editor`. Dev server `bun run
dev` → `http://localhost:5173/`. Live demo `http://docx-editor.dev/editor`.
  Commit `fix: ... (fixes #N)`. Screenshots → `screenshots/`.
- **ESM only** — no `require()`.
- **Tailwind** — scoped to `.ep-root`; rendered output isn't always protected, so
  use inline styles on painted elements.
- **Focus stealing** — painted pages are the editable surface, so any mousedown
  reaching them moves the caret.
- **Icons** — inline SVG (Material Symbol paths), not a font. A missing name
  renders raw text.
