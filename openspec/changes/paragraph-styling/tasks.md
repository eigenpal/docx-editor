# Tasks

## 0. Decide whether the engine grows or layout is transplanted

- [ ] 0.1 Extend the capsule parser for `w:rFonts`, `w:sz`, `w:color` on runs and
      `w:jc`, `w:spacing` on paragraphs. Parse only; no resolution yet.
- [ ] 0.2 Thread a resolved run style through `advanceRangeWidth` and
      `runStyleAt`, replacing `{ bold, italic }`. Keep
      `layout-cost.test.ts`'s advance-call guard green — it counts
      `metrics.advance` calls specifically because an earlier guard counted
      segmented characters and read as coverage while `advance` ran 4,003x per
      character.
- [ ] 0.3 Feed a real font-metrics port for one document.
- [ ] 0.4 Measure with the caret differential: engine caret geometry against
      `Range.getClientRects()` at several offsets and at 1x/1.5x/2x zoom. Record
      horizontal error by offset and vertical error and height delta.
- [ ] 0.5 DECISION GATE. Sub-pixel errors mean this engine reaches fidelity by
      growing and tasks 1-4 are worth doing. A structural horizontal error means
      layout is transplanted and tasks 1-4 are not. Record the numbers either
      way; do not proceed on expectation.

## 1. Model and parse

- [ ] 1.1 Add `ParagraphProps` to the authored model with absent-vs-zero
      semantics, and a `ParagraphRecord.props` field.
- [ ] 1.2 Parse `w:pPr` into it at the bounded trust boundary. Cap recursion and
      element counts; never feed a file-supplied number into an allocation or a
      loop bound.
- [ ] 1.3 Prove losslessness: for each fixture, save without editing is
      byte-identical, and save after editing one paragraph preserves every
      unmodelled property of that paragraph.
- [ ] 1.4 Extend `StyleRecord` to carry paragraph properties.
- [ ] 1.5 Extend `RunProps` with font family, size, colour, underline kind and
      strike, keeping the capsule authoritative for the rest.

## 2. Resolve

- [ ] 2.1 Implement the cascade: docDefaults, style chain via `w:basedOn`,
      numbering-derived, direct.
- [ ] 2.2 Detect `w:basedOn` cycles and resolve without unbounded recursion.
- [ ] 2.3 Extend the resolved-cache dependency keys so a style edit invalidates
      exactly the paragraphs that read it. The dependency registry already
      exists; a missed key here surfaces as stale layout rather than a
      registration error, which is the failure mode independent review named.

## 3. Layout

- [ ] 3.1 Content box per line from indentation, including first-line and
      hanging.
- [ ] 3.2 Alignment: left, right, centre, and justify as a separate task since
      it changes inter-word advance.
- [ ] 3.3 Vertical advance from spacing before/after/line with rule.
- [ ] 3.4 Tab stops replace the fixed per-character tab advance. Note the
      current fixed advance is why a tab had to become its own paint run;
      revisit that split once stops land.
- [ ] 3.5 `page-break-before`, `keep-with-next`, `keep-lines` and widow control
      in pagination.

## 4. Paint and caret

- [ ] 4.1 Emit resolved family, size, colour, underline and strike on
      `GlyphRun`; delete the literals in the display bridge.
- [ ] 4.2 Derive caret Y and height from ascent and descent. This alone should
      close the constant -2.5 px vertical error already measured.
- [ ] 4.3 Re-run the caret differential and record the residual. Do not disable
      browser kerning or ligatures to close a gap: measured, that made the
      horizontal error worse (3.91 px to 6.55 px), because the static advance
      table does not match the font even unkerned.

## Gates

- [ ] Every fixture round-trips byte-identically without an edit, and preserves
      unmodelled properties across an edit.
- [ ] Wrapping, page count and visible text are unchanged for documents whose
      resolved properties are all defaults.
- [ ] The advance-call guard stays green; measurement stays linear.
- [ ] No hardcoded font family, size-from-height, or colour remains in the
      display bridge.
- [ ] The caret differential is recorded before and after, with horizontal error
      by offset and vertical error and height delta.
