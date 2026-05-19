# Eigenpal DOCX Editor

## Project Context

Bun + React (TSX) WYSIWYG editor for DOCX files:

1. **Display DOCX** — render with full WYSIWYG fidelity per ECMA-376 spec
2. **Insert docxtemplater variables** — `{variable}` mappings with live preview

Two entry points: `src/index.ts` (full UI), `src/headless.ts` (Node.js API).
Client-side only. No backend.

---

## Verify Commands

```bash
# Fast cycle (use this 95% of the time)
bun run typecheck && npx playwright test --grep "<pattern>" --timeout=30000 --workers=4

# Single test file
bun run typecheck && npx playwright test tests/formatting.spec.ts --timeout=30000

# Only affected test files (use this after targeted changes)
bun run typecheck && npx playwright test tests/formatting.spec.ts tests/demo-docx.spec.ts --timeout=30000 --workers=4

# Full suite (only for final validation — NEVER run casually, 500+ tests)
bun run typecheck && npx playwright test --timeout=60000 --workers=4
```

### Test File Mapping

| Feature Area          | Test File                      | Quick Verify Pattern        |
| --------------------- | ------------------------------ | --------------------------- |
| Bold/Italic/Underline | `formatting.spec.ts`           | `--grep "apply bold"`       |
| Alignment             | `alignment.spec.ts`            | `--grep "align text"`       |
| Lists                 | `lists.spec.ts`                | `--grep "bullet list"`      |
| Colors                | `colors.spec.ts`               | `--grep "text color"`       |
| Fonts                 | `fonts.spec.ts`                | `--grep "font family"`      |
| Enter/Paragraphs      | `text-editing.spec.ts`         | `--grep "Enter"`            |
| Undo/Redo             | `scenario-driven.spec.ts`      | `--grep "undo"`             |
| Line spacing          | `line-spacing.spec.ts`         | `--grep "line spacing"`     |
| Paragraph styles      | `paragraph-styles.spec.ts`     | `--grep "Heading"`          |
| Toolbar state         | `toolbar-state.spec.ts`        | `--grep "toolbar"`          |
| Cursor-only ops       | `cursor-paragraph-ops.spec.ts` | `--grep "cursor only"`      |
| Comments sidebar      | `comments-sidebar.spec.ts`     | `--grep "Comments sidebar"` |

**When touching anything in these paths, run `comments-sidebar.spec.ts`:**

- `packages/react/src/components/UnifiedSidebar.tsx`
- `packages/react/src/components/sidebar/**`
- `packages/react/src/hooks/useCommentSidebarItems.tsx`
- `packages/react/src/components/DocxEditor/hooks/useSelectionOverlay.ts` → `updateSelectionOverlay` / `onSelectionChange`
- `packages/react/src/components/DocxEditor.tsx` → `onSelectionChange` handler, `expandedSidebarItem` state

**Known flaky tests:** `formatting.spec.ts` (bold toggle/undo/redo), `text-editing.spec.ts` (clipboard ops).

### Avoid Hanging

- **Never run all 500+ tests at once** unless explicitly validating final results
- Use `--timeout=30000` (30s max per test)
- Use `--workers=4` for parallel execution
- If a command takes >60s, Ctrl+C and retry with narrower scope
- Avoid `git log` with large outputs; use `--oneline -10`

---

## Subagents — Use For Complex Tasks

Spin up subagents for parallel work using the Task tool:

- **Explore agent** — codebase exploration, finding files, understanding architecture
- **Plan agent** — designing implementation approaches
- **Bash agent** — running commands, git operations

Use when: searching across multiple files, investigating cross-cutting features, running parallel tests, complex research.

---

## ECMA-376 Reference

```bash
reference/quick-ref/wordprocessingml.md   # Paragraphs, runs, formatting
reference/quick-ref/themes-colors.md      # Theme colors, fonts, tints
reference/ecma-376/part1/schemas/wml.xsd  # WordprocessingML schema
reference/ecma-376/part1/schemas/dml-main.xsd # DrawingML schema
```

---

## WYSIWYG Fidelity — Hard Rule

Output must look identical to Microsoft Word. Must preserve: fonts, theme colors, styles, character formatting, tables (borders, shading, merged cells), headers/footers, section layout (margins, page size, orientation).

---

## Editor Architecture — Dual Rendering System

**This editor has TWO separate rendering systems. You MUST understand which one you're working with.**

```
┌──────────────────────────────────────────────────────────────┐
│  HIDDEN ProseMirror (left: -9999px)                          │
│  - Real editing state (selection, undo/redo, commands)       │
│  - Receives keyboard input                                   │
│  - CSS class: .paged-editor__hidden-pm                       │
│  - Component: components/DocxEditor/OffscreenEditorHost.tsx    │
└──────────────────────────────────────────────────────────────┘
        │ state changes trigger re-render ↓
┌──────────────────────────────────────────────────────────────┐
│  VISIBLE Pages (layout-painter)                              │
│  - What the user actually sees                               │
│  - Static DOM, re-built from PM state on every change        │
│  - Has its own rendering logic (NOT toDOM)                   │
│  - CSS class: .paged-editor__pages                           │
│  - Entry: src/layout-painter/paintPage.ts                   │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

```
DOCX file
  → unzip.ts → parser.ts → Document model (types/)
  → toProseDoc.ts → ProseMirror document
  → OffscreenEditorHost renders off-screen
  → PagedEditor.tsx reads PM state → layout-painter renders visible pages
  → User edits → PM state updates → layout-painter re-renders

Saving:
  PM state → fromProseDoc.ts → Document model → serializer/ → XML → rezip.ts → DOCX
```

### Click/Selection Flow

User clicks on visible page → `usePagesPointer.handlePagesMouseDown()` (in `components/DocxEditor/hooks/usePagesPointer.ts`) → `getPositionFromMouse(clientX, clientY)` maps pixel coordinates to a PM document position → `hiddenPMRef.current.setSelection(pos)` → PM transaction routes through `PagedEditor.handleTransaction` → `useLayoutPipeline.scheduleLayout` if doc changed + `useSelectionOverlay.updateSelectionOverlay` otherwise → visible pages re-render with selection overlay.

### Vue mounting path

- Vue host mounts via `useDocxEditor()` (`packages/vue/src/composables/useDocxEditor.ts`); `EditorView` and `Document` are held in `shallowRef`. Reactivity contract for the rest of the surface lives in `openspec/changes/vue-editor-robust-implementation/notes/reactivity.md`.
- The dual-rendering rule above (visible pages from `layout-painter/`, NOT `toDOM`) applies to both adapters — a fix in `toDOM` won't show up on screen in React or Vue.

### FlowBlock invariant

Adding a new variant to `FlowBlock` (`packages/core/src/layout-engine/types.ts`) requires updating **three** switches:

1. `runLayoutPipeline` in `packages/core/src/layout-engine/index.ts`
2. `measureBlock` in `packages/react/src/components/DocxEditor/internals/measureBlock.ts`
3. `measureBlock` in `packages/vue/src/composables/useDocxEditor.ts`

All three end with `assertExhaustiveFlowBlock(block, '<site>')`, so omitting any case fails `bun run typecheck` with a `never` mismatch that names the missing site. This was the root cause of the Vue-only text-box crash before the guard landed.

### Debugging Checklist

1. **Visual rendering bug or editing/data bug?**
   - Visual only → fix in `layout-painter/`
   - Editing behavior → fix in `prosemirror/extensions/`
   - Both → likely need changes in both systems

2. **Which renderer owns the output?**
   - Visible pages are rendered by `layout-painter/`, NOT by ProseMirror's `toDOM`
   - If you fix `toDOM` for a visual bug, **the user won't see the change**

3. **Where does the data come from?**
   - DOCX XML → `src/docx/` parsers → `Document` model in `src/types/`
   - `toProseDoc.ts` converts Document → PM nodes
   - `fromProseDoc.ts` converts PM → Document (round-trip for saving)

### Key File Map

| What you're debugging                | Look here                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------- |
| How text/paragraphs appear on screen | `layout-painter/renderParagraph.ts`                                       |
| How images appear on screen          | `layout-painter/renderImage.ts`                                           |
| How tables appear on screen          | `layout-painter/renderTable.ts`                                           |
| How pages are composed               | `layout-painter/paintPage.ts`                                            |
| How a formatting command works       | `prosemirror/extensions/` (marks/ and nodes/)                             |
| How keyboard shortcuts work          | `prosemirror/extensions/features/BaseKeymapExtension.ts`                  |
| How toolbar reflects selection       | `prosemirror/plugins/selectionTracker.ts`                                 |
| How DOCX XML is parsed               | `docx/paragraphParser.ts`, `docx/tableParser.ts`, etc.                    |
| How PM doc is built from parsed data | `prosemirror/conversion/toProseDoc.ts`                                    |
| Schema (node/mark definitions)       | `prosemirror/extensions/nodes/`, `marks/`                                 |
| Table toolbar/dropdown               | `components/ui/TableOptionsDropdown.tsx`                                  |
| Main toolbar                         | `components/Toolbar.tsx`                                                  |
| CSS for editor                       | `prosemirror/editor.css`                                                  |
| Click → PM position mapping          | `components/DocxEditor/hooks/usePagesPointer.ts` (`getPositionFromMouse`) |
| Selection rects / caret geometry     | `components/DocxEditor/hooks/useSelectionOverlay.ts`                      |
| Layout pipeline + painter wiring     | `components/DocxEditor/hooks/useLayoutPipeline.ts`                        |
| Scroll to position / paraId / page   | `components/DocxEditor/hooks/usePagedScrollApi.ts`                        |
| Image resize + drag                  | `components/DocxEditor/hooks/useImageInteractions.ts`                     |
| Font-load / HF-change reflow         | `components/DocxEditor/hooks/useLayoutTriggers.ts`                        |
| Table column/row/edge resize         | `components/DocxEditor/hooks/useTableResizeState.ts`                      |
| `PagedEditorRef` shape               | `components/DocxEditor/hooks/usePagedEditorRefApi.ts`                     |
| Measure-block invariant + caches     | `components/DocxEditor/internals/measureBlock.ts`                         |
| Scroll-restore strategies            | `components/DocxEditor/internals/scrollRestore.ts`                        |
| Sidebar comment anchor Y positions   | `components/DocxEditor/internals/sidebarAnchorPositions.ts`               |
| PM doc → vanilla-view text           | `components/DocxEditor/internals/vanillaText.ts`                          |
| PM position → DOM element            | `components/DocxEditor/internals/pmAnchors.ts`                            |

### Extension System

Extensions live in `src/prosemirror/extensions/`:

- `nodes/` — ParagraphExtension, TableExtension, ImageExtension, etc.
- `marks/` — BoldExtension, ColorExtension, FontExtension, etc.
- `features/` — BaseKeymapExtension, ListExtension, HistoryExtension, etc.
- `StarterKit.ts` bundles all extensions; `ExtensionManager` builds schema + runtime
- Two-phase init: `ExtensionManager.buildSchema()` (sync) → `initializeRuntime()` (after EditorState)

### Common Pitfalls

- **Toolbar icons must be SVG imports**: Icons use inline SVGs in `components/ui/Icons.tsx`, NOT a font. `<MaterialSymbol name="foo">` looks up the icon in `iconMap`. If you use a name that's not in the map, it renders as raw text. **Always add new icons as SVG path components** (source: https://fonts.google.com/icons) and register them in `iconMap`.
- **Tailwind CSS conflicts**: Library CSS is scoped via `.ep-root` but layout-painter output isn't always protected. Use explicit inline styles on painted elements.
- **ProseMirror focus stealing**: Any mousedown that propagates to the PM view will move the cursor. Dropdown/dialog elements need `onMouseDown` with `stopPropagation()`.
- **Never use `require()`** in extension files — Vite/ESM only.

---

## Browser Testing — Prefer Claude in Chrome

For visual testing of UI changes:

- **Prefer Claude in Chrome** (`mcp__claude-in-chrome__*` tools) — connects to user's actual Chrome, faster, supports file uploads natively
- Use `tabs_context_mcp` first, then navigate to `http://localhost:5173/`
- Take screenshots with `computer` action `screenshot`

**Playwright MCP** is better for: automated E2E test runs, file upload via `browser_file_upload`, headless/CI scenarios.

---

## When Stuck

1. **Type error?** Read the actual types, don't guess
2. **Test failing?** Run with `--debug` and check console output
3. **Selection bug?** Add `console.log` in `getSelectionRange()` to trace
4. **OOXML spec question?** Check `reference/quick-ref/` or ECMA-376 schemas
5. **Timeout?** Kill command, narrow test scope, retry
6. **Complex task?** Spin up a subagent with Task tool

---

## Issue-Driven Bug Fix Workflow

Issue tracker: **https://github.com/eigenpal/docx-editor/issues**

```bash
gh issue view <N> --repo eigenpal/docx-editor
```

1. **Read** the issue — get description, repro steps, attached files
2. **Reproduce** locally — `bun run dev` + browser at `localhost:5173`
3. **Investigate** root cause — use Debugging Checklist + Key File Map above
4. **Fix** — minimal change, fix the right renderer (layout-painter vs PM)
5. **Test** — add/update Playwright E2E tests (see Test File Mapping)
6. **Verify** — `bun run typecheck` + targeted Playwright tests + visual check
7. **Commit** — reference issue number: `fix: ... (fixes #N)`
8. **PR** — `gh pr create` referencing issue, include screenshots for visual bugs

---

## Pre-PR Self-Review

Before opening any PR, self-review the diff against **DRY, KISS, YAGNI**:

1. **DRY** — Is the same logic/style repeated across files? Extract shared code.
2. **KISS** — Is the solution more complex than needed? Simpler alternatives?
3. **YAGNI** — Did you add anything not required by the task? Remove it.
4. **Formatting** — Run `bun run format` to ensure Prettier compliance before pushing.

---

## Public API Surface (API Extractor)

We track every published package's `@public` surface in `packages/<pkg>/etc/<entry>.api.md` snapshots. CI runs `bun run api:check` and fails on any drift you haven't checked in.

**Adding or changing a `@public` symbol:**

1. Tag the source declaration with `@public` (or `@internal` / `@beta`) in TSDoc.
2. Rebuild the package: `bun run --filter '@eigenpal/docx-editor-<pkg>' build`
3. Regenerate the snapshot: `bun run api:extract`
4. Commit the updated `etc/<entry>.api.md` alongside your code change.

**When CI fails on API drift:** `bun run api:extract` locally, commit the new snapshot, push.

**Status:**

- `@eigenpal/docx-editor-agents/server` — snapshot at `packages/agents/etc/agents-server.api.md`.
- `@eigenpal/docx-editor-core` — snapshots for every published subpath at `packages/core/etc/*.api.md`. The runner at `packages/core/scripts/api-extractor.mjs` iterates the exports map automatically; adding a new core subpath extends the snapshot set without config changes.
- `@eigenpal/docx-editor-react` and `@eigenpal/docx-editor-vue` — pending Phase 2/3 of #475.

---

## PR Title and Description Style

Keep PRs **small and quiet**. Notifications are expensive.

**Title:** one short factual line (e.g. `chore: update cla list`, `fix(parser): handle empty paragraph runs`). No marketing copy. No "comprehensive" or "robust." Conventional-commit prefix when it fits.

**Body:** the minimum a reviewer needs that they can't get from the diff. One sentence is often enough. If the diff is self-explanatory, the body can just be a one-liner.

**Don't:**

- **`@-mention` contributors by handle.** Pings them. If their identity matters for context, write the name in plain text without the `@`, or omit it entirely.
- **Reference unrelated PR/issue numbers** (`#429`, `#430`) in titles or bodies unless directly necessary. Each `#N` reference adds the PR to that thread's notifications and pings its participants.
- Include file tables, manifest-style lists of changed files, or test-plan checkboxes — the diff and CI already show these.
- Add "Generated with Claude Code" or other tooling footers unless the user asks.
- Use emojis unless the user asks.

When in doubt, ship the shorter version.

---

## i18n (Internationalization)

All user-facing strings are translatable via a lightweight i18n system (no external dependencies).

### Key Files

| What                 | Where                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Locale source JSONs  | `packages/i18n/*.json` — `en.json` is the source of truth; community locales mirror its shape. Not exported as subpaths.        |
| Public surface       | `packages/i18n/src/index.ts` — typed locale values (`en`, `de`, `pl`, `ptBR`, `tr`, `he`, `zhCN`, `locales`) + types            |
| Types (auto-derived) | `LocaleStrings`, `Translations`, `TranslationKey`, `LocaleCode` — consumers import everything from `@eigenpal/docx-editor-i18n` |
| Context + hook       | `packages/react/src/i18n/LocaleContext.tsx`                                                                                     |
| Barrel export        | `packages/react/src/i18n/index.ts`                                                                                              |

### How It Works

- The published surface lives at the root of `@eigenpal/docx-editor-i18n`: named locale values (`en`, `de`, `pl`, `ptBR`, `tr`, `he`, `zhCN`, `locales`), the runtime helpers (`deepMerge`, `createT`), and the types (`LocaleStrings`, `Translations`, `TranslationKey`, `LocaleCode`, `TFunction`).
- `LocaleStrings` is auto-derived from `en.json` via `typeof import` — no manual interface.
- `TranslationKey` is a union of all valid dot-paths (e.g., `"toolbar.bold" | "dialogs.findReplace.title" | ...`).
- `<DocxEditor i18n={de} />` deep-merges with English defaults (null keys fall back to English).
- `useTranslation()` hook returns `t(key, vars?)` for string lookup with `{variable}` interpolation. React + Vue both build it on top of `createT()` from the i18n package — one ICU formatter + merge implementation, both adapters consume it.

### Using t() in Components

```typescript
import { useTranslation } from '../i18n'; // adjust path

function MyComponent() {
  const { t } = useTranslation();
  return <button title={t('toolbar.bold')}>{t('common.apply')}</button>;
}

// With interpolation:
t('dialogs.findReplace.matchCount', { current: 3, total: 15 })
// → "3 of 15 matches"
```

### Adding a New String

1. Add the key + English value to `i18n/en.json` (nest by feature area)
2. Use `t('your.new.key')` in the component — types update automatically
3. Run `bun run i18n:fix` to sync community locale files (adds new keys as `null`)

### Adding a New Language

1. Run `bun run i18n:new <lang>` (e.g. `bun run i18n:new ja` or `bun run i18n:new pt-PT`).
   This scaffolds `packages/i18n/<lang>.json` and rewrites the typed exports in
   `packages/i18n/src/index.ts` — `LocaleCode` gets `'<lang>'`, a typed
   `export const <id>: PartialLocaleStrings` lands, and the `locales` record
   picks it up. Zero manual edits to the i18n source.
2. Replace nulls with translations in the new JSON.
3. Run `bun run i18n:status` to see coverage.

`bun run i18n:codegen` regenerates the index from the on-disk JSONs if you ever
add or remove a locale file by hand; `bun run i18n:validate` errors when the
two drift.

### Locale Key States

| Value       | Meaning            | Behavior                              |
| ----------- | ------------------ | ------------------------------------- |
| `"Fett"`    | Translated         | Displayed to user                     |
| `null`      | Not yet translated | Falls back to English                 |
| _(missing)_ | Out of sync        | **CI fails** — run `bun run i18n:fix` |

### i18n CLI

```bash
bun run i18n:new <lang>   # scaffold new locale + auto-wire it into the typed exports
bun run i18n:codegen       # regenerate the typed exports from on-disk locale JSONs
bun run i18n:status        # show translation coverage for all locales
bun run i18n:validate      # check locale JSONs + typed exports are in sync
bun run i18n:fix           # auto-add missing keys as null, regenerate typed exports
```

### When adding UI strings

**Always** use `t()` for user-facing text. Never hardcode English strings in components. After adding new keys to `en.json`, run `bun run i18n:fix` to sync all community locale files.

Full contribution guide: `docs/i18n.md`

---

## Releasing

Releases follow the canonical [`changesets/action@v1`](https://github.com/changesets/action) flow: every code-touching PR drops a `.changeset/*.md` describing its change; pushes to `main` open or update a `chore: release` PR aggregating those entries; merging that PR publishes to npm.

### Branch model

After the 1.0 cut, two release lines exist:

- **`main`** — 1.x line. New work targets here. See the Packages table below.
- **`0.x`** — maintenance line for the pre-rename packages. Patch and minor only — **never major**. `@eigenpal/docx-editor-agents` is in `ignore` on `0.x`; the 1.x line owns that name.

Both branches publish to npm's `latest` for their own package names — no dist-tag collision because the package names diverged at the rename. The release workflow listens on both branches; each maintains its own `.changeset/*.md` queue.

Hotfixes → `0.x`. Everything else → `main`.

### Packages

| Package                        | Path              | Published?               |
| ------------------------------ | ----------------- | ------------------------ |
| `@eigenpal/docx-editor-react`  | `packages/react`  | ✅                       |
| `@eigenpal/docx-editor-core`   | `packages/core`   | ✅                       |
| `@eigenpal/docx-editor-agents` | `packages/agents` | ✅                       |
| `@eigenpal/docx-editor-i18n`   | `packages/i18n`   | ✅ (shared locale JSONs) |
| `@eigenpal/docx-editor-vue`    | `packages/vue`    | ✅                       |

`@eigenpal/docx-editor-react`, `@eigenpal/docx-editor-core`, `@eigenpal/docx-editor-agents`, `@eigenpal/docx-editor-i18n`, and the Vue adapter are all in a **fixed group** in `.changeset/config.json` — they always ship the same version. A changeset only needs to declare the bump for one; the others follow automatically. `@eigenpal/docx-editor-i18n` ships the locale JSONs that React and Vue both consume — adding a new key to `en.json` only needs a changeset on `@eigenpal/docx-editor-i18n` (the consumers pick it up at build time).

The old `@eigenpal/docx-js-editor` name does **not** publish a 1.x shim. New work must reference `@eigenpal/docx-editor-react`.

### Author flow (every contributor, every code PR)

```bash
bun changeset       # interactive — pick bump + write a one-line summary
git add .changeset/*.md
# ... commit with the rest of your PR
```

Skip only for **test-only / docs-only / CI-only** PRs (no published-package code changed). When in doubt, add one — an extra patch entry is harmless; a missing entry ships invisibly.

#### Package name in the changeset frontmatter (READ THIS — agents get it wrong)

The frontmatter must use the **full npm package name**, not the repo name or a guess:

```markdown
---
'@eigenpal/docx-editor-react': patch
---
```

Only `@eigenpal/docx-editor-react` needs to be listed — the fixed group in `.changeset/config.json` auto-bumps `@eigenpal/docx-editor-agents` to match. Always run `bun changeset` rather than hand-writing the file; the interactive prompt picks valid names from the workspace. A wrong name (e.g. bare `docx-editor`) does not fail the PR's CI but **crashes the post-merge Release workflow** with `Found changeset X for package Y which is not in the workspace`, blocking all releases until someone edits the bad changeset.

#### Bump levels (semver)

- **patch** — bug fix, internal refactor, no public API change. **Default — use this unless you have a clear reason not to.**
- **minor** — new public API (additive, backward compatible)
- **major** — breaking change to existing public API

`changeset version` resolves to the **highest bump** across all pending changesets, so a single `minor` from another PR will correctly bump everything. You don't need to coordinate.

The summary you write (`Add foo prop to DocxEditor`) goes verbatim into `CHANGELOG.md`, so write it for the _consumer_ of the package — not for the team. Avoid PR/issue numbers in the body; the changelog tooling can backlink them automatically when needed.

### Release flow (the maintainer, when ready to ship)

1. **Look for an open PR titled `chore: release`** on `main`. The bot opens it automatically the first time a changeset lands; subsequent changeset-bearing PRs update the same PR with the latest bumps and CHANGELOG entries.
2. **Review the PR.** It shows: version bumps in `package.json`s, new CHANGELOG sections, and the `.md` files being drained from `.changeset/`. Treat it like any other PR — CI runs on it.
3. **Merge it.** Standard merge. No bypass, no manual workflow trigger needed.
4. **Wait ~3 minutes.** The post-merge workflow run sees an empty changeset queue, runs `changeset publish` against npm via OIDC Trusted Publishing (no `NPM_TOKEN`), creates per-package git tags (`@eigenpal/docx-editor-react@X.Y.Z`), and creates a GitHub Release with the new CHANGELOG section.

That's the entire release. One PR merge.

#### Common situations

| Situation                                | What to do                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Hotfix, ship now                         | Land the fix PR with a `patch` changeset → release PR auto-updates → merge it.                          |
| Several PRs, ship together               | All landed PRs aggregated into one release PR. Merge once, one coordinated release.                     |
| Forgot a changeset on a merged PR        | Open a tiny follow-up PR with just `.changeset/foo.md`, _or_ edit the release PR's frontmatter inline.  |
| Not ready to release yet                 | Don't merge the release PR. It keeps updating as new PRs land.                                          |
| Publish step crashed after PR merged     | Re-run the workflow manually (`workflow_dispatch` is kept for this). `changeset publish` is idempotent. |
| Need to force a major bump for marketing | Edit a pending changeset's frontmatter from `minor` → `major` before merging.                           |
| No pending changesets                    | No release PR opens. Nothing to ship.                                                                   |

### First-time setup (already configured, documented for future reference)

| Where                    | What                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| npmjs.com                | Trusted Publisher configured for both packages → repo `eigenpal/docx-editor`, workflow `release.yml`                                        |
| `package.json`           | `"publishConfig": { "access": "public" }` on each published package (already set)                                                           |
| `.changeset/config.json` | `"access": "public"`; `fixed: [["@eigenpal/docx-editor-react", "@eigenpal/docx-editor-agents"]]` (already set)                              |
| GitHub perms             | Settings → Actions → General → Workflow permissions = **Read and write**, **Allow GitHub Actions to create and approve pull requests** = on |
| GitHub secrets           | `SLACK_WEBHOOK_URL` (optional — release notifications)                                                                                      |

### Manual / local releases (don't, but if you must)

```bash
bun run version-packages   # consume .changeset/*.md → bump versions + write CHANGELOGs
bun run release            # build + changeset publish (needs NPM_TOKEN locally)
```

The published-from-CI flow is preferred because it uses OIDC (no long-lived npm token needed) and produces npm provenance.

### Anti-patterns to avoid

- **Don't push directly to `main` with a `chore: release` commit by hand.** That bypasses the release PR, skips CI, and confuses the changesets/action state machine on the next push.
- **Don't manually delete `.changeset/*.md` files** outside of `changeset version`. They're the single source of truth for what's pending.
- **Don't edit `CHANGELOG.md` by hand.** It's auto-generated from changesets; manual edits get clobbered on the next release.
- **Don't edit the `version` field in `package.json` by hand.** `changeset version` owns it.
- **Don't hand-write the package name in changeset frontmatter.** Use `bun changeset` so the package list comes from the workspace. A bare `docx-editor` (or any name not in `package.json`) crashes the Release workflow post-merge.

---

## Rules

- Client-side only. No backend.
- Toolbar icons are Material Symbol fonts (same as Google Docs), saved locally as SVGs.
- Save screenshots to `screenshots/` folder
