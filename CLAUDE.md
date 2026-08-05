# docx-editor.dev

WYSIWYG editor and rendering engine for DOCX. Output must look identical to MS
Word: preserve fonts, theme colors, styles, tables, headers/footers, section
layout.

## Repo topology

This repo contains contracts, production engine packages, and adapters.

- `packages/core` is the private `@docx-editor.dev/core-contract`.
- `packages/engine-*` contains the in-tree engine. Package responsibilities and
  dependency rules live in `docs/architecture/production-engine-packages.md`.
- Adapters live in `packages/react`, `packages/vue`, and `packages/nuxt`.
  `packages/editor-api` provides the public `DocxEditor` object model, and
  `packages/i18n` provides shared strings.

The sole active production authority is
`openspec/changes/typed-ooxml-paragraph-editor/`. Superseded active proposals
are not requirements or task-sequencing authority.

## Architecture — one pipeline

There is ONE preservation model and ONE pipeline:

`bytes -> readOoxmlPackage (bounded OPC/XML) -> canonical typed+generic OoxmlNode
tree per part -> TreeDocumentStore -> semantic-layout -> semantic-paint (painted
pages ARE the editable surface) -> normalizing serializeOoxmlPart save`

Decisions:

- **Canonical tree**: typed kinds where layout needs them (paragraph/run/table
  vocabulary); everything else is a lossless `generic` node. Invalid/misplaced
  known elements demote to generic. Unknown content never locks editing.
- **Fidelity**: structural, gated by the D9 oracles (`canonicalOoxmlFingerprint`
  - save/reopen `semanticDigest`). Modeled XML parts re-emit normalized;
    byte identity applies to non-XML parts only.
- **Mutation**: `TreeDocumentStore.transact` over `TreeDocOp`s (node id +
  UTF-16 offset) is the only write path; the node index makes cell/nested
  paragraphs ordinary. Cross-cell joins refused (`not-adjacent-siblings`).
- **Layout** (`semantic-layout.ts`): DOM-free, injected `TextMeasurer`, points
  everywhere (twips convert at property-read boundaries). `storyBlocks` walks
  body/hdr/ftr roots and flattens block SDTs. Tables: row pagination,
  header-row repeats, vMerge, clamped gridSpan (security guards live with the
  code). Headers/footers: laid out once per variant at flow height, attached
  per page. Incremental: per-block cache keys + flow checkpoints +
  convergence; a no-change pass returns previous pages by identity.
  Paragraph-level fidelity resolves through the style cascade
  (`layout/style-cascade.ts`): `w:spacing` line rules, first-line/hanging
  indents, `w:contextualSpacing`, `w:pBdr` on all edges, tab stops and leaders,
  `w:vanish` (not measured, not painted), list markers from `numbering.xml`,
  and table styles through their `basedOn` chain gated by `w:tblLook`.
- **Paint/interaction**: painted pages are contenteditable but the DOM is a
  picture — browser mutations are prevented and re-expressed as tree ops.
  Selection maps only through `data-paragraph-id`/`data-start`. Page furniture
  is `contenteditable=false` + `[data-docx-hf]`, excluded from selection.
- **Caret** (`editor/surface-caret.ts`): the engine paints its own insertion
  point and suppresses the native one (`caret-color: transparent` on the pages
  layer) for exactly as long as it does. Geometry comes from `caretAt` on the
  layout, never from the DOM, so an empty paragraph gets a caret too. The
  element is furniture (`data-docx-marker`, `contenteditable=false`) and lives
  on the page content box, not on a line — dom-selection reads child indices.
  Everything fails soft: range selection, IME composition, or an unplaced
  position hands the native caret back rather than leaving no caret.
- **Input** (`editor/surface-input.ts`): one keymap for every host — Word's
  paragraph shortcuts, `beforeinput` dispatch, clipboard, IME readback — as
  factories over `PaginatedSurface`, so React, Vue and a plain page cannot
  drift into three hand-written keymaps.
- **`createDocxEditor`** (`core/src/editor/docx-editor.ts`): full `Editor`
  contract over the surface; unimplemented reads return typed empty values
  (the `isActive` precedent). `snapshot()` is version-cached — same reference
  until state moves, sub-objects reference-stable (`useSyncExternalStore`
  contract); `perf` sits outside the snapshot. `attach(el)`/`detach()` split
  creation from mounting; detach remounts from saved bytes (undo/caret reset).
  Real derived reads: `getDocumentFonts/Styles/Outline`, formatting, page setup.
- **Chrome registry** (`core/src/editor/chrome-controls.ts`): `CHROME_GROUPS`
  is the toolbar taxonomy for both adapters; `ChromeSlotId` (`text.bold`,
  `font.family`, …) is public API — renames are breaking.
  `commandForSlot`/`commandForSlotValue` is the command table;
  `toolbarCommandState`/`runToolbarCommand` provide shared can-before-exec
  state. Unwired slots render disabled with the engine's reason.
  `ChromeControlState` says HOW a control dispatches (`command` / `value` /
  `save`), never whether it is enabled — enabled state has exactly one source,
  `toolbarCommandState`. There is no static "permanently disabled" kind: the
  old `parityOnly` went stale the moment the engine wired those slots.

## React adapter — provider-first, everything is hooks

`DocxEditor.Root` (owns the instance; created in an effect, StrictMode-safe,
container-less) → `DocxEditor.Viewport` (renders the engine's load-bearing
scroll classes) → `DocxEditor.Content` (attach/detach in a layout effect).
All chrome — ours and consumers' — is hook consumers:

- `useDocxEditor()`, `useEditorState(selector, isEqual?)` (one multiplexed
  subscription, slice memoization — a page selector must NOT re-render on a
  bold toggle), `useEditorCommand(slotId)` → `{execute, isActive, isEnabled,
disabledReason}`, `useEditorEvent`, `useFontFamily`.
- `DocxEditor.Toolbar`: default arrangement derives FROM `CHROME_GROUPS` (never
  hand-listed). Customization ladder: `className`/`data-active` CSS → `icon`
  prop → `asChild` (in-tree Slot merges wiring onto the consumer's element) →
  in-place slot override (a part child replaces its slot; `hidden` removes;
  `preset={false}` opts out) → raw hooks. Complex parts are compounds
  (`FontFamily.Trigger/Content/Item`) over a part-level context.
- `<DocxEditor>` (props + the 7-member `DocxEditorRef`) is sugar over the same
  primitives — parity-contract gated, do not widen the ref.
- Toolbar/chrome mousedown must `preventDefault()` (skip INPUT/SELECT/
  TEXTAREA) or it steals the caret.
- Public surface language: describe capabilities, never engine history; no
  implementation names (e.g. "tree") in exported symbols.

Out of scope so far: structural table ops (insert row/column, merge),
comments/tracked-changes derivation, caret scroll-into-view,
zoom-without-remount, the Vue twin of provider/hooks. React ships scoped
header/footer and footnote/endnote editing chrome; Vue furniture/notes chrome
is deferred. Vue's toolbar now derives its enabled state from the same
`toolbarCommandState`, but it has grown no value chrome (font list, size,
colour), so those slots stay disabled there.

## Verify

```bash
bun run typecheck
bun test
bun run check:parity
bun run api:check
bun run i18n:validate
openspec validate typed-ooxml-paragraph-editor --strict
```

- Local commits may use `git commit --no-verify`. Run relevant scoped checks
  first and report any bypassed failing gate instead of describing it as passing.
- Compare `bun test` with the non-clean baseline recorded in the active change.
- `bun run format` before pushing.

## React/Vue parity

Use the private React harness to stabilize the active slice. Production
integration must then land through thin React and Vue hosts with paired
behavior. Keep platform-neutral logic in the engine packages; adapter-only glue
may diverge.

`scripts/parity/parity.contract.json` enumerates paired
`DocxEditorProps`/`DocxEditorRef` members; CI runs `bun run
check:parity-contract`. Adding an adapter prop/ref method: edit the adapter, `bun
run api:extract`, add it to the right contract bucket (`paired`,
`deferredInVue`, `pairedViaInheritance`, `vueExclusive`), rerun the check.

**UI styling is single-source-of-truth.** All editor chrome CSS + color tokens
live in the core stylesheet; both adapters only `@import` it (enforced by `bun
run check:adapter-css-thin`). Never hardcode hex/rgba in components; use the
`--doc-*` tokens or shadcn token utilities. The document canvas (rendered output)
is not themed and stays Word-faithful.

## Public API surface

API Extractor snapshots live in `docs/api/<pkg-slug>/<entry>.api.md`; CI runs
`bun run api:check`. On drift: `bun run api:extract`, commit the snapshot.
Changing a `@public` symbol: tag it in TSDoc, rebuild, re-extract, commit.
`bun run docs:json` generates downstream-consumer JSON (gitignored; CI smoke).

Vue composables must declare a named `Use<Name>Return` interface and annotate the
return type, or core's internal types leak into the API Extractor snapshot.

## Security — untrusted DOCX/HTML input

**Treat every value from a DOCX, pasted HTML, or embedded part as
attacker-controlled.** A `.docx` is a zip of XML an attacker fully controls: font
names, hyperlink targets, shape attrs, image rels, run text. Sanitize at the
**bounded parse/trust boundary** (the parser-neutral XML read plus typed/generic
tree construction, and PM `parseDOM` where applicable), not at render time, so
every downstream runtime sink receives a sanitized projection. The authoritative
contract is
`openspec/changes/typed-ooxml-paragraph-editor/specs/typed-ooxml-canonical-tree/`.

When you add/touch anything that **parses or renders unknown files** (parsers,
typed/generic tree construction or serialization, DOM output, PM
`toDOM`/`parseDOM`, clipboard, print), audit these before merging:

- **No HTML-from-strings.** Never build DOM from file-derived values via
  `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`. Build with
  `document.createElement(NS)` + `setAttribute`/`textContent`.
- **URLs go through `sanitizeHref`** — allowlist `http(s)/mailto/tel/ftp`, drop
  `javascript:`/`data:`/`vbscript:`/`file:`, strip embedded tab/LF/CR. Apply to
  every `href`, image `hlinkHref`, and `window.open(...)` arg.
- **Escape strings interpolated into CSS** — `@font-face` family names and any
  inline `style` built from file data.
- **XML safety** — the selected parser must not resolve DTDs/external entities
  (XXE) or expand nested entities (billion-laughs); parser choice is an
  implementation detail behind the bounded trust boundary.
- **Zip safety** — decompression-ratio/size cap (zip bomb); reject part/rel/media
  paths with `..` or a leading `/` (path traversal).
- **No zero-click external fetch** — never auto-load a remote target from a file
  (external-mode image/font/link rels `TargetMode="External"`, remote `src`, CSS
  `url()`/`@import`). Fetch only same-origin/embedded parts; gate remote loads
  behind explicit user action.
- **Resource limits** — cap recursion depth (nested tables/shapes/SDT/groups) and
  element counts; never feed a file-supplied number into allocation/`.repeat()`/a
  loop bound. Avoid catastrophic-backtracking regex on file-derived strings.
- **XML injection on save** — escape every attacker-derived string written back
  into XML on serialize (`escapeXml`); never template a raw value into markup.
- **Prototype pollution** — guard `JSON.parse`-of-file-data merges and any
  XML-attribute-name -> object-key assignment against
  `__proto__`/`constructor`/`prototype`.
- **Field codes / OLE / embedded objects** — never execute or auto-resolve field
  instructions (DDE, `INCLUDE*`) or embedded OLE/macro content; render inert.

Quick audit grep for a file-handling diff:

```bash
grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document\.write|window\.open\(|\.href\s*=|font-family:.*\$\{" packages --include="*.ts" --include="*.tsx" --include="*.vue" | grep -viE "test|\.spec\."
```

When you touch one sink, check sibling sinks so the same class isn't left open
elsewhere. `openPrintWindow` (core print util, `PrintPreview`) still builds its
popup via `document.write` with an unescaped `title`/`content` — a known sink to
harden, not a safe reference.

## i18n

`packages/i18n/en.json` is source of truth. Other locales mirror its shape with
`null` = fall back to English. Missing key = CI fails.

```ts
import { useTranslation } from '../i18n';
const { t } = useTranslation();
t('toolbar.bold');
t('dialogs.findReplace.matchCount', { current: 3, total: 15 });
```

New string: add to `en.json`, use `t('key')`, `bun run i18n:fix`. New language:
`bun run i18n:new <code>`, fill nulls, `bun run i18n:status`. Validate: `bun run
i18n:validate`. Never hardcode user-facing English in components.

## Docs site

Website docs (docx-editor.dev/docs) are authored here in `docs/site/content/`
(MDX) and synced by the site repo at build time. Feature-support claims live in
`docs/site/data/word-features.ts` (typed matrix), never hand-written in prose. A
feature PR that changes user-visible behavior updates both in the same PR.

**Nav gotcha — two meta.json files must agree.** The sidebar/overview is driven
by the `"root": true` `docs/site/content/meta.json` (full paths, e.g.
`guides/dark-mode`); each subfolder also has its own `meta.json`. A new page must
be registered in BOTH, or it is reachable by URL but missing from the sidebar.

OOXML reference: `reference/quick-ref/wordprocessingml.md`, `themes-colors.md`;
schemas in `reference/ecma-376/part1/schemas/`. PDFs are gitignored — run `bun
run reference:fetch` once when needed.

## Releasing (changesets)

Every code PR: `bun changeset` (or a correct hand-written `.changeset/*.md`),
commit it. Skip only for test/docs/CI-only PRs.

- Frontmatter package name MUST exactly match a published package and the bump
  MUST be `patch`/`minor`/`major`; a wrong name crashes the Release workflow.
  Copy the exact name from an existing `.changeset/*.md`.
- All published packages are a fixed group — declare one bump, others follow.
- Default `patch`; `minor` for additive public API; `major` for breaks.
- Summary lands verbatim in CHANGELOG: concise, consumer-facing (what changed,
  not how), `Fixes #N` at the end if relevant. No emojis, no marketing.

Don't: push the `chore: release` commit by hand; delete `.changeset/*.md` outside
`changeset version`; edit `CHANGELOG.md` or `package.json#version` by hand.

## PR style

Short factual title (conventional-commit prefix). Body is the minimum the diff
doesn't show, often one sentence. Don't `@`-mention contributors, reference
unrelated PR/issue numbers, list changed files, add tooling footers, or use
emojis.

## Bugs / dev

Issue tracker: `gh issue view <N> --repo eigenpal/docx-editor`. Dev server: `bun
run dev` -> `http://localhost:5173/`. Live demo: `http://docx-editor.dev/editor`.
Commit format: `fix: ... (fixes #N)`. Screenshots -> `screenshots/`.

## Pitfalls

- **No `require()`** — ESM only.
- **Tailwind scope** — library scoped to `.ep-root`; rendered output isn't always
  protected, so use inline styles on painted/IR-emitted elements.
- **Focus stealing** — any mousedown that bubbles to PM moves the caret;
  dropdown/dialog mousedown needs `stopPropagation()`.
- **Icons** — inline SVG (Material Symbol paths), not a font. A missing name
  renders raw text.
