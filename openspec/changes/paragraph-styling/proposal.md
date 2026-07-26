## Why

The engine can open a DOCX, edit it, and save it with every unowned byte intact.
It cannot render what that DOCX says. The model carries no paragraph formatting
to resolve, so layout has nothing to read and the display list is fed constants.

Verified at `checkpoint-054c427b`, not asserted:

- `engine-core/src/model/authored-model.ts` — `RunProps` is
  `{ styleId?, bold?, italic?, underline? }`. Four fields. There is no
  `ParagraphProps` type at all, and no section record: `grep -c sectPr` over the
  model is `0`.
- `engine-core/src/resolve/style-resolver.ts` — its own header says it "resolves
  bold/italic/underline; font/size/color/theme resolution and paragraph-property
  resolution are later increments".
- `engine-layout/src/paragraph-layout.ts` — reads nothing off props except
  `capsuleToggle(rPrCapsule, 'w:b' | 'w:i')`. No alignment, no indent, no
  spacing, no line spacing, no tab stops. `advanceRangeWidth` takes
  `{ bold, italic }` and nothing else.
- `engine-editor/src/display-bridge.ts` — emits `fontFamily: 'Helvetica'`,
  `fontSizePx: px(it.height) * 0.9`, `color: BLACK` as literals for every glyph
  in every document.
- `docx/read.ts:279-284` — the parser's own lossy detector lists `w:jc`,
  `w:spacing`, `w:ind` and `sectPr` among what it drops.

`StyleRecord` carries `runProps` only, so a Heading's size and spacing resolve to
nothing. `NumberingRecord` is `{ numId, abstractId }` — no levels, no formats, no
marker text, so list markers are unrenderable rather than unimplemented. Page
geometry comes from the caller: `layoutBody(model, { pageWidth, pageHeight,
margin, metrics })`, and the preview passes US Letter with a uniform 1in margin,
so every document renders as US Letter regardless of its `sectPr`.

This is the gate. Nothing downstream can be implemented around it: a shim onto any
richer layout model would have to re-parse the preservation capsules to invent
its own input. Metrics, shaping, pagination and paint are all blocked behind it.

Independent measurement this session shows the cost is already observable, not
theoretical. Comparing engine caret geometry against `Range.getClientRects()` on
a painted line:

- vertical error is a CONSTANT -2.5 px (engine line-box height 16, painted 16.5),
  which is the missing ascent/descent — a line box standing in for font metrics;
- horizontal error is localized and reaches 3.91 px, and disabling browser
  kerning and ligatures made it WORSE, 6.55 px. The 96-entry ASCII Helvetica
  table does not match the font even unkerned, so this is not an
  almost-right approximation awaiting shaping.

## What Changes

- Add `ParagraphProps` to the authored model, carrying the properties Word
  resolves for a paragraph: alignment, indentation (left/right/first-line/
  hanging), spacing (before/after/line, with rule), keep-with-next,
  keep-lines, widow control, page-break-before, outline level, tab stops, and
  paragraph-level shading and borders.
- Parse those from `w:pPr` into the authored record at the bounded trust
  boundary, and keep the byte-range preservation capsule authoritative for
  everything not modelled, so save stays lossless.
- Extend `StyleRecord` to carry paragraph properties, and extend the style
  resolver to the full cascade Word uses: docDefaults, style chain (with
  `w:basedOn`), numbering-derived properties, then direct formatting.
- Extend `RunProps` to the properties the display list already declares —
  font family, size, colour, underline kind, strike — so `GlyphRun` is fed
  resolved values rather than literals.
- Widen `MetricsPort` so an advance can be measured for a resolved run style,
  not just `{ bold, italic }`, and add baseline, ascent and descent so caret
  geometry derives from font metrics rather than the line box.
- Make layout read the resolved properties: alignment and indentation change the
  content box per line, spacing changes vertical advance, tab stops replace the
  fixed per-character tab advance, and page-break-before and keep rules
  participate in pagination.

## Non-Goals

- Shaping. This change makes a real `MetricsPort` measurable and leaves the
  harfbuzz/fontkit bake-off (roadmap 8.1) where it is. Neither package is
  installed.
- Sections, headers, footers, columns and page flow (8.5). Page geometry keeps
  coming from the caller here; making it come from `sectPr` is the next change
  and depends on this one landing first.
- Numbering levels and marker rendering. `NumberingRecord` grows only where the
  paragraph cascade needs it (indentation and outline level inherited from a
  numbering level); marker text and formats stay out.
- Tables, images and drawings.

## Sequencing

The cheapest experiment that decides the plan comes first, because its result
changes what the rest of this change is worth:

1. Extend the capsule parser for `w:rFonts`, `w:sz`, `w:color`, `w:jc` and
   `w:spacing` on paragraphs only, thread resolved run style through
   `advanceRangeWidth`, and feed a real font-metrics port.
2. Measure the result with the caret differential harness — engine caret
   geometry against `Range.getClientRects()` at several offsets and zoom levels.
   If the -2.5 px and 3.91 px errors collapse to sub-pixel, this engine reaches
   fidelity by growing. If the horizontal error stays structural, layout has to
   be transplanted, and the remaining tasks here are wasted.

Step 1 touches layout's core measurement loop, not only the parser and the port:
`advanceRangeWidth` is called once per code unit and its signature is
`{ bold, italic }`. That is a small change in a hot path that four independent
performance defects have already been found in, so it needs the existing
`layout-cost.test.ts` advance-call guard kept green.
