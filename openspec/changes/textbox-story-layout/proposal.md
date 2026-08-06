# Textbox Story Layout

## Why

Documents that put their page numbers, letterheads, or callouts inside floating
text boxes currently render nothing where that content should be: the drawing
projection rejects `wps:txbx` payloads, and when the drawing is wrapped in
`mc:AlternateContent` (as Word always emits for `wps` shapes) the whole drawing
becomes invisible rather than a placeholder. A common real-world footer pattern —
`PAGE` / `NUMPAGES` fields inside an anchored text box — produces an empty
footer today even though the field evaluator itself already works.

## What Changes

- Text-box drawings (`wps:wsp` carrying `wps:txbx` → `w:txbxContent`) become a
  third drawing payload beside pictures and vector shapes: the projection
  captures the story root and `wps:bodyPr` (insets, vertical anchor) instead of
  returning null.
- MC-wrapped text boxes stop being invisible: a drawing with a textbox story is
  a renderable projection, not a dropped one.
- A node-scoped textbox story layout flows the `w:txbxContent` blocks at the
  drawing's extent width, clipped at extent height, with `PAGE` / `NUMPAGES` /
  `SECTIONPAGES` fields evaluated per page through the existing field-projection
  machinery — never from Word's cached result text.
- Laid-out textbox stories paint as clipped, absolutely positioned containers at
  the drawing's resolved anchor position (page-relative anchors included),
  reusing the existing fragment painter. Solid fill and outline on the hosting
  shape paint behind the text.
- Applies to anchored textbox drawings in body, header, and footer stories.
  Content is read-only: painted as page furniture, excluded from selection and
  editing.
- Out of scope (future changes): inline (`wp:inline`) textboxes, editing and
  selection inside textbox stories, linked textbox chains (`wps:linkedTxbx`),
  `spAutoFit` height growth, rotation and flips, WordArt, group shapes, and
  charts/diagrams (which keep their placeholder behaviour).

## Capabilities

### New Capabilities

- `textbox-story-rendering`: projection, bounded layout, per-page field
  evaluation, and paint of `w:txbxContent` stories inside text-box drawings.

### Modified Capabilities

- `drawing-model` (delta on the `typed-drawings-and-images` spec): the
  requirement pinning text boxes to extent-reserving placeholders is narrowed to
  charts, diagrams, and groups; a text box becomes a typed drawing with a
  textbox-story payload.

## Impact

- `packages/core/src/store/package/drawing-projection.ts` — third payload arm,
  MC invisibility guard admits textbox stories, new nesting cap, freeze branch.
- `packages/core/src/layout/` — new textbox story layout module (shaped like the
  note-story layout); `AnchoredDrawingRecord`/`InlineDrawingRecord` gain story
  fragments; header/footer and body per-page variant caching already handle
  drawings and page fields and need no new mechanism.
- `packages/core/src/output/semantic-paint*.ts` — clipped story container in the
  drawing layers, painted through the existing fragment painter.
- Tests pinning current behaviour flip: MC-wrapped textbox → zero projections,
  and the non-picture fixture oracle marking the text box as an
  `unsupported-graphic` placeholder.
- Save path, digest oracles, and the tree store are untouched: the story is laid
  out from the canonical tree and never mutated, and the digest already treats
  textbox content as generic run structure.
- No public API changes; no adapter changes.
