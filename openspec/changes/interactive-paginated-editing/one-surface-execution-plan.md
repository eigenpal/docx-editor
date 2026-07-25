# One-surface execution plan — interactive paginated editing

Long-running Claude Code runbook for the accelerated M0–M6 path. OpenSpec authority:

- `openspec/changes/interactive-paginated-editing/proposal.md`
- `openspec/changes/interactive-paginated-editing/design.md`
- `openspec/changes/interactive-paginated-editing/specs/interactive-paginated-editing/spec.md`
- `openspec/changes/interactive-paginated-editing/tasks.md`
- `openspec/changes/interactive-paginated-editing/browser-platform-matrix.md`

Evidence root: `openspec/changes/interactive-paginated-editing/evidence/` with subdirectories
`m0/` through `m6/`. Staging manifests are authoritative in `tasks.md` §Per-task staging
manifests.

---

## 1. Claude handoff goal

This file is the **single execution runbook** to give Claude Code. `tasks.md`
contains the formal checkbox text and staging manifests; the proposal, design,
and capability spec are normative references, not additional task lists.

**Immediate goal:** opening **`http://127.0.0.1:5273/`** loads
`e2e/fixtures/comprehensive-word-element-test.docx` in the production
`packages/react/src/DocxEditor.tsx`, renders the polished retired React chrome,
and lets a user click supported body text, type, select naturally, use familiar
ProseMirror keyboard commands, apply bold/italic, undo/redo, save, and reopen.

Visual and behavioral reference:

- deployed reference: **https://latest.docx-editor.dev/react/**
- source archaeology: **the recorded presentation baseline**

Claude SHOULD use Chrome DevTools against both the deployed reference and local
React URL to compare component hierarchy, dimensions, spacing, icons, disabled
states, scrolling, selection, focus, and keyboard behavior. The deployed site is
a product-behavior reference, not source or architectural authority.

**Non-negotiable architecture:**

1. `DocumentStore` is canonical; ProseMirror is hidden behind `EditorBinding`.
2. Engine layout + display list is sole geometry authority.
3. Formatting/history toolbar: `Editor.can(command)` then `Editor.exec(command)` for bold, italic, underline, undo, redo using typed command objects (for example `{ type: 'toggleMark', mark: 'bold' }`).
4. Save button: **`Editor.save()`** directly — not can/exec.
5. Rulers: **display-only** via **`Editor.getPageGeometry()`**; margin/tab markers omitted or disabled.
6. Forbidden wholesale restore: `PagedEditor`, `useLayoutPipeline`, `usePagesPointer`, `OffscreenEditorHost`, retired flow/pagination/painter models.
7. Port presentation component-by-component from ref the recorded presentation baseline, using `https://latest.docx-editor.dev/react/` as the live visual/behavioral reference.
8. `packages/react/src/DocxEditor.tsx` is the sole React product root: it composes chrome and the painted-page surface internally. Examples supply fixtures/configuration only and never assemble a second shell around an incomplete package component.

---

## 2. Ordered React task list

Work these in order. Do not restart completed M0–M6 implementation and do not
wait for Vue. Each row ends with its focused evidence, verification, and one
normal commit before moving to the next row.

| Order | Task | Concrete outcome | Hard pass boundary |
| --- | --- | --- | --- |
| 1 | **M6D.1 — default comprehensive fixture** | Bare React `/` loads all nine pages of the canonical comprehensive fixture through the production component; `?fixture=` remains available. | Chrome shows the expected document without query parameters; page count and representative text match; bytes match the canonical fixture. Editability is not part of this wiring task. |
| 2 | **M6P.1 — partial body editability** | Replace document-wide read-only with a per-block policy: safe preserved paragraphs are editable while tables, SDTs, unsupported structures, and unsafe paragraphs remain immutable. | The comprehensive fixture reports `partial`; one safe paragraph supports edit/save/reopen; crossing or disturbing read-only boundaries refuses; untouched complex ranges and package parts remain preserved. |
| 3 | **M6V.1 — actual retired React chrome** | `DocxEditor.tsx` directly composes the old title/menu/toolbar/rulers/workspace/page indicator/sidebar/dialog-launch presentation. | Fixed-viewport local screenshots are compared with `https://latest.docx-editor.dev/react/` and the presentation reference; no named chrome region is missing; only undo, redo, bold, italic, and save can dispatch. |
| 4 | **M6K.1 — native ProseMirror command behavior** | PM owns semantic editing, deletion, Enter, history, shortcuts, and logical horizontal selection; engine owns paginated geometry and safety preflight. | Differential real-browser gate matches raw PM for the declared matrix; stale/invalid `setSelection` refuses; PM cannot pre-empt an engine-refused geometry key; partial-mode structural commands still refuse safely. |
| 5 | **M6S.1 — natural selection presentation** | Select the best React presentation among merged engine rectangles, native Range/Selection, and CSS Custom Highlight without changing semantic authority. | Spaces, run boundaries, wrapping, paragraphs, graphemes, bidi, zoom, clipping, and cross-page selection show no false gaps; copy/focus/IME/a11y remain correct. |
| 6 | **React goal gate** | The comprehensive document is visibly loaded and its safe paragraphs are practically editable beside preserved read-only structures in the polished old product chrome. | Run all focused React gates plus typecheck and strict OpenSpec validation; perform the manual journey below; fresh independent correctness, security, and architecture reviewers report zero Blocker/Critical/High findings on current HEAD. |

### Manual goal journey

At `http://127.0.0.1:5273/`, without query parameters:

1. Confirm the comprehensive fixture and complete old React chrome are visible.
2. Confirm the session reports `partial`, with stable diagnostics for read-only regions.
3. Click a supported body paragraph and type text.
4. Click a table or SDT and confirm it remains visible but refuses editing without moving the canonical selection into it.
5. Select text across spaces and formatting-run boundaries within the editable paragraph; no false visual gaps.
6. Attempt a selection/edit across a read-only boundary and confirm atomic refusal.
7. Exercise Left/Right, Shift-Left/Right, Cmd/Ctrl+A, word deletion,
   Enter/Shift-Enter, selection deletion, undo, and redo.
8. Apply bold and italic; confirm unavailable controls remain visibly disabled.
9. Save, reopen the exported bytes, and confirm the supported edit persists.
10. Confirm unsupported structures are preserved/read-only or explicit fallback,
   never silently discarded.

### No-early-exit rule

Claude MUST continue until all six rows pass or a concrete external blocker
prevents progress. An existing implementation, passing unit tests, an
author-produced review, or a page that merely renders does not satisfy the goal.
For each failed gate: reproduce it, add a focused regression, fix the root cause,
verify, commit, and continue. Launch fresh independent reviewers at the final
React goal gate. Only Blocker/Critical/High findings block completion; record
Medium/Low without opening an endless polish loop.

Current ledger authority: `tasks.md` (**70 / 120** complete when this runbook was
updated). Re-read its first line after every commit rather than copying this
snapshot into progress reports.

---

## 3. Retired reference and archaeology

```bash
git show checkpoint-9bb06c38f43c0dc297e3de8b5b488b241e134be1:packages/react/src/components/DocxEditor/DocxEditorShell.tsx | less
git ls-tree -r --name-only checkpoint-9bb06c38f43c0dc297e3de8b5b488b241e134be1 packages/react/src/components/DocxEditor/
```

Open `https://latest.docx-editor.dev/react/` in Chrome for the working product
reference. Compare observable presentation and interaction; do not copy runtime
state or infer architectural authority from its DOM.

Do not wholesale restore `PagedEditor.tsx`, `OffscreenEditorHost.tsx`,
`useLayoutPipeline.ts`, `usePagesPointer.ts`, or the retired flow/pagination/
painter models. Their behavior and presentation may be studied and selectively
implemented, but their old geometry/layout authority MUST NOT run beside the
greenfield engine.

---

## 4. Verification commands and expected results

### Every granular task (minimum)

```bash
bun run typecheck
openspec validate interactive-paginated-editing --strict
git diff --check
```

**Expected:** exit 0; validation prints `Change 'interactive-paginated-editing' is valid`.

**Fast-path review policy:** only Blocker/Critical/High findings stop delivery.
Record Medium/Low findings for later; do not fix or re-review them unless they
fail an explicit gate or new evidence raises their severity. Run focused checks
per granular task and reserve broad suites for their declared milestone gates.

### M1 (5.5 + 5.6a + 5.7a)

```bash
bun test packages/engine-editor/test/keyboard-navigation.test.ts \
  packages/engine-editor/test/navigation-session.test.ts \
  packages/engine-editor/test/navigation-production.test.ts \
  packages/engine-editor/test/line-catalog.test.ts \
  packages/engine-editor/test/interaction-planner.test.ts \
  packages/engine-core/test/adapter-authority.test.ts
```

### M3 React internal alpha

```bash
bun run verify:real-adapter-smoke
bun run verify:real-adapter-gate
bun run test:e2e:react-one-surface-interaction
```

Script created by **M3.1** in `package.json`:

```json
"test:e2e:react-one-surface-interaction": "playwright test --config e2e/editor-smoke.config.ts e2e/react-one-surface.interaction.spec.ts"
```

**Expected:** smoke 2/2, gate 12/12, one-surface spec all pass.

### M5 Vue

```bash
bun run test:e2e:vue-one-surface-interaction
bun run check:parity-contract
```

### M6 paired preview (not public claim)

```bash
bun run test:e2e:paired-one-surface-interaction
```

---

## 5. Chrome DevTools manual verification

Start servers in separate terminals:

```bash
bun run dev:react -- --port 5273 --strictPort --force
bun run dev:vue -- --port 5274 --strictPort --force
```

### M3.2 React checklist

File: `openspec/changes/interactive-paginated-editing/evidence/m3/manual-chrome-checklist.md`

Open **`http://127.0.0.1:5273/`**. `?realAdapter=1` remains a compatibility
alias, not the primary goal URL.

| Step | Chrome agent action | Assert |
| --- | --- | --- |
| 1 | **Elements** → find `[data-testid="one-surface-click-target"]` on page 0 | Node exists with non-zero bounding rect |
| 2 | **Pointer** → click exact center of that element | Caret overlay visible; do not call `authorizeCaret` |
| 3 | **Keyboard** → type `abc` | Painted page text includes `abc` |
| 4 | **Backspace** once | Painted text shows `ab` |
| 5 | **Pointer** → drag across two words | Selection overlay rectangles visible |
| 6 | **Undo** Ctrl/Cmd+Z | Painted text reverts |
| 7 | Harness **`Editor.save()`** reopen | Bytes round-trip; typed text preserved |
| 8 | **Elements** → accessibility tree | One editable document owner |

### M4.2 React shell checklist

File: `openspec/changes/interactive-paginated-editing/evidence/m4/manual-chrome-shell.md`

Open **`http://127.0.0.1:5273/`** and compare it with
**`https://latest.docx-editor.dev/react/`** at the same viewport.

| Step | Action | Assert |
| --- | --- | --- |
| 1 | Inspect toolbar Bold | Disabled when `Editor.can({ type: 'toggleMark', mark: 'bold' })` is false; enabled when true; click invokes `Editor.exec({ type: 'toggleMark', mark: 'bold' })` on painted surface |
| 2 | Inspect Save | Invokes `Editor.save()`; not routed through can/exec |
| 3 | Inspect rulers | Visible; no margin/tab drag handles |
| 4 | Re-run M3.2 steps 2–7 | All still pass |

### M6.2 Paired preview

File: `openspec/changes/interactive-paginated-editing/evidence/m6/manual-chrome-paired.md`

Run M3.2 matrix on:

- React: **`http://127.0.0.1:5273/?realAdapter=1`**
- Vue: **`http://127.0.0.1:5274/?realAdapter=1`**

---

## 6. Playwright deterministic click (M3.1 / M5.2 / 6.5)

```typescript
// e2e/oneSurfaceHelpers.ts
export async function clickFixtureGlyph(page: Page) {
  const target = page.locator('[data-testid="one-surface-click-target"]');
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  if (!box) throw new Error('missing click target box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
```

---

## 7. Staged security check (fail closed)

Use the task's literal `STAGED_PATHS` from `tasks.md`. **Expected: zero pattern matches.**

```bash
STAGED_PATHS=(
  packages/react/src/DocxEditor.tsx
)
TMP_ADDED="$(mktemp)"
TMP_PLUS="$(mktemp)"
TMP_LINES="$(mktemp)"
trap 'rm -f "$TMP_ADDED" "$TMP_PLUS" "$TMP_LINES"' EXIT

if ! git diff --cached --unified=0 -- "${STAGED_PATHS[@]}" >"$TMP_ADDED"; then
  echo "security: git diff --cached failed" >&2
  exit 1
fi

rg '^\+' "$TMP_ADDED" >"$TMP_PLUS"
plus_status=$?
if [ "$plus_status" -gt 1 ]; then
  echo "security: added-line search failed ($plus_status)" >&2
  exit 1
fi

if [ "$plus_status" -eq 0 ]; then
  rg -v '^\+\+\+' "$TMP_PLUS" >"$TMP_LINES"
  lines_status=$?
  if [ "$lines_status" -gt 1 ]; then
    echo "security: diff-header filtering failed ($lines_status)" >&2
    exit 1
  fi
else
  : >"$TMP_LINES"
fi

rg -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|window\.open\(|\.href\s*=|font-family:.*\$\{' "$TMP_LINES" >/dev/null
match_status=$?
case "$match_status" in
  0)
    rg -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|window\.open\(|\.href\s*=|font-family:.*\$\{' "$TMP_LINES" >&2
    echo "security: forbidden sink in staged diff" >&2
    exit 1
    ;;
  1)
    exit 0
    ;;
  *)
    echo "security: rg infrastructure error ($match_status)" >&2
    exit 1
    ;;
esac
```

After the security check on code paths, always run `git diff --cached --check`.

---

## 8. Granular commit protocol

Each counted checkbox through **M6S.1** gets **exactly one normal commit**. No git tags.
Unrelated dirty files stay unstaged.

1. Complete deliverable; run verification commands.
2. Stage **only** literal paths from `tasks.md` §Per-task staging manifests.
3. `git diff --cached --name-only | sort` MUST equal the manifest sorted.
4. `git diff --cached --check`
5. Staged security check when manifest includes `packages/` or `examples/` paths.
6. `git commit -m "feat: land 5.6a body-paragraph interaction roles"`
7. Progress note: `interactive-paginated-editing: 71/120 — M6D.1 complete`

M0 evidence entrypoints:

- **M0-R1** → `openspec/changes/interactive-paginated-editing/evidence/m0/baseline-verification.md`
- **M0-R2** → `openspec/changes/interactive-paginated-editing/evidence/m0/authority-review.md`

---

## 9. Allowed claims

| Milestone | Public manifest |
| --- | --- |
| M3–M5 | Below `interactive-paginated` |
| M6 | Internal/preview alpha only |
| **8.10** | **First formal public `interactive-paginated`** |

---

## 10. Priority order

1. **M6D.1** — load the comprehensive fixture at bare React `/`.
2. **M6P.1** — implement per-block partial editability so safe paragraphs remain
   editable beside immutable tables, SDTs, and unsupported structures.
3. **M6V.1** — port and approve the actual retired React chrome using the
   deployed reference and presentation reference.
4. **M6K.1** — restore natural ProseMirror commands and close stale/refused
   selection pre-emption defects.
5. **M6S.1** — approve natural selection presentation on React.
6. **React goal gate** — save/reopen journey, broad React verification, and
   fresh independent review until zero Blocker/Critical/High findings.
7. Sections 7–9 and 10.1–10.6 on the approved React reference surface.
8. **10V.1** — mechanically port the completed React UI/selection presentation
   to Vue.
9. 10.7–10.8 final paired verification and independent review.
