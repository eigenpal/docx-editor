---
'@docx-editor.dev/react': patch
---

Place the caret on the right letter in all-caps text. Runs with `w:caps` paint uppercase glyphs, but caret and click positions were measured from the lowercase source, so the caret drifted further left with every character and clicks landed an offset or two early.
