---
'@eigenpal/docx-js-editor': patch
---

Serialize all integer-typed OOXML attributes (EMU and twips) as integers. Floating-point drift from arithmetic like `inches * 1440` (e.g. `0.7 * 1440 === 1008.0000000000001`) or `(px / 96) * 914400` (e.g. `cy="495299.99999999994"`) caused saved files to fail to open in Microsoft Word, even though tolerant readers accepted them. (fixes #417)

Behavior changes for callers:

- `pixelsToEmu`, `twipsToEmu`, and `emuToTwips` now round their result to the nearest integer. Previously they could return values like `495299.99999999994`.
- `createEmptyDocument` rounds `pageWidth`, `pageHeight`, and all `margin*` options to integer twips at the API boundary.
- `InsertImageCommand` (`agent.insertImage`) now correctly converts `width` / `height` from pixels to EMU. Previously it multiplied pixels by 914400 instead of 9525, producing images 96× the requested size (a 100 px image became a 96-inch image). Default 100 px now produces a ~1.04-inch image, matching the documented behavior.

Defensive: every integer-typed XML attribute in the document, paragraph, table, and run serializers now coerces its value to an integer at write time, so fractional values reaching the serializer through any code path can no longer corrupt the saved file.
