---
'@eigenpal/docx-js-editor': minor
---

Image layout modes (Word-style): right-click image menu and toolbar dropdown now share five directional options (In Line with Text · Square Left · Square Right · Behind Text · In Front of Text) plus Cut/Copy/Paste/Delete. Inline ↔ anchor transitions promote inline images to anchored floats at the same rendered position (Word's behavior) and back, with full OOXML round-trip. Layout helpers (`pointerHitResolveImage`, `captureInlinePositionEmu`, `deriveLayoutChoice`, `IMAGE_LAYOUT_OPTIONS`, `toolbarValueToLayoutTarget`) are exported from `@eigenpal/docx-core/layout-painter` so framework adapters share them.
