## Why

Word writes many watermarks as VML (`w:pict`) shapes in headers, not as DrawingML anchors. `typed-drawings-and-images` owns DrawingML image watermark rendering (`a:lum`, `a:grayscl`, behind-text layering) and fills `Editor.getWatermark()` when the watermark is a supported DrawingML image.

VML watermarks remain unowned. `scoped-header-footer-editing` and `typed-drawings-and-images` each deferred them; `word-fidelity-review-findings.md` §3 records watermarks as nobody's. Meanwhile `Editor.getWatermark()` already ships as an honest-empty stub and `watermark-confidential.docx` exists in the fixture corpus.

This change is the sole owner of VML watermark vocabulary, detection, paint, editing semantics, and the remaining `Editor.getWatermark()` cases.

## What Changes

**VML watermark model**

- Type `w:pict` and the VML shape/image vocabulary needed for watermark detection and round-trip preservation.
- Detect header/footer VML watermarks (text and image) with explicit diagnostics for unsupported variants.
- Paint VML image watermarks with behind-text layering and washed-out appearance matching Word where the VML attributes map cleanly.

**Read surface**

- Implement `Editor.getWatermark()` for VML-detected watermarks with honest-empty behaviour when none is present.

**Explicit deferrals retained**

- DrawingML image watermarks remain owned by `typed-drawings-and-images`.
- Header/footer scope and furniture editing remain owned by `scoped-header-footer-editing`.

## Capabilities

### New Capabilities

- `vml-watermark-model`: VML watermark typing, detection, paint, read surface, and round-trip preservation.

### Modified Capabilities

None.

## Impact

- `packages/core/src/store/package/ooxml-tree.ts` — VML typing under `w:pict`.
- `packages/core/src/layout/` — watermark detection and behind-text paint ordering for VML shapes.
- `packages/core/src/editor/docx-editor.ts` — `getWatermark()` implementation for VML cases.

## Acceptance boundary

- DrawingML image watermarks: `typed-drawings-and-images`.
- VML text/image watermarks in headers: this change.
- Header/footer editing scope: `scoped-header-footer-editing`.

## Owner

Drawings/watermarks lane (VML sub-lane). Does not include Vue authoring (`vue-drawing-authoring-parity`) or DrawingML pictures (`typed-drawings-and-images`).
