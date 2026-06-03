---
'@eigenpal/docx-editor-core': patch
---

Stop dropping several properties on headless roundtrip. Table row-level conditional formatting (`w:trPr/w:cnfStyle`, e.g. header-row/banding context) is now serialized, matching the cell path. Explicit "off" formatting overrides also survive: a run or paragraph that cancels a style value (`<w:strike w:val="0"/>`, `<w:keepNext w:val="0"/>`, and similar for doubleStrike, smallCaps, allCaps, outline, shadow, emboss, imprint, vanish, rtl, cs, keepLines, contextualSpacing, pageBreakBefore, suppressLineNumbers, suppressAutoHyphens, bidi) previously serialized to nothing and silently re-inherited the style value.
