# Design: OOXML Roundtrip Fidelity

## Highlight serialization

**Rule:** If highlight color is one of the 17 predefined OOXML colors (`yellow`, `green`, `cyan`, `magenta`, `red`, `blue`, `darkBlue`, `darkCyan`, `darkGreen`, `darkMagenta`, `darkRed`, `darkYellow`, `lightGray`, `darkGray`, `black`, `white`, `none`), use `<w:highlight w:val="colorName"/>`. For any other color, use `<w:shd w:val="clear" w:color="auto" w:fill="RRGGBB"/>`.

Check: `src/docx/serializer/` — run properties serialization.

## Theme color preservation

When a run has theme color attributes (`w:themeColor`, `w:themeTint`, `w:themeShade`), these must be preserved through the roundtrip alongside the resolved `w:val` color. The resolved color should be recalculated from theme on import but the theme attributes must be written back on export.

Check: `src/docx/serializer/` and `src/prosemirror/conversion/fromProseDoc.ts`.

## Font family preservation

`w:rFonts` has four attributes: `w:ascii`, `w:hAnsi`, `w:eastAsia`, `w:cs`. All four must be parsed, stored in run properties, and serialized back. Currently may only preserve one.

Check: `src/docx/paragraphParser.ts` (parsing), `src/types/formatting.ts` (storage), serializer (output).

## Field code serialization

Complex fields (`w:fldChar` begin/separate/end with `w:instrText`) must roundtrip as field structures, not as plain text. The serializer must reconstruct the field XML from the stored field data.

Check: `src/docx/serializer/` — how fields in headers/footers are written.

## Duplicate image IDs

Parser should not deduplicate images by `pic:cNvPr` ID. Use the relationship ID (`r:embed`) as the unique key for resolving image data. Accept non-standard relationship ID formats.

Check: `src/docx/` image/drawing parser.

## w:view preservation

Parse `<w:view w:val="..."/>` from `word/settings.xml` on import, store in document model, write back on export.

## Key files

| File                          | Change                                            |
| ----------------------------- | ------------------------------------------------- |
| `src/docx/serializer/`        | Highlight, theme color, font, field serialization |
| `src/docx/paragraphParser.ts` | Font family parsing (all 4 categories)            |
| `src/docx/drawingParser.ts`   | Image ID handling                                 |
| `src/types/formatting.ts`     | Font family type (4 categories)                   |
| `src/docx/settingsParser.ts`  | w:view parsing                                    |
