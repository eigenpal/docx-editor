# Word-style structural revision indicators

## Goal

Render tracked structural changes with the same visual vocabulary as Word:

- a narrow change bar in the page margin aligned to the changed content;
- a colored paragraph mark (`¶`) for inserted or deleted paragraph boundaries;
- one continuous bar for a whole-table change, or row-aligned bars for individual row changes;
- a page-margin bar aligned to a changed image, including floating images;
- green for insertions and red for deletions.

The indicators are review UI only. They must not affect document measurement, pagination, table geometry, image positioning, selection mapping, or OOXML round-trip data.

## Existing model

The painter already receives revision metadata for paragraph marks, table rows/cells, whole-table revision bursts, and inline images. It emits stable revision classes and `data-revision-*` attributes. Paragraph-mark glyphs are already placed inline inside the final painted line.

The React stylesheet bundle does not currently include the structural-revision rules stored in `prosemirror/editor.css`, so the emitted paragraph/table classes have no visible margin bar. Inline images use painter-applied outlines, while floating image extraction drops revision metadata.

## Design

### Shared revision tokens and styles

Move painter-facing revision styles into `packages/core/src/styles/editor.css`, the stylesheet imported by both adapters. Define shared insertion and deletion color tokens there and use them for all indicators. Keep hidden-ProseMirror-only rules in `prosemirror/editor.css`.

Painter elements continue to expose semantic classes rather than framework-specific markup:

- insertion: `ep-revision-ins` / `layout-revision-ins`;
- deletion: `ep-revision-del` / `layout-revision-del`;
- structural scope: paragraph mark, table, row, cell, or image.

### Paragraph boundaries

Each painted fragment of a paragraph carrying `pPrIns` or `pPrDel` registers its vertical span with the page-level revision-bar layer so a split paragraph remains marked on every page. Only the final fragment displays the `¶` glyph because the tracked paragraph mark belongs to the paragraph terminator.

Inserted boundaries use a green bar and green `¶`. Deleted boundaries use a red bar and red struck-through `¶`.

### Tables

A whole-table insertion or deletion registers one continuous margin span covering the visible table fragment. A partial change registers row-aligned spans. Tracked cells retain their existing local border/tint cue, but do not create duplicate page-margin bars.

Split tables repeat the appropriate bar on every visible page fragment while respecting table clipping.

### Images

Revision metadata must survive every image paint path: inline, block, floating, body, table cell, header, and footer. A changed image registers its visible vertical bounds with the containing page/header/footer revision-bar layer. Existing green/red outlines remain as the local object cue Word uses to associate the revision with the picture.

Floating-image records will carry insertion/deletion identity, author, date, and revision ID from their source `ImageRun`. The floating-image layer will emit the same semantic revision attributes as inline image painting.

### Other revision-bearing blocks

Any painter block that already exposes insertion/deletion metadata should use the shared indicator helper and tokens. Types without revision metadata are outside this change; the implementation must not infer a revision from unrelated formatting or comments.

## Architecture

Add a small painter utility that applies revision classes and `data-revision-*` attributes without setting geometry. Paragraph and table painters retain their existing ownership of revision semantics. Image painters use the utility after preserving metadata through floating-image extraction.

Each body, header, and footer paint pass owns a `RevisionBarCollector`. Renderers register `{ top, height, kind, revisionId }` spans in that container's coordinates. After content painting, the collector merges touching or overlapping spans that belong to the same revision and kind, then appends a dedicated non-interactive overlay. Every resulting two-pixel bar uses one fixed horizontal position just left of that container's content edge, independent of paragraph indent, table indent, or image anchor position.

The bar overlay is outside measured flow, has `pointer-events: none`, and does not participate in selection mapping. Existing per-element pseudo bars are removed from the painter path to prevent duplicate or object-relative markers. Hidden ProseMirror cues remain separate because that off-screen tree is not the visible renderer.

## Testing

- Extend structural tracked-change browser tests to assert the computed insertion/deletion bar color and the inline `¶` color/strike-through.
- Assert paragraph, whole-table, individual-row, and image bars share one fixed page-margin X coordinate while spanning the corresponding painted bounds.
- Extend image tests for inline and floating insertions/deletions, including unchanged image geometry.
- Run React coverage through the normal demo stylesheet and retain Vue parity through the shared core stylesheet.
- Run typecheck, adapter CSS thinness, focused structural tracked-change tests, tracked-image tests, and the supplied DOCX regression.

## Non-goals

- Changing tracked-change acceptance/rejection semantics.
- Adding revision metadata to OOXML object types that the parser does not currently model.
- Changing pagination or the deleted-section-break layout fix.
- Recreating Word balloons or reviewer-specific color assignment.
