# M3 summary (task M3-R2)

Recorded: 2026-07-25. Milestone **M3 — React one-surface no-chrome proof**.

## Progress ledger

| Snapshot | Count |
| --- | --- |
| After **M2-R2** | **45 / 114** |
| After **6.2** (`checkpoint-4bc8df33`) | **46 / 114** |
| After **6.4** (`checkpoint-de855660`) | **47 / 114** |
| After **M3.1** (`checkpoint-73f61231`) | **48 / 114** |
| After **M3.2** (`checkpoint-48322a38`) | **49 / 114** |
| After **M3-R1** (`checkpoint-3258c9d6`) | **50 / 114** |
| After **M3-R2** (this artifact) | **51 / 114** |

## What changed for a user

Before M3 the demo painted pages that could not be edited. Clicking did nothing
because no adapter forwarded pointer events, and the tests placed the caret
programmatically.

Now, in the React demo at `?realAdapter=1`:

**Click a painted glyph → caret lands at that glyph → type → the canonical model
updates → layout repaints → the caret and selection are visible.**

That is the pipeline this whole change exists to deliver, working end to end on
body paragraphs.

## What proves it

`bun run test:e2e:react-one-surface-interaction` — 11 scenarios, all passing,
every one driven by real CDP input against a glyph located by public attribute:
click-to-caret, type/backspace, shift-click, double-click, drag, keyboard
navigation, margin refusal, clipboard paste, CDP IME composition, undo/redo by
shortcut, and save/reopen.

**No scenario calls `authorizeCaret` or `setSelection` to place a caret.** That
was the explicit M3 bar and it is met.

Plus the manual Chrome pass in `manual-chrome-checklist.md`: 12 checks, with
measured evidence that painted DOM and engine geometry agree exactly (item
page-local x = 96 measured, x = 96 published).

## What browser verification caught

Six defects, four of which unit tests could not have caught by construction —
they are *agreements between painted DOM and engine geometry*, not logic errors
inside either side:

| # | Defect | Why unit tests missed it |
| --- | --- | --- |
| 1 | Host metrics measured the scroll container, not the page stack | Both are `HTMLElement`; only a real layout shows the origins differ |
| 2 | Stylesheet centered pages inside a full-width stack, offsetting stack origin from page origin by 440px | CSS is not exercised by unit tests |
| 3 | `pointermove` reports `button: -1`; the primary-button filter dropped every drag move | Synthetic events in tests passed `button: 0`, which real browsers do not |
| 4 | The click concluding a drag collapsed the range just selected | Requires the browser's real click-after-drag sequence |
| 5 | Surface rendered outside `.ep-root`, so every `--doc-*` token resolved to nothing and overlays painted transparent | Geometry was correct; only the pixels were wrong |
| 6 | `--doc-page-bg` and `--doc-caret` had no light-mode value | Same |

Defects 3 and 4 now have unit regressions in `adapter-event-bridge.test.ts`,
because they *are* expressible once you know real browsers report `button: -1`.

## Known gaps

| Gap | Disposition |
| --- | --- |
| Typing bursts are not coalesced into one undo step; Word coalesces | Recorded, not fixed. The spec asserts a single character rather than pinning a granularity policy this milestone has not specified. |
| Selection rects are per shaped cluster, so multi-word highlights show hairline gaps | Cosmetic; the rects are geometrically correct. |
| `check:parity-contract` fails on the stale untracked Vue API snapshot | Not an M3 gate. **In the M5-R1 bundle — must clear before M5.** |
| `bun run typecheck` fails in `@docx-editor.dev/nuxt` (TS5097) | Pre-existing, unrelated to this change, carried since M1. |
| Vite binds IPv6 `[::1]` only, so the runbook's `127.0.0.1` URLs refuse | Recorded in the checklist and the matrix. Either the runbook says `localhost` or `dev:react` adds `--host 127.0.0.1`. |
| Vue is unwired | By design — React-first. 6.3 / M5. |

## Claim allowed after M3

**Internal React one-surface alpha only.**

Not public `interactive-paginated`, which remains task **8.10** after async
layout, virtualization, and the performance budgets. The browser-platform matrix
is updated to mark the React one-surface lane automated and passing, and to
narrow the two "not automated" gaps to Vue only, while restating that neither
satisfies the public claim.
