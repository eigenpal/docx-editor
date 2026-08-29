---
'@docx-editor.dev/core': minor
---

CJK text now measures and paints in the `eastAsia` font the document names (`w:rFonts w:eastAsia` / `w:eastAsiaTheme`, including through `w:docDefaults` and the theme's `a:ea` typefaces) instead of the run's Latin face. `ResolvedRunStyle` gains `fontFamilyEastAsia`, and `StyleSpanRecord` gains `fontSlot`; the format painter copies the East Asian face into `w:eastAsia`, and the font catalog lists the theme's East Asian faces.
