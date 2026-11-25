---
'@docx-editor.dev/core': patch
---

The text before a field and the field result now share one line when the field instruction spans paragraphs. Text inserted at the start of the result goes before the field and takes the formatting of the text before it unless a format is armed. Up, Down, and presses past the end of a line that draws two paragraphs move the caret correctly.
