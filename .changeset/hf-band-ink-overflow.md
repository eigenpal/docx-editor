---
'@docx-editor.dev/core': patch
---

Header and footer ink now overflows its band like Word instead of being clipped: anchored shapes offset past the content width or below the header text stay visible, and negative indents hang into the margin. Overflowing shapes stay inert until the band is edited, so they never swallow clicks meant for the body.
