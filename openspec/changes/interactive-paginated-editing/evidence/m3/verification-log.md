# M3 verification log

Milestone: **M3 — React one-surface no-chrome proof**
Recorded: 2026-07-25. Branch `spec/greenfield-pipeline`.

| Task | Commit |
| --- | --- |
| 6.2 | `checkpoint-4bc8df33` |
| 6.4 | `checkpoint-de855660` |
| click/metrics fix | `checkpoint-b0daa2c5` |
| M3.1 | `checkpoint-73f61231` |
| M3.2 | `checkpoint-48322a38` |

## Gate commands

| Command | Expected | Result |
| --- | --- | --- |
| `bun run verify:real-adapter-smoke` | 2/2 | **2 passed** |
| `bun run verify:real-adapter-gate` | 12/12 | **12 passed** |
| `bun run test:e2e:react-one-surface-interaction` | all pass | **11 passed** |
| `openspec validate interactive-paginated-editing --strict` | pass | **valid** |
| `git diff --check` | clean | **clean** |
| `git diff --cached --check` | clean | **clean** |
| `bun run typecheck` | pass | **fail — pre-existing nuxt TS5097 only; see `../m1/verification-log.md`** |

Every package M3 touched typechecks clean (`engine-editor`, `react`, `vue`,
`engine-output`, `core`). Unit suites: `packages/engine-editor/test` and
`packages/react/test` 369 pass / 1 fail, the failure being the pre-existing
`a11y-harness-vite-exports` vite child-process spawn recorded in the M2 log.

## The eleven interaction scenarios

Each drives real CDP input against a glyph located by public attribute. None
calls `authorizeCaret` or `setSelection` to place a caret.

| Scenario | Proves |
| --- | --- |
| Click places the caret at the glyph | Clicking further right lands further along the text |
| Type and backspace | Model revision advances, pages repaint, original restored |
| Shift-click | Anchor is retained, head extends, selection not collapsed |
| Double-click | Whole word, not split |
| Drag | Range across the glyph, not collapsed |
| Keyboard navigation | ArrowRight/Left/End/Home from the clicked caret |
| Margin click | Typed `invalidTarget`, selection unmoved |
| Clipboard paste | Inserts at the clicked caret, revision advances |
| IME composition | Commits once via `Input.imeSetComposition` |
| Undo/redo | By real shortcut through the focused input host |
| Save and reopen | Edit survives DOCX serialization and repaints |

## Defects found by browser verification

Six, all fixed. Four were invisible to unit tests by construction — they are
agreements between painted DOM and engine geometry:

1. Host metrics measured the scroll container, not the page stack.
2. The stylesheet centered pages inside a full-width stack, offsetting the stack
   origin from the page origin.
3. `pointermove` reports `button: -1`; the primary-button filter dropped every
   move in a drag.
4. The click concluding a drag collapsed the range just selected.
5. The surface rendered outside `.ep-root`, so every `--doc-*` token resolved to
   nothing and overlays painted invisibly.
6. `--doc-page-bg` and `--doc-caret` had no light-mode value.

## Known gaps carried forward

- Typing bursts are not coalesced into one undo step (Word coalesces).
- Selection rects are per shaped cluster, so multi-word highlights show hairline
  gaps between words. Cosmetic; geometry is correct.
- `bun run check:parity-contract` still fails on the stale untracked Vue API
  snapshot. Not an M3 gate; it **is** in M5-R1.
- Vue is unwired. React-first is the M3 design; Vue is 6.3 / M5.
