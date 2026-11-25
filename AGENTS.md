# docx-editor.dev

WYSIWYG editor and rendering engine for DOCX.

## Start here

**Before any work, have the standard in your checkout.** Check that `reference/ecma-376/part1/text/index.tsv` exists. If it does not, run `bun run reference:fetch` first. Git ignores these files, so each new clone and each new git worktree starts without them. Do not start a task, a review, or an investigation without them.

When you start work on an issue, find the ECMA-376 subclauses and schema types that it touches, and read them in the local text. Post them in a comment on the issue before you change code, and cite them in the code comments and the pull request.

- Cite ECMA-376 for each behavior that you add or change: the element, its schema type (`CT_*`, `ST_*`), and the subclause, in the code comment and in the pull request body.
- Never cite a subclause number from memory. Find it in the local index, and run `bun run reference:check-citations` before you push. A wrong citation is worse than none.

## Communication

Write all replies in ASD-STE100 Simplified Technical English.

- Use the active voice and simple tenses.
- Keep sentences to 20 words or fewer, with one idea each.
- Use the same word for the same idea each time.
- Do not use idioms, slang, or jargon.
- Keep paragraphs to 6 sentences or fewer.
- Keep file paths, function names, flags, and numbers exact.

In user-facing text, always use the name `EigenPal Pro License`. Do not rename the legal license files or `LicenseRef-EigenPal-Pro-Evaluation-1.0` metadata.

## Public API compatibility

All public document automation APIs keep the Office.js shape: member names, signatures, enum values, return types, and `load()` / `context.sync()` behavior. Server agents set `document.changeTrackingMode`, then create redlines with standard edits such as `range.insertText(text, 'Replace')` and `range.delete()`.

- Use existing Office.js members. Do not add competing convenience methods.
- Refuse unsupported modes and operations explicitly. Never approximate them silently.
- Record supported subsets and differences in `packages/editor-api/compat/manifest.json` and the public documentation.
- For each new public member, extend the pinned Office.js reference, conformance fixtures, and runtime tests.
- Keep host creation, collaboration transport, and job orchestration separate from the Office-shaped document model.
- Do not claim full Office.js compatibility from subset conformance.
- Record per-endpoint runtime differences in `packages/editor-api/compat/runtime-notes.json`. A signature match does not prove runtime equivalence.

`bun run --filter '@docx-editor.dev/editor-api' compat:report` checks editing methods and property writes against pinned Office.js signatures. It covers the broad editing inventory and an 81-member profile, without reads and host setup. CI reports the percentages and does not block merges. Results are in `packages/editor-api/compat/reports/`. See [Compatibility reports](packages/editor-api/compat/README.md).

### Office.js developer experience

- Load only the needed properties. Use explicit property names in examples.
- Batch independent loads and writes. Keep `context.sync()` outside per-item read loops.
- Use an explicit final `await context.sync()` when commands remain queued.
- Keep proxies within their `run()` lifetime. Pass plain data to models and job queues.
- Explain intentional sync boundaries for progressive, separately reviewable suggestions.
- Handle stable error codes. On stale reads, re-read and reconsider. Never replay model edits blindly.
- Show host and operation limits in types, JSDoc, examples, and compatibility documentation.
- Never disable tracking automatically to make an unsupported tracked edit succeed.

`packages/editor-api/OFFICE_JS_GUIDE.md` is the reference for agent-facing examples. API guides and the public member directory are in `docs/site/content/editor-api/`. Update the relevant guide and `reference.mdx` when public API behavior changes.

## Packages

| Package | What | Status |
| --- | --- | --- |
| `core` | **The engine.** `store/` (canonical tree, ops, OPC read/write), `layout/` (DOM-free), `output/` (paint), `editor/` (facade, surface, chrome registry), `contracts/`, `binding/`, `automation/` | published, external to `react` |
| `react` | The adapter: provider + hooks, holds no editing state | published |
| `i18n` | Shared strings | published |
| `editor-api` | `DocxEditor` automation object model, headless/server | published, Pro license |
| `pro` | Review module (comments, tracked changes) + custom nodes, as `EditorModule`s | published, Pro license |
| `docx-to-markdown` | DOCX to Markdown conversion with pages and media | published |
| `docx-to-pdf` | DOCX to PDF conversion on Node.js | release-enabled, EigenPal Pro License |
| `fonts` | Metric-compatible substitutes for common DOCX default fonts | published |
| `vue` | The Vue 3 adapter twin, parity-gated against `react` | published |
| `nuxt` | Nuxt module over the Vue adapter | WIP, private |

**The engine must resolve to ONE copy.** It holds module-level state: the HarfBuzz shaper and identity-keyed layout caches. A second copy silently misses every cache. So `core` is external to `react` and a **peer** of `react` and `pro`. `packages/{react,pro}/src/__tests__/package-dependencies.test.ts` asserts this. Never move `core` back to a regular `dependency`.

Each `core` directory is a guarded lane with a declared dependency edge and environment. `store` and `layout` are DOM-free. `binding` is the only PM-aware lane. The DAG is in `packages/core/src/__tests__/core-lane-graph.ts` and `docs/architecture/production-engine-packages.md`. A new lane dependency edits that DAG.

Active production authority: `openspec/changes/typed-ooxml-paragraph-editor/`. Superseded proposals are not requirements.

## Architecture

```
bytes → readOoxmlPackage (bounded OPC/XML) → canonical OoxmlNode tree per part
→ TreeDocumentStore → semantic-layout → semantic-paint → serializeOoxmlPart
```

**The tree store is the only source of truth.** Painted pages are the editable surface. The engine prevents browser mutations and re-expresses them as tree ops.

**ProseMirror is only a projection** of one tree revision. The reverse direction diffs the edited doc against its source tree. It emits the smallest `TreeDocOp`s or refuses (`TreeBindingRejection`). It never drops an edit silently. PM exists only in `core/src/binding/` (`store/__tests__/prosemirror-isolation.test.ts`).

- **Canonical tree** — typed kinds where layout needs them (paragraph/run/table). All other content is a lossless `generic` node. Invalid or misplaced known elements demote to generic. Unknown content never locks editing.
- **Fidelity** — structural, gated by `canonicalOoxmlFingerprint` and a save/reopen `semanticDigest`. Modeled XML parts re-emit normalized. Byte identity applies to non-XML parts only.
- **Mutation** — `TreeDocumentStore.transact` over `TreeDocOp`s (node id + UTF-16 offset) is the only write path. Cross-cell joins are refused (`not-adjacent-siblings`).
- **Layout** (`layout/semantic-layout.ts`) — DOM-free, injected `TextMeasurer`, points everywhere. Twips convert at property-read boundaries. `storyBlocks` walks body/hdr/ftr roots and flattens block SDTs. It is incremental: a no-change pass returns previous pages by identity. `layout/style-cascade.ts` resolves paragraph properties, list markers, and table styles.
- **Selection** — maps only through `data-paragraph-id`/`data-start` on text and `data-drawing-paragraph-id`/`data-drawing-start` on inline picture spacers. Page furniture is `contenteditable=false` + `[data-docx-hf]`.
- **Caret** (`editor/surface-caret.ts`) — the engine paints its own caret and hides the native one. Geometry comes from `caretAt` on the layout, never the DOM. Range selection, IME composition, or an unplaced position returns the native caret.
- **Input** (`editor/surface-input.ts`) — one keymap for every host, as factories over `PaginatedSurface`. Hosts do not write separate keymaps.
- **`createDocxEditor`** (`editor/docx-editor.ts`) — the full `Editor` contract. Unimplemented reads return typed empty values. `snapshot()` keeps the same reference until state moves (`useSyncExternalStore` contract). `detach()` parks the live surface and `attach(el)` moves it. Undo, selection, and collaboration survive.
- **Host window** (`editor/host-realm.ts`) — the editor can mount in another window or an iframe. Resolve document and window from an owned node (`hostDocumentOf`/`hostWindowOf`, `editorHostWindow(editor)`) at use time, never from globals. Do not use `instanceof` on DOM constructors. Register long-lived listeners through `surface-host-listeners.ts`. `no-restricted-globals` and `docx/no-cross-realm-instanceof` enforce this.
- **Chrome registry** (`editor/chrome-controls.ts`) — `CHROME_GROUPS` is the toolbar taxonomy. `ChromeSlotId` (`text.bold`, `font.family`, …) is public API, so renames are breaking. `commandForSlot`/`commandForSlotValue` is the command table. `toolbarCommandState` is the only source of enabled state. Unwired slots render disabled with the engine's reason.

## React adapter

`DocxEditor.Root` (owns the instance, StrictMode-safe) → `.Viewport` (the engine's scroll classes) → `.Content` (attach/detach in a layout effect). All chrome is a hook consumer.

- Hooks: `useDocxEditor()`, `useEditorState(selector, isEqual?)`, `useEditorCommand(slotId)`, `useEditorEvent`, `useFontFamily`. A page selector must NOT re-render on a bold toggle.
- `DocxEditor.Toolbar` arrangement derives FROM `CHROME_GROUPS`, never hand-listed. Customization ladder: `className`/`data-active` → `icon` prop → `asChild` → in-place slot override (`hidden`, `preset={false}`) → raw hooks.
- `<DocxEditor>` (props + the 7-member `DocxEditorRef`) is sugar over the same primitives. Do not widen the ref.
- Chrome mousedown must `preventDefault()` (skip INPUT/SELECT/TEXTAREA), or it steals the caret.
- Exported names describe capabilities, never engine internals (no "tree").

Feature support is in `docs/site/data/word-features.ts`. Public API snapshots are in `docs/api/`. Keep capability claims aligned with those sources.

## Collaboration verification

Collaboration support is part of each editor feature. Check it for each feature you add or change.

- Exercise the feature through two editor instances attached to real collaboration sessions.
- Verify that supported edits synchronize, converge, and survive save and reopen.
- Cover concurrent edits, undo and redo, and deletion while another participant edits the affected content.
- Check remote cursors and selections when the feature adds an editable region or changes its geometry.
- Check reconnect behavior when the feature changes shared state or operation handling.
- Add regression tests for collaboration defects. Use existing harnesses and record the compatibility decision.
- Do not infer collaboration support from local editing tests or from use of the shared document store.

## Verify

```bash
bun run typecheck
bun run lint
bun run test
bun run check:parity
bun run api:check
bun run i18n:validate
openspec validate typed-ooxml-paragraph-editor --strict
```

- **Lint** — oxlint over `packages/*/src` and `examples/*/src`. It enforces `max-lines` caps (1000 lines for most files), the rules in `scripts/oxlint/docx-rules.mjs`, and framework-isolation `no-restricted-imports`. Only lint catches the caps. Extract code; do not raise a cap. Extend `scripts/__tests__/oxlint-rules.test.ts` when you add a rule.
- **Tests** — `bun run test` runs one process per file (`--jobs N` pins the width). CI runs the same command. Use `bun test` for a single file, `-t`, or `--watch`. `bun run test:serial` runs the suite in one process.
- **`bun run test:changed`** — runs the test files that import a changed file, compared with the merge base with `main`. `--list` prints the selection.
- **`bun run test:no-collab`** — skips the collaboration tests. Use it for engine changes that do not touch shared state, operations, or the editor.
- **Memory** — the test pool gates dispatch on memory. Keep it machine-aware. A test file that needs more than a few GiB is a bug to file.
- **Document state** — only the serial run catches a file that leaves state on `document`. Scope DOM queries to the container you mounted.
- **Commits** — `git commit --no-verify` is acceptable locally. `bun run format` and `bun run lint` stay mandatory. Report a bypassed failing gate; do not call it passing.
- Compare the run against the non-clean baseline in the active change.
- **Citations** — run `bun run reference:check-citations` when you add or change a citation. It reads the local index, so CI does not run it.

## Parity and styling

Platform-neutral logic goes in the engine. `scripts/parity/parity.contract.json` lists paired `DocxEditorProps`/`DocxEditorRef` members. To add an adapter prop or ref method:

1. Edit the adapter.
2. Run `bun run api:extract`.
3. Add the member to its bucket: `paired`, `deferredInVue`, `pairedViaInheritance`, or `vueExclusive`.
4. Run `bun run check:parity-contract`.

All editor chrome CSS and color tokens are in the core stylesheet. Adapters only `@import` it (`bun run check:adapter-css-thin`). Never hardcode hex/rgba; use `--doc-*` tokens or shadcn utilities. The document canvas is not themed.

## Public API

API Extractor snapshots are in `docs/api/<pkg-slug>/<entry>.api.md`. CI runs `bun run api:check`. On drift, run `bun run api:extract` and commit. To change a `@public` symbol: tag it in TSDoc, rebuild, re-extract, commit.

Vue composables must declare a named `Use<Name>Return` interface and annotate the return type.

## Security — untrusted input

**Every value from a DOCX, pasted HTML, or embedded part is attacker-controlled.** Sanitize at the parse/trust boundary, never at render time. Contract: `openspec/changes/typed-ooxml-paragraph-editor/specs/typed-ooxml-canonical-tree/`.

Audit these when you touch parsing, serialization, `output/semantic-paint*`, clipboard, or print:

- **No HTML from strings** — no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` on file-derived values. Use `createElement(NS)` + `setAttribute`/`textContent`.
- **URLs through `sanitizeHref`** — every `href`, image `hlinkHref`, and `window.open(...)` arg. Allowlist `http(s)/mailto/tel/ftp`. Strip embedded tab/LF/CR.
- **CSS** — escape file-derived strings: `@font-face` family names and inline `style`.
- **XML** — no DTD/external entity resolution, no nested entity expansion.
- **Zip** — cap decompression ratio and size. Reject paths with `..` or a leading `/`.
- **No zero-click external fetch** — never auto-load `TargetMode="External"` rels, remote `src`, or CSS `url()`/`@import`.
- **Resource limits** — cap recursion depth and element counts. Never feed a file-supplied number into allocation, `.repeat()`, or a loop bound. No catastrophic-backtracking regex on file-derived strings.
- **Escape on save** — `escapeXml` every attacker-derived string.
- **Prototype pollution** — guard `JSON.parse` merges and XML-attribute-name → object-key assignment against `__proto__`/`constructor`/`prototype`.
- **Field codes / OLE** — never execute or auto-resolve field instructions (DDE, `INCLUDE*`) or embedded OLE/macro content.

```bash
grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|v-html|document\\.write|window\\.open\\(|\\.href\\s*=|font-family:.*\\$\\{" packages --include="*.ts" --include="*.tsx" --include="*.vue" | grep -viE "test|\\.spec\\."
```

Fix sibling sinks when you fix one. The HTML sinks are also lint errors (`docx/no-html-sinks`).

## i18n

`packages/i18n/en.json` is the source of truth. Other locales mirror its shape; `null` falls back to English. A missing key fails CI.

- New library UI string: add it to `en.json`, use `t('key')`, run `bun run i18n:fix`.
- New language: run `bun run i18n:new <code>`, fill the nulls, run `bun run i18n:status`.
- Never hardcode user-facing English in shipped library components.
- Files under `examples/` must not add keys to `packages/i18n`. Keep example-only text in the example or `examples/shared/example-text.ts`. Examples use English.

## Docs site

Docs are authored in `docs/site/content/` (MDX). Feature-support claims are in `docs/site/data/word-features.ts`, never in prose. A PR that changes user-visible behavior updates both.

- **Fidelity descriptions** — at most three sentences of 20 words or fewer. State the supported behavior and the main limitation. Put details in the relevant guide. Never append implementation history. This applies to `docs/site/data/word-features.ts` and `docs/site/content/docx-fidelity.mdx`.
- **Style** — READMEs, guides, feature descriptions, and release notes follow the [Google developer documentation style guide](https://developers.google.com/style). Use second person, active voice, present tense, sentence-case headings, American spelling, and serial commas. Write timeless text: no "currently", "new", or "soon". In procedures, never "simply", "easy", "just", "quickly", or "please". Use descriptive link text. Add alt text to every image.
- **Two `meta.json` must agree.** Register a new page in the root `docs/site/content/meta.json` AND the subfolder `meta.json`. Otherwise the page is missing from the sidebar.
- **Diagrams are mermaid**, in a ` ```mermaid ` fence, not ASCII box drawing.

OOXML reference: `reference/quick-ref/wordprocessingml.md`, `themes-colors.md`; schemas in `reference/ecma-376/part1/schemas/`; the full text and the subclause index from `bun run reference:fetch` (Start here).

## Releasing

Every code PR gets a changeset (`bun changeset`, or a hand-written `.changeset/*.md`). Skip it only for test/docs/CI-only PRs.

- The frontmatter package name must exactly match a published package. Copy it from an existing changeset; a wrong name crashes the Release workflow.
- Published packages are one fixed group: declare one bump.
- Default `patch`; `minor` for additive public API; `major` for breaks.
- The summary goes verbatim into CHANGELOG. Write one or two sentences for consumers: what changed, not how. End with `Fixes #N` if relevant. No emojis, marketing, or bullet lists.
- Collaboration format changes need a decision from `bun run collaboration:change`, at least a minor release, and migration instructions. Open them against the `collaboration-format-next` branch: format releases stay 30 days apart. See [Collaboration compatibility](docs/architecture/collaboration-compatibility.md).
- Never push the `chore: release` commit by hand, delete `.changeset/*.md` outside `changeset version`, or hand-edit `CHANGELOG.md` / `package.json#version`.

**Third-party notices.** Every publishable package ships a `THIRD_PARTY_NOTICES.md` with the license of each package esbuild inlines. The Release workflow generates it from `dist/metafile-*.json`. Only core has content: it inlines harfbuzzjs. Empty notices in other packages are correct. Regenerate with `bun run build:packages && bun run notices:generate`. Run `notices:check` only right after a build. A tsup config must emit `metafile: true`, and each `files` array must include the notice.

## Conventions

- **PRs** — short factual title with a conventional-commit prefix. The body is the minimum the diff does not show. A PR that resolves an issue MUST end its BODY with `Fixes #N`; GitHub never auto-closes from the title. No `@`-mentions, unrelated issue numbers, file lists, tooling footers, or emojis. Use the Google developer documentation style.
- **Bugs** — `gh issue view <N> --repo eigenpal/docx-editor`. Dev server `bun run dev` → `http://localhost:5173/`. Live demo `http://docx-editor.dev/editor`. Commit `fix: ... (fixes #N)`. Screenshots → `screenshots/`.
- **Issues** — every issue gets exactly ONE `area:*` label, ONE `priority:*` label, and a native type: `gh issue create --type Bug|Feature|Task --label "area:...,priority:..."`. Optional `component:*` names the package. The taxonomy is in `README.md` under "Issue conventions". The labels drive the public roadmap board.
- **ESM only** — no `require()`.
- **TypeScript** — `typecheck` scripts run `bun check` (Bun 1.4.3 or later). Declaration builds run TypeScript 7, installed as `typescript7`. The `typescript` dependency stays on 6, because build tools load it as a library. At the root and in `examples/write-agent`, call `node node_modules/typescript7/bin/tsc`; never use bare `bunx tsc`. Declarations come from `scripts/build-declarations.mjs` through `withDeclarations`. Do not turn tsup's `dts` back on.
- **Tailwind** — scoped to `.docx-editor` at core build time. Use inline styles on painted elements. Never put Tailwind utilities on the element that carries `docx-editor`; scoped utilities only match descendants.
- **Focus stealing** — any mousedown that reaches the painted pages moves the caret.
- **Icons** — inline SVG (Material Symbol paths), not a font. A missing name renders raw text.
