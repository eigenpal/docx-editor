# Design — typed VML watermarks

Date: 2026-08-04. Change: `typed-vml-watermarks`.

## Context

Watermarks in real documents often appear as VML shapes inside header stories. The parent DrawingML lane (`typed-drawings-and-images`) owns DrawingML image watermarks and explicitly defers VML. Header/footer editing (`scoped-header-footer-editing`) owns scope and furniture but not watermark vocabulary.

This change is the **sole owner** of `w:pict`/VML watermark semantics.

## Decisions

### W1: VML is a separate vocabulary from DrawingML

VML shapes are typed under `w:pict`, preserved losslessly, and projected separately from `w:drawing`. A document may contain both; each lane owns its vocabulary.

### W2: Detection is conservative

A VML watermark is reported only when header/footer content matches explicit detection rules (behind-text placement, semi-transparent text or washed-out image, typical watermark positioning). Unmatched `w:pict` content remains preserved generic/typed structure without a watermark claim.

### W3: Paint respects behind-text ordering

VML watermarks paint behind body text on every page where the header resolves, without sizing the header box beyond story flow height (the rule from `scoped-header-footer-editing` and `typed-drawings-and-images`).

### W4: getWatermark fills honestly

`Editor.getWatermark()` returns structured watermark state for detected VML watermarks and `null`/empty when none is detected. It does not conflate DrawingML image watermarks — those are filled by `typed-drawings-and-images`.

## Ownership

| Topic | Owner |
| --- | --- |
| DrawingML pictures and DrawingML image watermarks | `typed-drawings-and-images` |
| VML watermarks (`w:pict`) | **this change** |
| Header/footer editing scope | `scoped-header-footer-editing` |
| Vue image authoring | `vue-drawing-authoring-parity` |

## Acceptance boundary

In scope: VML typing, detection, paint, `getWatermark()` for VML, D9 round-trip of VML watermark parts.

Out of scope: DrawingML anchors, inline/floating image layout, React/Vue image authoring, tracked drawing deletion.

## Owner

Drawings lane — VML sub-lane. Link from `scoped-header-footer-editing/design.md` points here as the sole VML watermark owner.
