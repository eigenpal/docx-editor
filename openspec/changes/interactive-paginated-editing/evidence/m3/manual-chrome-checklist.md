# M3.2 manual Chrome checklist

Recorded: 2026-07-25. Chrome DevTools against the production React adapter.

**Server:** `bun run dev:react -- --port 5273 --strictPort`
**URL:** `http://localhost:5273/?realAdapter=1`
**Status line:** `Editable (paragraphs)`
**Fixture:** three body paragraphs, first is `Edit me: type into this paragraph.`

> **Port note.** The runbook says `http://127.0.0.1:5273`. Vite binds only to
> IPv6 `[::1]`, so `127.0.0.1` returns connection-refused and `localhost` is the
> address that works. The Playwright config already uses `localhost`. Either the
> runbook should say `localhost` or the dev script should add
> `--host 127.0.0.1`; recorded here rather than silently substituted.

## Checks

| # | Check | Result |
| --- | --- | --- |
| 1 | Click target is a real inked glyph, located by `[data-testid="one-surface-click-target"]` | Pass — text `Edit`, live rect 25×22 at client (552, 177) |
| 2 | Real click places the caret at the clicked position | Pass — clicking across the glyph at 5% / 40% / 75% / 98% resolved grapheme offsets 0, 1, 2, 4 |
| 3 | Click focuses the hidden input host | Pass — `document.activeElement` is the `ProseMirror` host, `contentEditable` true, frame `focus.focused` true |
| 4 | Caret is painted from engine geometry | Pass — `[data-testid="one-surface-caret"]` present; frame caret rect page-local (120.8, 96), client (576.8, 176.5) |
| 5 | Typing inserts at the caret and repaints pages | Pass — model revision 0 → 1, painted text became `EQdit me: …` |
| 6 | Backspace removes it and repaints | Pass — revision 1 → 2, painted text back to `Edit me: …` |
| 7 | Drag selects a range | Pass — anchor 0, head 4, `collapsed: false`, 4 highlight rects painted |
| 8 | Selection highlight is visible | Pass — `rgba(26, 115, 232, 0.3)` over the dragged text |
| 9 | Page sheet is visible | Pass — `rgb(255, 255, 255)` with `rgba(0,0,0,0.15) 0 1px 3px` shadow |
| 10 | Overlay layer is pointer-transparent | Pass — `pointer-events: none` on `.ep-one-surface__overlay` |
| 11 | Paint and engine geometry agree | Pass — measured page-local item x = 96, published item box x = 96 |
| 12 | A margin click is refused with a typed outcome | Pass — `invalidTarget`, "pointer is on page background or a page margin, which owns no caret position"; selection unchanged |

## Defects this pass found and fixed

1. **Host metrics measured the wrong element.** Metrics came from the scroll
   container, but the engine publishes page boxes from content (0, 0), so the
   client origin it needs is the page stack's. Every hit test was offset by the
   viewport padding.
2. **The 6.1 stylesheet centered pages inside a full-width stack**, leaving the
   stack origin 440px left of the page origin even after fix 1. The stack now
   hugs its pages (`width: max-content` + `margin-inline: auto`), which keeps the
   centered look with the stack origin on the page origin.
3. **`pointermove` reports `button: -1`**, and the bridge's primary-button filter
   rejected it, dropping every move in a drag.
4. **The click that concludes a drag collapsed the range** it had just selected.
5. **The surface was outside `.ep-root`**, the scope every `--doc-*` token is
   declared under, so caret, selection, and page background all painted
   transparent — invisible on a white page.
6. **`--doc-page-bg` and `--doc-caret` had no light-mode value**; both existed
   only in the dark block.

Defects 1, 2, 5, and 6 are invisible to unit tests by construction: they are
agreements between painted DOM and engine geometry, which is exactly what a
manual browser pass is for.

## Known gaps, not fixed here

- **Undo granularity.** A typing burst is not coalesced into one undo step; each
  keystroke undoes separately. Word coalesces. The interaction spec asserts a
  single character so it does not pin a policy this milestone has not specified.
- **Selection highlight has per-cluster gaps.** Rects are emitted per shaped
  cluster, so a multi-word selection shows hairline breaks between words rather
  than Word's continuous band. Cosmetic; the rects are correct.
- **Vue is not wired yet.** M3 is React-only by design; Vue is 6.3 / M5.
