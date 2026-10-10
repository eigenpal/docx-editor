## Why

The display scale is a number nobody recomputes. `createDocxEditor` opens at 100% and stays there, so a Letter page — 816 CSS pixels — overflows any container narrower than that, and the reader gets a horizontal scrollbar instead of a document. Nothing reacts to a resized window, and nothing reacts to chrome taking the width away.

That second half is the sharper problem, because the editor does it to itself. Opening the review pane puts `padding-right: 316px` on the scroll container. On a 1100px viewport that leaves 784px for an 816px page: the document does not shrink to make room for the comments, it just stops fitting.

There is a width where fitting stops being the answer. On a 420px viewport the rail takes 316px, and a page fitted into what is left is unreadable. That case wants the scrollbar — so the fit is bounded, and past the bound the page keeps a legible size and the container scrolls. Fitting is worth doing exactly as far as it produces something better than scrolling.

The pieces to fix it already exist and are already in the right places. Zoom is engine-owned precisely so the toolbar's percentage, the scale the surface paints at, and the factor hit testing divides by cannot disagree. `Editor.getPageGeometry()` reports the page at 100% in the same CSS pixels a fit needs. And the room beside the page is not something to be modelled at all — it is the scroll container's content box, which every piece of chrome already reduces with padding. What is missing is a mode that says "recompute", something to watch, and a floor that knows when fitting has stopped helping.

## What Changes

**A fit the engine owns (core)**

- `ZoomMode` in `contracts/editor.ts`: `{ type: 'fixed' }` or `{ type: 'fit', fit: 'pageWidth', minZoom?, maxZoom? }`. One fit target today; the union shape leaves Word's other two (whole page, text width) additive.
- `Editor.getZoomMode()` / `setZoomMode(mode | 'auto')`, beside the existing `getZoom`/`setZoom`. `EditorSnapshot.zoomMode` carries it, optional and additive like `pageSetup`, because a zoom control has to render its tick from the MODE — one that ticked the level matching the percentage would light up "75%" while the editor was tracking the viewport and about to move off it.
- **`'auto'` is the new default**: fit the page width, between 50% and 100%. A container with room for the sheet renders exactly as it does today; a narrower one shrinks. The FLOOR is the other half of the rule: below it the page keeps a legible size and the container scrolls sideways, because fitting a page into the sliver an open comments rail leaves on a phone produces a document nobody can read to avoid a scrollbar nobody minds. An editor given a `zoom` and no `zoomMode` stays fixed at that value, so an embedder that pinned a scale keeps it.
- `editor/zoom-fit.ts` — the arithmetic, DOM-free. Quantized DOWN to whole percent (rounding up paints a page wider than the box it was fitted to; whole percent keeps a scrollbar's fractional pixel from re-laying out the document), clamped rather than refused (a derived value has no caller to tell), and `null` rather than a guess on an unmeasured viewport.
- `editor/zoom-controller.ts` — a `ResizeObserver` on the scroll container, coalesced to one frame, measuring `clientWidth` less both physical paddings. That measurement is the whole mechanism behind "opening comments shrinks the document": the review gutter IS padding on that element, so the observer fires and the next fit is simply smaller. Nothing had to be told.
- `editor/docx-editor-zoom.ts` — the lane that holds the scale and the mode and applies both down ONE path, so a refit and a toolbar click are indistinguishable downstream. A fit that only wrote the variable would leave every host that listens rather than polls showing the old percentage.
- `setZoom` now leaves a fit mode, and does so even when the number equals the one the fit had landed on: picking "100%" while auto happened to read 100% used to do nothing, and the next resize moved the page again.
- `scrollbar-gutter: stable` on the scroll container. Load-bearing, not cosmetic: without it, fitting far enough to remove the vertical scrollbar widens the content box, which fits larger, which brings the scrollbar back.

**The zoom lifecycle, as an API (React)**

- `useZoom()` → `{ zoom, mode, isFit, setZoom, setMode, fitToWidth, auto, reset, zoomIn, zoomOut, canZoomIn, canZoomOut, levels }`. No zoom state in React; every member reads the engine or calls into it.
- `zoomMode` on `DocxEditor.Root` and on the `<DocxEditor>` sugar. Applied in one effect with `zoom`, mode after level, so a host passing both does not get whichever effect ran last.
- The toolbar's zoom menu gains Automatic and Fit width above the percentages, ticked from the mode.

## Impact

- **Behaviour, for every host that does not pass `zoom`**: a container narrower than a page + gutters now renders the document smaller, down to 50%, instead of overflowing immediately. Wide containers are unchanged, and past the floor the overflow is back. `{ type: 'fixed' }` restores the old behaviour exactly.
- **Contract**: two new `Editor` members and one optional snapshot field, all additive. `EditorSnapshot.zoomMode` is added to `snapshotsEqual`, which every snapshot member must be.
- **Vue**: gets the fit itself for free — it runs in the engine and `'auto'` is the constructor default — and can change the mode through the facade. The `zoomMode` PROP is deferred with the rest of the Vue prop surface.
- **Review pane**: unchanged. It reserves its gutter exactly as before at every width.
- **Not in scope**: the `fullPage` and `textWidth` fit targets, and a Vue twin of `useZoom`.
