---
'@docx-editor.dev/core': minor
---

The `replaceMatch` command and `selectMatch` accept a computed range as well as a `findMatches` result, and refuse with `notFound`, changing nothing, when the text the target expects has moved. A target without `scope` opens the header, footer, or note that holds its paragraph.
