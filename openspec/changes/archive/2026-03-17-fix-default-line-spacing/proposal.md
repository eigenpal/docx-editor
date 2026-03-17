## Why

When a DOCX file has no explicit `w:line` spacing attribute anywhere (not in paragraphs, styles, or docDefaults), our layout engine defaults to 1.15× (276/240) line spacing. The OOXML spec (§17.3.1.33) defines the default as `line=240` (1.0× = single spacing). This causes every line to be ~15% taller than correct, accumulating to 60-80px of extra height per page, pushing content to overflow onto subsequent pages when it should fit on one.

Discovered when comparing our rendering of a third-party DOCX against the original application's rendering — our table overflows to page 2 while it fits entirely on page 1 in the reference rendering.

## What Changes

- Change the fallback line spacing multiplier from 1.15 to 1.0 in `measureParagraph.ts` when no line spacing is specified
- Change the corresponding fallback in `measureContainer.ts` (`DEFAULT_LINE_HEIGHT_MULTIPLIER`)
- Update `renderParagraph.ts` visible rendering to use the same 1.0 default for consistency
- Update `formatToStyle.ts` (PM hidden view) to align defaults

Documents that explicitly specify `line=276` (most Word-created documents) are unaffected — their value flows through the multiplier code path, not the fallback.

## Capabilities

### New Capabilities

- `ooxml-default-line-spacing`: Correct OOXML default line spacing behavior when no `w:line` is specified

### Modified Capabilities

## Impact

- `packages/core/src/layout-bridge/measuring/measureParagraph.ts` — fallback line height calculation
- `packages/core/src/layout-bridge/measuring/measureContainer.ts` — `DEFAULT_LINE_HEIGHT_MULTIPLIER` constant
- `packages/core/src/layout-painter/renderParagraph.ts` — visible page rendering line height default
- `packages/core/src/prosemirror/extensions/core/ParagraphExtension.ts` — PM toDOM line height
- Documents without explicit line spacing will render more compactly (correct behavior)
- Existing tests may need line height expectations updated
