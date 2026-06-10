---
'@eigenpal/docx-editor-core': patch
---

Fix the text caret being as tall as the largest font on a line. The caret now matches the font size at the insertion point (like Word) instead of the whole line box, so clicking into small text on a line that also has large text shows a correctly-sized caret. Affects React and Vue. Fixes #748.
