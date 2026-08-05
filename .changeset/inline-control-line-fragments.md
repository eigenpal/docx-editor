---
'@docx-editor.dev/react': patch
---

Inline content controls now publish one boundary rectangle per line at the text's actual vertical extent. A control that wraps across lines no longer paints a single union chip covering neighboring words, and under non-single line spacing the chip sits on the text instead of the leading above it, so clicks land where the highlight is.
