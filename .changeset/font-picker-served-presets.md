---
'@docx-editor.dev/core': minor
---

The font picker lists a standard font that no font source serves only when the computer has it installed, and `packagedFonts()` serves Helvetica with the Liberation Sans faces of Arial. `PackagedFontsFragment.supportedFamilies` is now typed as `readonly string[]`, because it can list aliases such as Helvetica.
