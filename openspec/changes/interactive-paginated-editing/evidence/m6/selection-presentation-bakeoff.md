# M6S.1 — selection presentation bake-off (React)

## The defect

The engine derives one selection rectangle per painted RUN, and the painter emits one
absolutely positioned box per run with no line box between them. A selection therefore
showed a visible hole wherever whitespace fell on a run boundary. Reported with
screenshots in which `Arial | Times New Roman | Courier New` highlighted as separate
islands with gaps at every separator.

An earlier note in this change called it "cosmetic; geometry is correct". That was the
wrong conclusion from a correct observation: the per-run rectangles ARE individually
correct, and a reader still perceives the selection as broken, because a selection is
perceived as continuous along a line.

## Options compared

| Option | Verdict |
| --- | --- |
| **Merged engine rectangles** | **Adopted.** Presentation-only, no new DOM, no new browser dependency, works identically at any zoom and across pages, and keeps the engine as sole geometry authority. |
| Native DOM `Range` / `Selection` | **Rejected.** Requires the selected text to exist as contiguous DOM text nodes in inline flow. The painter emits absolutely positioned per-run boxes with no line box, so there is nothing contiguous to build a `Range` over — adopting it would mean rewriting the painter into an inline-flow renderer, which is a layout change, not a selection change. It would also put DOM selection back in the loop, which the architecture forbids as a source of canonical state. |
| CSS Custom Highlight API | **Rejected for now.** Same blocker: `Highlight` takes `Range` objects, so it inherits the inline-flow requirement above. Support is also narrower than the supported matrix, so it would need the merged-rectangle path as a fallback regardless — carrying two presentations for no gain today. Worth revisiting if the painter ever moves to inline flow. |

## What was implemented

Adjacent rectangles that share a visual line are coalesced into one. Two details are
load-bearing:

- **Same line is decided by vertical OVERLAP, not equal tops.** Runs of different font
  sizes on one line differ in both `y` and `height`, so an equality test would refuse to
  merge exactly the mixed-formatting lines that show the worst gaps. The union keeps the
  taller run's extent.
- **A real gap stays a gap.** Rectangles are not joined across a distance wider than a
  space, so a tab, a right-aligned tail, or an empty cell remains visibly unselected. A
  selection must never claim to cover content it does not.

Transformed and clipped rectangles are excluded from merging, because a union would
misrepresent their geometry.

## Authority unchanged

ProseMirror remains the semantic selection owner; the engine remains hit-test and
geometry authority. Nothing about copy, focus, IME, or accessibility ownership changes —
the merge happens in `overlaysForFrame`, which is presentation, after geometry is derived.
No DOM selection is read as canonical state.

## Verification

Browser, comprehensive fixture, drag across formatting-run boundaries on one line:
**1 rectangle, 0 holes** (previously one rectangle per run with a hole at each boundary).

`packages/engine-editor/test/selection-merge.test.ts` — 6 pass:

| Assertion | Result |
| --- | --- |
| Adjacent run rects on one line become a single continuous rect | pass |
| Runs of different heights on one line still merge, union keeps the taller extent | pass |
| Separate lines are never merged | pass |
| A real gap (tab-width) stays a gap | pass |
| A single rect and an empty selection are unchanged | pass |
| Property: merging never loses horizontal coverage | pass |

## Not claimed

Wrapped-line, bidi, and cross-page selection inherit the same merge because it is keyed on
page plus vertical overlap, but they are asserted by the unit properties above rather than
by dedicated browser scenarios; a bidi visual discontinuity produces separate rectangles
that the gap rule correctly leaves separate. No feature-support claim is widened, and the
framework-neutral seam is the existing `overlaysForFrame`, which Vue already consumes —
no Vue work is done here (that is 10V.1).
