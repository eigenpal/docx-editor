---
'@eigenpal/docx-js-editor': patch
---

Fix font reset on save when a paragraph style explicitly sets `<w:rFonts ascii="Arial">` while document defaults supply a paired `asciiTheme="minorHAnsi"`. The OOXML render layer treats the theme attribute as overriding the explicit name, so a stale `asciiTheme` from `docDefaults` was silently turning Arial headings into Calibri. The font merge now treats explicit/theme attribute pairs as a unit per ECMA-376 §17.3.2.27. Fixes #387.
