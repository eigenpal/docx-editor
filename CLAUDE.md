# Eigenpal DOCX Editor

Bun + React/Vue WYSIWYG editor for DOCX. Client-side only, no backend.
Per-package entries: `packages/react/src/index.ts`, `packages/vue/src/index.ts`, `packages/core/src/headless.ts`.
Output must look identical to MS Word. Preserve fonts, theme colors, styles, tables, headers/footers, section layout.

---

## Verify

```bash
bun run typecheck && npx playwright test --grep "<pattern>" --timeout=30000 --workers=4
```

- Never run full suite (500+ tests) unless final validation.
- Per-test timeout 30s; if cmd >60s, narrow scope.
- `bun run format` before pushing.

### Test file map

| Area                  | File                           |
| --------------------- | ------------------------------ |
| Bold/Italic/Underline | `formatting.spec.ts`           |
| Alignment             | `alignment.spec.ts`            |
| Lists                 | `lists.spec.ts`                |
| Colors                | `colors.spec.ts`               |
| Fonts                 | `fonts.spec.ts`                |
| Enter/Paragraphs      | `text-editing.spec.ts`         |
| Undo/Redo             | `scenario-driven.spec.ts`      |
| Line spacing          | `line-spacing.spec.ts`         |
| Paragraph styles      | `paragraph-styles.spec.ts`     |
| Toolbar state         | `toolbar-state.spec.ts`        |
| Cursor-only ops       | `cursor-paragraph-ops.spec.ts` |
| Comments sidebar      | `comments-sidebar.spec.ts`     |

Run `comments-sidebar.spec.ts` when touching any of these (all under `packages/react/src/`): `components/UnifiedSidebar.tsx`, `components/sidebar/**`, `hooks/useCommentSidebarItems.tsx`, `components/DocxEditor/hooks/useSelectionOverlay.ts` (`updateSelectionOverlay`/`onSelectionChange`), `components/DocxEditor.tsx` (`onSelectionChange` handler, `expandedSidebarItem` state).

Empty-doc specs (`formatting`, `text-editing`) use `editor.gotoEmpty()`. Demo-asserting specs use `editor.goto()`. Don't mix in one spec.

---

## Architecture — Dual Rendering

**Two renderers. Know which one owns your bug.**

- **HIDDEN ProseMirror** (`left: -9999px`) — editing state, undo/redo, keyboard. `components/DocxEditor/OffscreenEditorHost.tsx` (body) + `HiddenHeaderFooterPMs.tsx` (one EditorView per HF `rId`).
- **VISIBLE pages** — what user sees. Static DOM rebuilt from PM state. **NOT `toDOM`** — `src/painter-model/paintPage.ts`. Fixing `toDOM` for a visual bug → user sees nothing.

Data flow: DOCX → `unzip` → `parser` → `Document` → `toProseDoc` → PM → painter → pages. Save: PM → `fromProseDoc` → `Document` → `serializer` → `rezip`.

Click flow: `usePagesPointer.handlePagesMouseDown` → `getPositionFromMouse` (body) or `resolveDomPosition` scoped to `.layout-page-header`/`.layout-page-footer` (HF) → PM setSelection → `PagedEditor.handleTransaction` → painter re-render.

Header/footer editing follows the same model as the body: the persistent hidden HF PM is the sole editor; the painter is the sole visible renderer in both edit and non-edit modes. The `InlineHeaderFooterEditor` overlay is UI chrome only (separator bar, options menu, save-on-close) — it does NOT mount its own EditorView. There is no `.hf-editor-pm` CSS — those workarounds existed to make PM's `toDOM` tables match the painter's flex layout and are gone now that the painter is the sole renderer. See `openspec/changes/unify-hf-editing/` for the design.

Vue host: `useDocxEditor()` in `packages/vue/src/composables/useDocxEditor.ts`. Dual-rendering rule applies to Vue too — the composable mounts the same per-`rId` persistent HF EditorView pattern (via `syncHfPMs` / `getHfPmView` / `setHfTransactionListener`) and routes HF rendering through `convertHeaderFooterPmDocToContent` in lockstep with React.

### React/Vue parity

Changes to layout / measurement / paint behavior MUST land in both adapters in the same PR. The Vue composable mirrors the React `PagedEditor`; if you touch only one, the other regresses silently.

Before merging a change in `packages/react/`:

- Find the Vue counterpart in `packages/vue/src/composables/useDocxEditor.ts` (or under `packages/vue/src/`) and apply the same behavior change.
- If the change is platform-agnostic logic, lift it into `packages/core/` and have both adapters call it. The float-zone pipeline (`measureBlocksWithFloats` in `packages/core/src/flow-model/metrics/measureBlocksPipeline.ts`) is the canonical example.
- The reverse holds when starting from Vue.

Adapter-only changes are fine for things genuinely scoped to one framework (React-specific hook glue, Vue composition API ergonomics, the demo apps). When in doubt, mirror.

**UI styling / colors are single-source-of-truth.** All editor chrome CSS + color tokens live in `packages/core/src/styles/editor.css`; both adapters only `@import` it (the adapter `src/styles/editor.css` files must stay thin — enforced by `bun run check:adapter-css-thin`). Never hardcode hex/rgba in components — use the `--doc-*` tokens (or shadcn token utilities like `bg-primary`). The shared Tailwind theme lives in `packages/core/tailwind-preset.cjs`, extended by all three `tailwind.config.js`. Dark mode is a token override under `.ep-root.dark` (scaffold in the core stylesheet). The document canvas (painter output) is intentionally NOT themed — it stays Word-faithful.

### ContentNode invariant — 3 switches

Adding a `ContentNode` variant in `packages/core/src/pagination-model/types.ts` requires updating all three; each ends with `assertExhaustiveContentNode` so `bun run typecheck` names the missing site:

1. `runLayoutPipeline` in `packages/core/src/pagination-model/index.ts`
2. `measureBlock` in `packages/react/src/components/DocxEditor/internals/measureBlock.ts`
3. `measureBlock` in `packages/vue/src/composables/useDocxEditor.ts`

### Painter DOM contract

Stable dataset attrs on painted DOM (CSS, queries, selection map depend on these):

- `data-block-id` — block index
- `data-from-line`/`data-to-line` — measured line range
- `data-doc-from`/`data-doc-to` — PM positions for selection mapping (body AND HF — different PM docs, scope queries with `.layout-page-content` for body / `.layout-page-header|footer` for HF; see `collectBodySpans.ts` for the pattern)
- `data-comment-id` — comment-range spans
- `data-change-author`/`data-change-date`/`data-revision-id` — tracked changes
- `data-continues-from-prev`/`data-continues-on-next` — split paragraphs
- `data-flex-line` — flex-promoted lines (image-aligned, right-tab); `paintParagraphFragment` suppresses `text-indent` on these (would apply per-flex-item)
- `data-table-body-clip` — visible body window below repeated table headers; selection geometry intersects body runs with this box while keeping repeated headers selectable
- `data-vmerge-continuation` — synthetic slice of a vertically-merged cell re-painted on a continuation page (not selectable); `.layout-table-cut-border` — the horizontal rule that closes a table fragment at a page break. Tables split across pages via `TableFragment.fromRow/toRow` + `topClip`/`bottomClip` (mid-content row break).

### Key file map

| Debugging                    | File                                                            |
| ---------------------------- | --------------------------------------------------------------- |
| Text/paragraph rendering     | `painter-model/renderParagraph.ts`                              |
| Image rendering              | `painter-model/renderImage.ts`                                  |
| Table rendering              | `painter-model/renderTable.ts`                                  |
| Table borders / cut edges    | `painter-model/renderTableBorders.ts`                           |
| Table grid geometry (SoT)    | `flow-model/tableWidthUtils.ts` (`resolveCellGrid`)             |
| Table page-break geometry    | `pagination-model/tableRowBreak.ts`                             |
| Page composition             | `painter-model/paintPage.ts`                                    |
| Formatting commands          | `prosemirror/extensions/marks/`, `nodes/`                       |
| Keyboard shortcuts           | `prosemirror/extensions/features/BaseKeymapExtension.ts`        |
| Toolbar ↔ selection          | `prosemirror/plugins/selectionTracker.ts`                       |
| DOCX XML parsers             | `docx/paragraphParser.ts`, `docx/tableParser.ts`                |
| Document → PM                | `prosemirror/conversion/toProseDoc.ts`                          |
| Click → PM position          | `components/DocxEditor/hooks/usePagesPointer.ts`                |
| Selection rects / caret      | `components/DocxEditor/hooks/useSelectionOverlay.ts`            |
| HF persistent PMs            | `components/DocxEditor/HiddenHeaderFooterPMs.tsx`               |
| HF caret in painter          | `components/DocxEditor/DocxEditorPagedArea.tsx` (`hfCaretRect`) |
| HF inline chrome             | `components/InlineHeaderFooterEditor.tsx`                       |
| Layout pipeline              | `components/DocxEditor/hooks/useLayoutPipeline.ts`              |
| Scroll API                   | `components/DocxEditor/hooks/usePagedScrollApi.ts`              |
| Image resize/drag            | `components/DocxEditor/hooks/useImageInteractions.ts`           |
| Font/HF reflow triggers      | `components/DocxEditor/hooks/useLayoutTriggers.ts`              |
| Table resize                 | `components/DocxEditor/hooks/useTableResizeState.ts`            |
| Measure-block cache          | `components/DocxEditor/internals/measureBlock.ts`               |
| Sidebar comment Y positions  | `components/DocxEditor/internals/sidebarAnchorPositions.ts`     |
| PM position → DOM            | `components/DocxEditor/internals/pmAnchors.ts`                  |
| Main toolbar                 | `components/Toolbar.tsx`                                        |
| Document/PM CSS              | `prosemirror/editor.css`                                        |
| UI chrome CSS + color tokens | `packages/core/src/styles/editor.css` (SINGLE SOURCE OF TRUTH)  |

Shared React/Vue orchestration lives in core (issue #696, Tier 1) — adapters re-export or delegate, so grepping an adapter lands on a thin wrapper:

| Shared op                           | Core module (in `@eigenpal/docx-editor-core`) |
| ----------------------------------- | --------------------------------------------- |
| paraId/text helpers                 | `prosemirror/paraText.ts`                     |
| ref-API queries (find/selInfo/page) | `prosemirror/queries.ts`                      |
| agent applyFormatting/setParaStyle  | `prosemirror/applyFormatting.ts`              |
| comment/proposeChange + ID alloc    | `prosemirror/commentOps.ts`                   |
| table-resize read/commit + twips    | `prosemirror/tableResize.ts`                  |
| image resize/drag PM commits        | `prosemirror/imageCommit.ts`                  |
| cell-selection highlight            | `flow-model/cellSelectionHighlight.ts`        |
| drag auto-scroll delta math         | `utils/autoScroll.ts`                         |

### Extensions

`src/prosemirror/extensions/` — `nodes/`, `marks/`, `features/`. `StarterKit.ts` bundles all. `ExtensionManager.buildSchema()` (sync) → `initializeRuntime()` (post EditorState). Singleton in `schema/index.ts`.

### Pitfalls

- **Icons** — inline SVG in `components/ui/Icons.tsx`, NOT a font. `<MaterialSymbol name="x">` looks up `iconMap`; missing → renders raw text. Add SVG paths from fonts.google.com/icons.
- **Tailwind scope** — library scoped to `.ep-root`. Painter output isn't always protected → use inline styles on painted elements.
- **Focus stealing** — any mousedown that bubbles to PM moves caret. Dropdown/dialog mousedown needs `stopPropagation()`.
- **No `require()`** — ESM only.

OOXML reference: `reference/quick-ref/wordprocessingml.md`, `themes-colors.md`; schemas in `reference/ecma-376/part1/schemas/`. PDFs in `reference/ecma-376/` are gitignored — run `bun run reference:fetch` once when you need them.

Website docs (docx-editor.dev/docs/1.x) are authored here in `docs/site/content/` (MDX) and synced by the site repo at build time — see `docs/site/README.md` for the authoring contract. Feature-support claims live in `docs/site/data/word-features.ts` (typed matrix), never hand-written in prose. A feature PR that changes user-visible behavior should update both in the same PR.

**Nav gotcha — two meta.json files must agree.** The sidebar/overview is driven by the `"root": true` `docs/site/content/meta.json`, which lists pages with their full path (e.g. `guides/dark-mode`). Each subfolder also has its own `meta.json` (e.g. `guides/meta.json`). Adding a new page (especially a guide) means registering it in BOTH — a page present only in the nested meta is reachable by URL but missing from the sidebar/overview. When you add an MDX file under a subfolder, add its path to the root `meta.json` too.

---

## Security — untrusted DOCX/HTML input

**Treat every value from a DOCX, pasted HTML, or embedded part as attacker-controlled.** A `.docx` is a zip of XML an attacker fully controls — font names, hyperlink targets, shape attrs, image rels, run text. Sanitize at the **parse/trust boundary** (in `packages/core/src/docx/*Parser.ts` / PM `parseDOM`), not at render time, so every downstream consumer gets the clean value.

When you add/touch anything that **parses or renders unknown files** (parsers, `painter-model/*`, PM `toDOM`/`parseDOM`, clipboard, print), audit these sink classes before merging:

- **No HTML-from-strings.** Never build DOM from file-derived values via `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `document.write`. Build with `document.createElement(NS)` + `setAttribute` / `textContent`.
- **URLs go through `sanitizeHref`** (`packages/core/src/utils/sanitizeHref.ts`) — allowlists `http(s)/mailto/tel/ftp`, drops `javascript:`/`data:`/`vbscript:`/`file:`, strips embedded tab/LF/CR like WHATWG. Apply to every `href`, image `hlinkHref`, and `window.open(...)` arg.
- **Escape strings interpolated into CSS** — `@font-face` family names and any inline `style` built from file data. See `cssStringEscape` in `fontLoader.ts` (escapes `" \ < >` and CSS newlines `\n \r \f`). Build print/popup `<style>` via `textContent`, never `document.write`.
- **Residual CSS injection** — colors/transform/font-family still flow into inline `style` strings (set via `setAttribute`, so not XSS, but enables overlay/clickjacking and `url()` beacons). Validate/clamp where practical.

Malicious-file parsing also has non-injection classes — guard these when opening/saving unknown files:

- **XML safety** — the XML parser must not resolve DTDs/external entities (XXE → file/SSRF read) or expand nested entities (billion-laughs DoS).
- **Zip safety** — enforce a decompression-ratio/size cap (zip bomb) and reject part/rel/media paths containing `..` or a leading `/` before resolving them (path traversal).
- **No zero-click external fetch** — never auto-load a remote target from a file: external-mode image/font/link relationships (`TargetMode="External"`), remote `src`, CSS `url()`/`@import`. A network request on open is SSRF / IP-leak / tracking-beacon. Fetch only same-origin/embedded parts; gate remote loads behind explicit user action.
- **Resource limits** — cap recursion depth (nested tables/shapes/SDT/groups/textboxes) and element counts (rows/cells/runs/pages); never feed a file-supplied number straight into allocation, `.repeat()`, or a loop bound. Avoid catastrophic-backtracking (ReDoS) regex on file-derived strings.
- **XML injection on save** — escape every attacker-derived string written back into XML on serialize/round-trip (`escapeXml`); never template a raw value into output markup.
- **Prototype pollution** — guard `JSON.parse`-of-file-data merges and any XML-attribute-name → object-key assignment against `__proto__`/`constructor`/`prototype`.
- **Field codes / OLE / embedded objects** — never execute or auto-resolve Word field instructions (DDE, `INCLUDE*`, etc.) or embedded OLE/macro content; render inert.

Quick audit grep when reviewing file-handling diffs:

```bash
grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document\.write|window\.open\(|\.href\s*=|font-family:.*\$\{" packages --include="*.ts" --include="*.tsx" --include="*.vue" | grep -viE "test|\.spec\."
```

Run that grep on any PR that parses or renders file data before merging. When you touch one sink, **check sibling sinks** so the same class isn't left open elsewhere — e.g. the exported `openPrintWindow` util (`core/utils/print.ts`, `PrintPreview.tsx`/`.vue`) still builds its popup via `document.write` with an unescaped `title`/`content`. Treat it as a **known sink to harden**, not a safe reference.

---

## i18n

`packages/i18n/en.json` is source of truth. Other locales mirror its shape with `null` = falls back to English. Missing key = CI fails.

```ts
import { useTranslation } from '../i18n';
const { t } = useTranslation();
t('toolbar.bold');
t('dialogs.findReplace.matchCount', { current: 3, total: 15 });
```

Workflow:

- New string → add to `en.json`, use `t('key')`, run `bun run i18n:fix`.
- New language → `bun run i18n:new <code>`, fill nulls, `bun run i18n:status`.
- Validate: `bun run i18n:validate`.

Never hardcode user-facing English in components.

Vue composables: declare named `Use<Name>Return` interface and annotate return type. Without it, core's internal types leak into the API Extractor snapshot.

---

## Public API surface

API Extractor snapshots live in `docs/api/<pkg-slug>/<entry>.api.md`. CI runs `bun run api:check`.

CI fails on drift → `bun run api:extract` → commit.
Changing a `@public` symbol → tag in TSDoc, rebuild package, `bun run api:extract`, commit snapshot.

`bun run docs:json` generates downstream-consumer JSON. Output is gitignored; CI runs it as a smoke test.

### Parity contract

`scripts/parity/parity.contract.json` enumerates which `DocxEditorProps`/`DocxEditorRef` members are paired across React/Vue. CI runs `bun run check:parity-contract`.

Adding adapter prop/ref method:

1. Edit adapter, `bun run api:extract`.
2. Add to contract bucket: `paired`, `deferredInVue` (React-only), `pairedViaInheritance` (React explicit, Vue via `EditorRefLike`), or `vueExclusive`.
3. `bun run check:parity-contract`.

---

## Releasing (changesets)

Every code PR → `bun changeset` → commit `.changeset/*.md`. Skip only for test/docs/CI-only PRs.

- A hand-written `.changeset/*.md` is fine as long as it is correct — `bun changeset` is convenient but optional, don't make a human run a TTY prompt just to land a changeset. The frontmatter package name MUST exactly match one of the published packages below and the bump MUST be `patch`/`minor`/`major`; a wrong/typo'd name crashes the post-merge Release workflow. Copy the exact name from the Packages list (or an existing `.changeset/*.md`) rather than typing it independently.
- All published packages in fixed group — declare one bump, others follow.
- Default bump: `patch`. `minor` for additive public API. `major` for breaks.
- Summary lands verbatim in CHANGELOG; write for the consumer. Keep it concise (one or two lines), lead with the user-visible change (what changed, not how), and put `Fixes #N` at the end if relevant. No emojis or marketing.

Release: merge the bot's `chore: release` PR. Publish runs via OIDC, tags, GH release. ~3 min.

Branches: `main` = 1.x line. `0.x` = pre-rename maintenance, patch/minor only; it does NOT receive security fixes (see `SECURITY.md` — only 1.x is security-supported).

Packages: `@eigenpal/docx-editor-{react,core,agents,i18n,vue}`, `@eigenpal/nuxt-docx-editor`. All published.

### Don't

- Push `chore: release` commit by hand.
- Delete `.changeset/*.md` outside `changeset version`.
- Edit `CHANGELOG.md` or `package.json#version` by hand.

---

## PR style

Short factual title (conventional-commit prefix). Body is the minimum the diff doesn't show — often one sentence.

Don't: `@`-mention contributors, reference unrelated PR/issue numbers, list changed files, add tooling footers, use emojis.

---

## Bugs

Issue tracker: `gh issue view <N> --repo eigenpal/docx-editor`. Dev server: `bun run dev` → `http://localhost:5173/`. Commit format: `fix: ... (fixes #N)`.

Toolbar icons: Material Symbol SVGs, saved locally. Screenshots → `screenshots/`.
