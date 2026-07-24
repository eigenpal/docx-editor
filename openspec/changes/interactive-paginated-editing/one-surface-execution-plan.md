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

## 1. Goal and non-negotiable architecture

**Goal:** Prove body-paragraph editing on engine-painted pages, port the polished
retired shell, reach Vue parity, and record paired bounded-document
**internal/preview alpha** at M6. The **first formal public `interactive-paginated`
claim** is task **8.10**.

**Non-negotiable architecture:**

1. `DocumentStore` is canonical; ProseMirror is hidden behind `EditorBinding`.
2. Engine layout + display list is sole geometry authority.
3. Formatting/history toolbar: `Editor.can(command)` then `Editor.exec(command)` for bold, italic, underline, undo, redo using typed command objects (for example `{ type: 'toggleMark', mark: 'bold' }`).
4. Save button: **`Editor.save()`** directly — not can/exec.
5. Rulers: **display-only** via **`Editor.getPageGeometry()`**; margin/tab markers omitted or disabled.
6. Forbidden wholesale restore: `PagedEditor`, `useLayoutPipeline`, `usePagesPointer`, `OffscreenEditorHost`, retired flow/pagination/painter models.
7. Port presentation component-by-component from ref the recorded presentation baseline.

---

## 2. Exact current state

| Item | Value |
| --- | --- |
| Progress | **32 / 114** complete |
| M0 historical (tasks 1–4) | **28** |
| Pre-**5.5** (+ 5.1–5.4) | **32** |
| **5.5** | unchecked, in progress |
| M0-R1 / M0-R2 | unchecked verification |
| React dev | `bun run dev:react -- --port 5273 --strictPort --force` |
| Vue dev | `bun run dev:vue -- --port 5274 --strictPort --force` |
| React harness URL | `http://127.0.0.1:5273/?realAdapter=1` |
| Vue harness URL | `http://127.0.0.1:5274/?realAdapter=1` |

---

## 3. Retired archaeology (read-only ref `checkpoint-9bb06c38`)

```bash
git show checkpoint-checkpoint-9bb06c38f43c0dc297e3de8b5b488b241e134be1:packages/react/src/components/DocxEditor/DocxEditorShell.tsx | less
git ls-tree -r --name-only checkpoint-checkpoint-9bb06c38f43c0dc297e3de8b5b488b241e134be1 packages/react/src/components/DocxEditor/
```

Never port: `PagedEditor.tsx`, `OffscreenEditorHost.tsx`, `useLayoutPipeline.ts`, `usePagesPointer.ts`.

---

## 4. Verification commands and expected results

### Every granular task (minimum)

```bash
bun run typecheck
openspec validate interactive-paginated-editing --strict
git diff --check
```

**Expected:** exit 0; validation prints `Change 'interactive-paginated-editing' is valid`.

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

Open **`http://127.0.0.1:5273/?realAdapter=1`**.

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

Open **`http://127.0.0.1:5273/?realAdapter=1`**.

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

Each counted checkbox through **M6-R2** gets **exactly one normal commit**. No git tags.
Unrelated dirty files stay unstaged.

1. Complete deliverable; run verification commands.
2. Stage **only** literal paths from `tasks.md` §Per-task staging manifests.
3. `git diff --cached --name-only | sort` MUST equal the manifest sorted.
4. `git diff --cached --check`
5. Staged security check when manifest includes `packages/` or `examples/` paths.
6. `git commit -m "feat: land 5.6a body-paragraph interaction roles"`
7. Progress note: `interactive-paginated-editing: 33/114 — 5.6a complete`

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

1. M0-R1/R2
2. **5.5** + **5.6a** + **5.7a**
3. M2 (+ **M2.3** click target)
4. M3 React proof
5. M4 shell (can/exec + `Editor.save()`, `getPageGeometry()` rulers)
6. M5 Vue
7. M6 paired preview
8. Sections 7–8 → **8.10**
