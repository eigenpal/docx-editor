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

- **HIDDEN ProseMirror** (`left: -9999px`) — editing state, undo/redo, keyboard. `components/DocxEditor/OffscreenEditorHost.tsx`.
- **VISIBLE pages** — what user sees. Static DOM rebuilt from PM state. **NOT `toDOM`** — `src/layout-painter/paintPage.ts`. Fixing `toDOM` for a visual bug → user sees nothing.

Data flow: DOCX → `unzip` → `parser` → `Document` → `toProseDoc` → PM → painter → pages. Save: PM → `fromProseDoc` → `Document` → `serializer` → `rezip`.

Click flow: `usePagesPointer.handlePagesMouseDown` → `getPositionFromMouse` → PM setSelection → `PagedEditor.handleTransaction` → painter re-render.

Vue host: `useDocxEditor()` in `packages/vue/src/composables/useDocxEditor.ts`. Dual-rendering rule applies to Vue too.

### FlowBlock invariant — 3 switches

Adding a `FlowBlock` variant in `packages/core/src/layout-engine/types.ts` requires updating all three; each ends with `assertExhaustiveFlowBlock` so `bun run typecheck` names the missing site:

1. `runLayoutPipeline` in `packages/core/src/layout-engine/index.ts`
2. `measureBlock` in `packages/react/src/components/DocxEditor/internals/measureBlock.ts`
3. `measureBlock` in `packages/vue/src/composables/useDocxEditor.ts`

### Painter DOM contract

Stable dataset attrs on painted DOM (CSS, queries, selection map depend on these):

- `data-block-id` — block index
- `data-from-line`/`data-to-line` — measured line range
- `data-doc-from`/`data-doc-to` — PM positions for selection mapping
- `data-comment-id` — comment-range spans
- `data-change-author`/`data-change-date`/`data-revision-id` — tracked changes
- `data-continues-from-prev`/`data-continues-on-next` — split paragraphs
- `data-flex-line` — flex-promoted lines (image-aligned, right-tab); `paintParagraphFragment` suppresses `text-indent` on these (would apply per-flex-item)

### Key file map

| Debugging                   | File                                                        |
| --------------------------- | ----------------------------------------------------------- |
| Text/paragraph rendering    | `layout-painter/renderParagraph.ts`                         |
| Image rendering             | `layout-painter/renderImage.ts`                             |
| Table rendering             | `layout-painter/renderTable.ts`                             |
| Page composition            | `layout-painter/paintPage.ts`                              |
| Formatting commands         | `prosemirror/extensions/marks/`, `nodes/`                   |
| Keyboard shortcuts          | `prosemirror/extensions/features/BaseKeymapExtension.ts`    |
| Toolbar ↔ selection         | `prosemirror/plugins/selectionTracker.ts`                   |
| DOCX XML parsers            | `docx/paragraphParser.ts`, `docx/tableParser.ts`            |
| Document → PM               | `prosemirror/conversion/toProseDoc.ts`                      |
| Click → PM position         | `components/DocxEditor/hooks/usePagesPointer.ts`            |
| Selection rects / caret     | `components/DocxEditor/hooks/useSelectionOverlay.ts`        |
| Layout pipeline             | `components/DocxEditor/hooks/useLayoutPipeline.ts`          |
| Scroll API                  | `components/DocxEditor/hooks/usePagedScrollApi.ts`          |
| Image resize/drag           | `components/DocxEditor/hooks/useImageInteractions.ts`       |
| Font/HF reflow triggers     | `components/DocxEditor/hooks/useLayoutTriggers.ts`          |
| Table resize                | `components/DocxEditor/hooks/useTableResizeState.ts`        |
| Measure-block cache         | `components/DocxEditor/internals/measureBlock.ts`           |
| Sidebar comment Y positions | `components/DocxEditor/internals/sidebarAnchorPositions.ts` |
| PM position → DOM           | `components/DocxEditor/internals/pmAnchors.ts`              |
| Main toolbar                | `components/Toolbar.tsx`                                    |
| Editor CSS                  | `prosemirror/editor.css`                                    |

### Extensions

`src/prosemirror/extensions/` — `nodes/`, `marks/`, `features/`. `StarterKit.ts` bundles all. `ExtensionManager.buildSchema()` (sync) → `initializeRuntime()` (post EditorState). Singleton in `schema/index.ts`.

### Pitfalls

- **Icons** — inline SVG in `components/ui/Icons.tsx`, NOT a font. `<MaterialSymbol name="x">` looks up `iconMap`; missing → renders raw text. Add SVG paths from fonts.google.com/icons.
- **Tailwind scope** — library scoped to `.ep-root`. Painter output isn't always protected → use inline styles on painted elements.
- **Focus stealing** — any mousedown that bubbles to PM moves caret. Dropdown/dialog mousedown needs `stopPropagation()`.
- **No `require()`** — ESM only.

OOXML reference: `reference/quick-ref/wordprocessingml.md`, `themes-colors.md`; schemas in `reference/ecma-376/part1/schemas/`. PDFs in `reference/ecma-376/` are gitignored — run `bun run reference:fetch` once when you need them.

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

- Use full npm name in frontmatter (`@eigenpal/docx-editor-react`). Always run `bun changeset`, don't hand-write. Wrong name crashes post-merge Release workflow.
- All published packages in fixed group — declare one bump, others follow.
- Default bump: `patch`. `minor` for additive public API. `major` for breaks.
- Summary lands verbatim in CHANGELOG; write for consumer.

Release: merge the bot's `chore: release` PR. Publish runs via OIDC, tags, GH release. ~3 min.

Branches: `main` = 1.x line. `0.x` = pre-rename maintenance, patch/minor only.

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
