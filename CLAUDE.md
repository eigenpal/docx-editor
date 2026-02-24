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

# Full suite (only for final validation)
bun run typecheck && npx playwright test --timeout=60000 --workers=4
```

### Test File Mapping

| Feature Area          | Test File                      | Quick Verify Pattern    |
| --------------------- | ------------------------------ | ----------------------- |
| Bold/Italic/Underline | `formatting.spec.ts`           | `--grep "apply bold"`   |
| Alignment             | `alignment.spec.ts`            | `--grep "align text"`   |
| Lists                 | `lists.spec.ts`                | `--grep "bullet list"`  |
| Colors                | `colors.spec.ts`               | `--grep "text color"`   |
| Fonts                 | `fonts.spec.ts`                | `--grep "font family"`  |
| Enter/Paragraphs      | `text-editing.spec.ts`         | `--grep "Enter"`        |
| Undo/Redo             | `scenario-driven.spec.ts`      | `--grep "undo"`         |
| Line spacing          | `line-spacing.spec.ts`         | `--grep "line spacing"` |
| Paragraph styles      | `paragraph-styles.spec.ts`     | `--grep "Heading"`      |
| Toolbar state         | `toolbar-state.spec.ts`        | `--grep "toolbar"`      |
| Cursor-only ops       | `cursor-paragraph-ops.spec.ts` | `--grep "cursor only"`  |

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
│  - Component: src/paged-editor/HiddenProseMirror.tsx         │
└──────────────────────────────────────────────────────────────┘
        │ state changes trigger re-render ↓
┌──────────────────────────────────────────────────────────────┐
│  VISIBLE Pages (layout-painter)                              │
│  - What the user actually sees                               │
│  - Static DOM, re-built from PM state on every change        │
│  - Has its own rendering logic (NOT toDOM)                   │
│  - CSS class: .paged-editor__pages                           │
│  - Entry: src/layout-painter/renderPage.ts                   │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

```
DOCX file
  → unzip.ts → parser.ts → Document model (types/)
  → toProseDoc.ts → ProseMirror document
  → HiddenProseMirror renders off-screen
  → PagedEditor.tsx reads PM state → layout-painter renders visible pages
  → User edits → PM state updates → layout-painter re-renders

Saving:
  PM state → fromProseDoc.ts → Document model → serializer/ → XML → rezip.ts → DOCX
```

### Click/Selection Flow

User clicks on visible page → `PagedEditor.handlePagesMouseDown()` → `getPositionFromMouse(clientX, clientY)` maps pixel coordinates to a PM document position → `hiddenPMRef.current.setSelection(pos)` → PM state update → visible pages re-render with selection overlay.

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

| What you're debugging                | Look here                                                |
| ------------------------------------ | -------------------------------------------------------- |
| How text/paragraphs appear on screen | `layout-painter/renderParagraph.ts`                      |
| How images appear on screen          | `layout-painter/renderImage.ts`                          |
| How tables appear on screen          | `layout-painter/renderTable.ts`                          |
| How pages are composed               | `layout-painter/renderPage.ts`                           |
| How a formatting command works       | `prosemirror/extensions/` (marks/ and nodes/)            |
| How keyboard shortcuts work          | `prosemirror/extensions/features/BaseKeymapExtension.ts` |
| How toolbar reflects selection       | `prosemirror/plugins/selectionTracker.ts`                |
| How DOCX XML is parsed               | `docx/paragraphParser.ts`, `docx/tableParser.ts`, etc.   |
| How PM doc is built from parsed data | `prosemirror/conversion/toProseDoc.ts`                   |
| Schema (node/mark definitions)       | `prosemirror/extensions/nodes/`, `marks/`                |
| Table toolbar/dropdown               | `components/ui/TableOptionsDropdown.tsx`                 |
| Main toolbar                         | `components/Toolbar.tsx`                                 |
| CSS for editor                       | `prosemirror/editor.css`                                 |

### Extension System

Extensions live in `src/prosemirror/extensions/`:

- `nodes/` — ParagraphExtension, TableExtension, ImageExtension, etc.
- `marks/` — BoldExtension, ColorExtension, FontExtension, etc.
- `features/` — BaseKeymapExtension, ListExtension, HistoryExtension, etc.
- `StarterKit.ts` bundles all extensions; `ExtensionManager` builds schema + runtime
- Two-phase init: `ExtensionManager.buildSchema()` (sync) → `initializeRuntime()` (after EditorState)

### Common Pitfalls

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

Issue tracker: **https://github.com/eigenpal/docx-js-editor/issues**

```bash
gh issue view <N> --repo eigenpal/docx-js-editor
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

## Rules

- Client-side only. No backend.
- Toolbar icons are Material Symbol fonts (same as Google Docs), saved locally as SVGs.
- Save screenshots to `screenshots/` folder
