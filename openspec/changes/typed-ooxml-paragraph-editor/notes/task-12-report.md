# Task 12 — fix round 1/5 report

Scope: address **HIGH 1–4 only** from `task-12-review.md`. Medium/Low deferred. No commit in this round.

## HIGH finding status

| ID | Finding | Status | Evidence |
|----|---------|--------|----------|
| HIGH 1 | Nested column furniture targets inner table only | **GREEN** | `semantic-table-interaction.test.ts` nested insert-column + task12 outer-host test; `surface-table-interaction.test.ts` nested column insert; Playwright column insert asserts exact inner/outer `tableId` and outer grid unchanged (Y-scan + `[data-table-id]` on insert-column control) |
| HIGH 2 | Real UI browser story (no hook mutations) | **GREEN** | Playwright `e2e/table-editing.interaction.spec.ts`: pointer drag rect selection via painted `[data-paragraph-id]` endpoints; furniture divider/right-edge/row/column; context insert+delete rows; toolbar border/fill; multi-step toolbar undo + keyboard redo with topology oracles; **125% remount-at-zoom + scroll + divider furniture drag** (round 2) |
| HIGH 3 | D9 / exact identity / outer isolation | **GREEN** | Pre-save `saveReopenDigestDiff(prePart, prePart) === []`; post-reopen fingerprint equality + digest `[]`; inner `tableId`/grid/rowCount; `outerTableIsolationEqual(baselinePart, postPart)` with inner subtree sentinel + volatile width/paraId stripping |
| HIGH 4 | Gates | **GREEN** unit/export; **RED** full parity | See gate table below |

### HIGH 2 note — zoom + furniture (resolved round 2)

Dynamic **`Editor.setZoom` without remount** remains deferred (surface keeps mount-time scale; see `docx-editor.ts`). The supported lifecycle for 125% furniture is **`setZoom` + `load(savedBytes)`**, which remounts the surface at `zoom × 96/72` without implementing general zoom-without-remount. Round 2 uses hook `remountAtZoom(1.25)` (save → setZoom → load) then real divider furniture hover/drag after scroll.

## Playwright browser actions (main acceptance spec)

1. Focus inner cell (`INNER-NW`); divider drag on inner column 1; right-edge drag widens inner table.
2. Row `+` furniture on inner row 0; column `+` via Y-scan until `[data-table-id="${innerId}"]` insert-column; assert outer grid unchanged.
3. Context menu insert row below from `INNER-NW`; context menu delete row from `INNER-SW` (preserves inner marker for readback).
4. Pointer drag rectangle from topology `paragraphIds` NW → SE corner cell; assert `getTableCellSelection()` tableId/rows/columns/cellIds.
5. Toolbar: border target inside, style dotted, width 8, colors; save bytes; assert OOXML on selected `formattedCellId`.
6. Toolbar undo loop until border/fill cleared; assert `detailedTopology` rows match pre-format; keyboard redo restores format.
7. **`remountAtZoom(1.25)`**; scroll to filler paragraph 10; scroll back; **divider handle visible** (`screenshots/task12-09-zoom-divider-handle.png`); divider drag changes inner column widths; outer grid unchanged.
8. Save/reopen: fingerprint stable, digest diff `[]`, outer isolation equal, inner topology stable.

Merged-table spec: column insert refusal reason via real hover (no context fallback).

## Gate outputs (2026-08-04, worktree `v2-table-editing`)

| Gate | Result | Output |
|------|--------|--------|
| `bun test` | **GREEN** | 3769 pass, 0 fail |
| `bunx playwright test e2e/table-editing.interaction.spec.ts` | **GREEN** | 2 passed |
| `bun run typecheck` | **GREEN** | all packages exit 0 |
| `bun run api:check` | **GREEN** | 0 errors |
| `bun run i18n:validate` | **GREEN** | all locales in sync |
| `openspec validate typed-ooxml-paragraph-editor --strict` | **GREEN** | change valid |
| `bun run check:export-parity` | **GREEN** | 238 names match; 14 React table exports in `intentional-export-divergence.md` |
| `bun run check:parity` | **RED** | fails on `check:public-docs-surface` — **pre-existing** drift (legacy plugin symbols: `PluginHost`, `EditorPlugin`, `templatePlugin`, etc.; not introduced by table-editing exports) |

## Remaining HIGH concerns (after round 2)

1. **`check:parity` full green** — export parity green; `check:public-docs-surface` still fails on **pre-existing** legacy plugin symbols (`PluginHost`, `EditorPlugin`, `templatePlugin`, etc.) unrelated to table editing.

---

# Task 12 — fix round 2/5 report

Scope: resolve **remaining HIGH zoom furniture** without implementing deferred dynamic zoom-without-remount.

## Decision

| Approach | Verdict |
|----------|---------|
| Dynamic `setZoom` + furniture at same mount | **Out of scope** — zoom-without-remount deferred per workspace decision |
| Scoped table-furniture scale patch on live mount | **Not needed** — furniture works when surface mounts at correct scale |
| **`setZoom` + `load(bytes)` remount** | **Supported** — `mountBytes` samples `scaleOf()` at remount time (`docx-editor.ts`) |

## Changes

- Hook: `remountAtZoom(zoom)`, `getRenderScale()` (read-only).
- E2e: replace context-menu zoom substitute with `remountAtZoom(1.25)` → scroll → divider furniture hover (screenshot) → drag → inner width change + outer grid unchanged.
- Unit: `nested divider resize at 125% mount scale targets inner table` in `surface-table-interaction.test.ts`.

## Gate outputs (round 2)

| Gate | Result |
|------|--------|
| `bunx playwright test e2e/table-editing.interaction.spec.ts` | **GREEN** — 2/2 pass |
| `bun test` surface + semantic table interaction | **GREEN** — 61 pass (includes 125% mount-scale divider test) |
| `bun run typecheck` | **GREEN** |
| `bun run check:export-parity` | **GREEN** — 238 names |
| `bun run check:parity` | **RED** — pre-existing `check:public-docs-surface` plugin drift only |

## Remaining HIGH concerns

None for zoom furniture. Only pre-existing **`check:parity` / public-docs-surface** drift remains (not table-editing scope).

---

# Task 12 — fix round 3/5 report

Scope: fix only **remaining HIGH 2** (real pointer furniture clicks) and **HIGH 3** (exact identity/OOXML/isolation).

## HIGH finding status

| ID | Finding | Status | Evidence |
|----|---------|--------|----------|
| HIGH 2 | Permanent real pointer clicks for row/column `+` | **GREEN** | Removed all `dispatchEvent` furniture helpers; `pointerClickVerifiedControl` uses `elementFromPoint` hit-test then `page.mouse.click()`; insert controls carry `data-table-id`, `data-row-id`, `data-grid-column-id`; column insert Y-scan uses real pointer only; row/column asserts inner `tableId`/grid topology + outer isolation unchanged; 125% divider drag retained |
| HIGH 3 | Exact identity / OOXML / isolation | **GREEN** | Extended `detailedTableSnapshot` (gridColumnIds, tcWidthTwips, per-edge border attrs, fill payload); `assertInsideBorderOracle` for dotted/sz=8/color=336699 inside edges + fill 0070C0 on selection rectangle; pre-save inner snapshot from bytes compared exactly to post-reopen; outer isolation fingerprint without stripping (loaded-at-start baseline vs pre-save vs reopened); D9 `saveReopenDigestDiff` pre-save vs reopened |

## Changes

- `surface-table-interaction.ts`: `data-row-id` / `data-grid-column-id` on insert furniture.
- `table-editing-assertions.ts`: rich inner snapshot, inside-border oracle, `detailedTopologyContentEqual`, full outer fingerprint (no tblW/tcW/paraId stripping).
- `table-editing.interaction.spec.ts`: real pointer furniture; loaded-at-start outer isolation baseline; exact pre-save/reopen inner detailed equality from saved bytes.

## Gate outputs (round 3)

| Gate | Result |
|------|--------|
| `bunx playwright test e2e/table-editing.interaction.spec.ts` (×2) | **GREEN** — 2/2 pass both runs |
| `bun test` surface + semantic table interaction + nested fixture | **GREEN** — 61 pass |
| `bun run typecheck` | **GREEN** |

## Remaining HIGH concerns

None for HIGH 2/3. Pre-existing **`check:parity` / public-docs-surface** drift unchanged (out of scope).

---

# Task 12 — final HIGH formatting oracle fix

Scope: strengthen permanent e2e formatting oracle — selected/unselected partition, no leakage, full per-cell pre-format baseline.

## Changes

- `assertSelectionIdPartition`: selected/unselected IDs disjoint, exhaustive, strict subset, unselected non-empty.
- `assertTableFormattingOracle`: all inner cells checked by grid — selected get inside-border/fill projection; unselected match pre-format decoration exactly (borders, fill, tcPr decoration fingerprint; optional width drift after divider resize).
- `assertAllInnerCellsMatchPreFormat`: post-undo full decoration restore for every cell.
- `tcPrDecorationFingerprint` on every cell in `detailedTableSnapshot` (tcPr minus tcW).
- E2e checkpoints: post-format, saved-bytes, post-redo, pre-save, reopened — all run formatting oracle; undo runs full pre-format restore oracle.

## Gate outputs

| Gate | Result |
|------|--------|
| `bunx playwright test e2e/table-editing.interaction.spec.ts` (×2) | **GREEN** — 2/2 both runs |
| `bun test ./e2e/fixtures/table-editing-nested-fixture.test.ts` | **GREEN** — 2 pass |
| `bun run typecheck` | **GREEN** |

## Remaining HIGH concerns

None.
