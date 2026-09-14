---
'@docx-editor.dev/core': minor
'@docx-editor.dev/fonts': major
---

Improve Word font and wrapping fidelity. Resolve document theme language defaults for Latin, East Asian, and complex-script slots. Keep automatic font loaders from shadowing installed families with substitute bytes. Preserve Word numeric ordering in RTL paragraphs, clear narrow passages beside floating tables, and use measured punctuation bearings when fitting narrow CJK lines.

Breaking font-loader change: `packagedFonts()` no longer registers substitute bytes under public font-family names by default, and `defaultFonts()` now only resolves bytes. Core registers private aliases for editor use. Call `packagedFonts({ install: true })` or the explicit installation helpers when page-wide registration is required. This prevents substitute Arial faces from hiding installed Arabic glyphs.
