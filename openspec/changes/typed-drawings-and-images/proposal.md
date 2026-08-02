## Why

`deferred-features.md` records drawings as: parse `generic preserved with bounded relationships`; model `untyped drawing/media references`; layout `deferred`; edit `deferred`. Its named future gate is "typed drawing model, embedded-resource validation, inline/floating positioning and wrap, image operations, and paired acceptance".

Layout being deferred means a `w:drawing` occupies no space and paints nothing. `comprehensive-word-element-test.docx` has eleven of them — ten inline, one floating — and the four PNGs behind them are in the package, related, and never seen. A user opening a document with a logo, a chart image, or a signature block sees the text reflowed around holes where the pictures were, with no indication that anything is missing.

Two chrome slots already name the intent: `image.insert` and `image.properties` are in `CHROME_GROUPS`. Both carry `state: { kind: 'parityOnly' }`, so the adapters short-circuit and render the localized `formattingBar.unavailableInPreview` — the "not wired to an editor command" path never runs for them. Enabling them needs the `state` to become `{ kind: 'command' }` **and** a `SLOT_COMMANDS` row. The `image` group is also `contextual: true`, so `defaultChromeGroups()` filters it out of the default bar entirely; that has to be addressed too, or the controls exist and never render.

This lane also carries the most security surface of the five. An image is a relationship to a binary part, and a `TargetMode="External"` relationship is a URL. Typing drawings is exactly when a zero-click fetch can be introduced.

## What Changes

**Typed drawing nodes**

- Add `drawing`, `inlineDrawing`, `anchoredDrawing`, and `picture` to the node-kind union in `packages/core/src/store/package/ooxml-tree.ts`.
- Type `CT_Inline` (`wp:extent`, `wp:effectExtent`, `wp:docPr`, `wp:cNvGraphicFramePr`, `@distT/@distB/@distL/@distR`) and `CT_Anchor` (the same plus `@simplePos`, `@relativeHeight`, `@behindDoc`, `@locked`, `@layoutInCell`, `@allowOverlap`, `wp:simplePos`, `wp:positionH`, `wp:positionV`, and the wrap element).
- Type the wrap vocabulary: `CT_WrapNone`, `CT_WrapSquare`, `CT_WrapTight`, `CT_WrapThrough`, `CT_WrapTopBottom`, with `ST_WrapText` (`bothSides` | `left` | `right` | `largest`) and the polygon on tight and through.
- Type positioning: `CT_PosH` / `CT_PosV` with `ST_RelFromH` and `ST_RelFromV`, and the `wp:align` / `wp:posOffset` choice.
- Type the picture payload: `CT_Picture` with `pic:nvPicPr`, `a:blip` (`r:embed` or `r:link`), `a:srcRect` (`CT_RelativeRect`, the crop), `a:stretch` / `a:tile`, `a:xfrm` (extent, rotation, `@flipH` / `@flipV`), and `a:prstGeom`.
- Alt text comes from `wp:docPr/@descr` and `@name`, and is preserved as authored.
- A `w:drawing` whose graphic is not a picture — a chart, a diagram, a group, a text box — stays typed as a drawing with a `generic` graphic payload. It reserves its declared extent and paints a placeholder rather than being silently absent.

**Layout**

- An inline drawing occupies its `wp:extent` in the line, participating in line breaking and baseline alignment, with `@distL` / `@distR` as horizontal spacing.
- An anchored drawing resolves `positionH` / `positionV` against its declared `ST_RelFromH` / `ST_RelFromV` frame, and its wrap mode produces exclusion zones the surrounding text flows around.
- Anchoring inside a table cell honours `@layoutInCell`; `@behindDoc` and `@relativeHeight` determine paint order; `@allowOverlap` governs whether two anchored objects may occupy the same space.
- The header/footer rule already in the codebase is preserved: an anchored object's extent **never** sizes a header or footer box. Flow height does.

**Media, resources, and security**

- Embedded media is decoded from the package part named by `r:embed`, validated against its declared content type, and bounded by size and dimension limits before allocation.
- `r:link` and any `TargetMode="External"` image relationship SHALL NOT be fetched. The relationship is preserved, the drawing reserves its extent, and a placeholder is painted with the reason. Loading a document performs no network request.
- Formats that browsers cannot decode natively — TIFF, EMF, WMF — reserve their extent and paint a placeholder rather than a broken image, until a converter lands in its own change.
- `a:hlinkClick` on a drawing is preserved and sanitized. Activation requires an explicit user gesture and an allowlisted scheme.

**Editing**

- `TreeDocOp` gains insert-image, replace-image, delete-image, resize-image, set-image-crop, set-image-alt-text, set-wrap-mode, and set-anchor-position. Insert adds the media part, its content-type override, and its relationship in the same transaction.
- Resize and crop write `wp:extent` and `a:srcRect`; they never re-encode the media.

**React adapter**

- Wire `image.insert` and `image.properties` in `SLOT_COMMANDS`.
- Selection handles for resize, a drag affordance for an anchored image, a wrap-mode menu, and a properties dialog with size, crop, alt text, and position.

## Capabilities

### New Capabilities

- `drawing-model`: typed inline and anchored drawings, the picture payload, media resolution, resource validation, and the no-zero-click-fetch rule.
- `drawing-layout`: inline participation in line breaking, anchored positioning, wrap exclusion zones, z-order, and the header/footer sizing rule.
- `image-authoring-surface`: chrome slots, selection handles, wrap menu, properties dialog, and alt-text authoring.

### Modified Capabilities

- `core-image-commit` (`openspec/specs/core-image-commit/spec.md`) specifies image resize and drag as ProseMirror commit builders from the previous architecture, where PM transactions were the write path. It is superseded by the `TreeDocOp` operations here. `tasks.md` §8 requires it be archived or rewritten rather than left standing.

## Fixture evidence

Measured from `e2e/fixtures/comprehensive-word-element-test.docx`. Eleven `w:drawing` elements, four PNG parts.

Exercised:

| Feature | Evidence |
| --- | --- |
| Inline drawings | 10, extents from 152400×152400 EMU (0.17") to 2857500×762000 EMU (3.125"×0.83") |
| Anchored drawing | 1, `wrapSquare`, `@behindDoc="0"`, `@allowOverlap="1"`, `@layoutInCell="1"`, `@relativeHeight="952500"` |
| Anchor positioning | `positionH relativeFrom="margin"` with `wp:align`=right; `positionV relativeFrom="paragraph"` with `wp:posOffset`=0 |
| Distance insets | `@distL="114300"` on the anchor |
| Alt text | all 11 carry `wp:docPr/@name` and `@descr` |
| Effect extent and geometry | 11 `wp:effectExtent`, 11 `a:prstGeom` |
| Embedded media | `r:embed` to four PNGs |
| Reuse | `rId14`, `rId15`, `rId16` referenced by three drawings each; `rId17` by two |

Not exercised:

- Every `a:srcRect` in the file is `<a:srcRect/>` — **empty**. This one is a genuine repository-wide gap: no fixture anywhere carries a non-empty `a:srcRect`, so cropping has no coverage at all.
- `r:link` and external-mode image relationships — none here. Coverage does exist elsewhere: `list-pagination-break.docx` carries **27** image relationships with `TargetMode="External"`. An earlier draft claimed the repository had none, which was wrong; the security rule is testable today.
- Wrap modes other than `wrapSquare` — none here, but `float-wrap-comprehensive-test.docx`, `image-layout-modes-demo.docx`, `issue-705-anchored-header-letterhead.docx`, and `demo.docx` cover `wrapTight`, `wrapThrough`, and `wrapTopAndBottom`.
- `@behindDoc="1"` — nothing behind text.
- Rotation, `@flipH` / `@flipV`, `a:ln` borders, `a:effectLst`, `a:tile`.
- Non-PNG media: no JPEG, GIF, SVG, TIFF, EMF, or WMF.
- Non-picture graphics: no chart, SmartArt, group, canvas, or text box.
- `a:hlinkClick` on a drawing.
- Drawings inside a header, footer, note, or comment.
- Anchored objects overlapping each other, which is what `@allowOverlap` and `@relativeHeight` exist to arbitrate.

The fixture proves inline layout and a single anchored square wrap. It proves nothing about cropping, external references, z-order, or format breadth.

## Impact

- `packages/core/src/store/package/ooxml-tree.ts` — typed drawing kinds and payloads.
- `packages/core/src/store/package/relationships.ts`, `safe-record.ts`, `sinks.ts` — media resolution under the existing safe-target rules, and the external-relationship refusal.
- `packages/core/src/store/runtime/limits.ts` — size and dimension bounds before allocation.
- `packages/core/src/layout/` — inline extent in line breaking; a new anchored-object and exclusion-zone pass; z-order in `semantic-records.ts`.
- `packages/core/src/layout/hf-layout.ts` — unchanged, and its rule that flow height sizes the box is asserted against a header containing an anchored object.
- `packages/core/src/output/semantic-paint.ts` — image painting, placeholders, and paint order.
- `packages/core/src/store/store/tree-ops.ts` and siblings — image operations and media-part lifecycle.
- `packages/core/src/editor/chrome-controls.ts`, `toolbar-commands.ts` — wire two declared slots.
- `packages/react/src` — handles, wrap menu, properties dialog, i18n.
- **Vue**: out of scope by request; no production support claim follows from this change alone.
- **Not included**: a TIFF/EMF/WMF converter, charts and SmartArt, text boxes and groups, and `a:effectLst` rendering. Each reserves its extent and paints a placeholder, which is honest and is not support.
