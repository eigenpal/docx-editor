# M2 verification log

Milestone: **M2 — shared style, paint, event bridge, deterministic targets**
Branch: `spec/greenfield-pipeline`

| Task | Commit |
| --- | --- |
| 6.1 | `checkpoint-bccf5b11` |
| M2.1 | `checkpoint-23fe0087` |
| M2.2 | `checkpoint-46e8cf6a` |
| M2.3 | `checkpoint-78e23d6a` |

## 1. Display bridge tests

```bash
bun test packages/engine-editor/test/display-bridge.test.ts
```

**Result: pass — 21 pass, 0 fail, 353 expect() calls.**

Covers the M2.2 overlay conversion (page-local rects, caret page identity and
writing direction, empty-frame no-op, zoom absent from geometry, CSS matrix
order) and the M2.3 target selection (ink not whitespace, center inside the
glyph box, read-only blocks skipped, null on an empty document, stable across
calls).

## 2. Adapter CSS thinness

```bash
bun run check:adapter-css-thin
```

**Result: pass — `✓ adapter editor.css files are thin (shared styling lives in
core).`**

This gate was failing with `ENOENT` before M2: the greenfield strip `checkpoint-701c1a9f`
deleted both adapter stylesheets, so the check aborted on a missing file instead
of measuring the invariant. Task 6.1 recreated both import-only.

## 3. Typecheck

```bash
bun run typecheck
```

**Result: fail — unchanged pre-existing `@docx-editor.dev/nuxt` TS5097 against
`engine-binding` and `engine-layout` sources. Not M2 work; see
`../m1/verification-log.md` for the evidence that it predates this queue.**

Every package M2 touched typechecks clean:

| Package | `tsc --noEmit` |
| --- | --- |
| `engine-editor` | Pass |
| `engine-output` | Pass |
| `react` | Pass |
| `vue` | Pass |
| `engine-core` | Pass |

## 4. Strict OpenSpec validation

```bash
openspec validate interactive-paginated-editing --strict
```

**Result: pass — `Change 'interactive-paginated-editing' is valid`.**

## 5. Diff check

```bash
git diff --check
```

**Result: pass — clean.**

## Other known-failing checks, recorded not suppressed

| Check | Status | Note |
| --- | --- | --- |
| `packages/engine-editor/test/a11y-harness-vite-exports.test.ts` | Fail | Vite child process exits before ready in this environment. Reproduced with all M2 work stashed, so it predates the milestone. Not in the M2-R1 bundle. |
| `bun run check:parity-contract` | Fail | `Could not locate DocxEditorRef in docs/api/docx-editor-vue/index.api.md` — the API snapshot is untracked and stale after the greenfield strip. Reproduced with all M2 work stashed. Not in the M2-R1 bundle; it **is** in the M5-R1 bundle and must be cleared before M5. |

## Gate status

| M2-R1 requirement | Status |
| --- | --- |
| `display-bridge.test.ts` | Pass |
| `check:adapter-css-thin` | Pass |
| `bun run typecheck` | **Fail — pre-existing nuxt TS5097, outside M2 scope** |
| Strict validation | Pass |
| `git diff --check` | Pass |
