---
'@docx-editor.dev/core': minor
---

The `replaceMatch` command and `selectMatch` accept a computed range as well as a `findMatches` result, and refuse with `notFound`, changing nothing, when the text the target expects has moved. A target without `scope` resolves its story from its paragraph, and a match in a header, footer, or note that is not open is replaced without opening it, while a match that covers only part of a field result or overlaps tracked deleted text is refused.
