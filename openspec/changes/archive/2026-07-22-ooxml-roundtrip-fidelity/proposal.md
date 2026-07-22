# OOXML Roundtrip Fidelity

## Problem

Several data integrity issues corrupt documents during the import-edit-export cycle:

1. **Highlight export uses invalid OOXML** — custom highlight colors exported as `<w:highlight w:fill="FFEB3B">` which is invalid. `<w:highlight>` only accepts predefined color names (yellow, green, cyan, etc.). Custom colors must use `<w:shd>` (run shading). Word silently ignores the invalid element, so highlights disappear.

2. **Theme color resolution corrupts text colors** — text using theme colors (e.g., `w:themeColor="dark1"` which resolves to black) can export as the wrong color (e.g., white) after roundtrip, especially in table headers.

3. **Font family not preserved** — East Asian fonts like DengXian export as Arial. The `w:rFonts` element has separate attributes for ASCII, HAnsi, East Asian, and Complex Script fonts. If only one is read/written, the others are lost.

4. **Footer field codes rendered as text** — complex field codes like `{NUMPAGES}` or `{PAGE}` in footers export as literal text (e.g., "[dssppace]") instead of preserving the field structure.

5. **Duplicate image IDs cause rendering failure** — documents from template engines may have `<pic:cNvPr id="0">` on all images. If deduplication uses this ID, only the last image renders. Non-standard relationship IDs (e.g., `img2073076884` instead of `rId1`) also cause issues.

6. **`w:view` setting lost** — the `<w:view>` element in `word/settings.xml` (print/web/outline mode) is not preserved during roundtrip.

## Scope

- Fix highlight serialization for custom colors
- Fix theme color roundtrip (preserve original theme attributes)
- Fix font family preservation for all font categories
- Fix field code serialization in headers/footers
- Handle duplicate `pic:cNvPr` IDs gracefully
- Preserve `w:view` in settings.xml

## Out of scope

- New highlight UI features
- Font fallback rendering
