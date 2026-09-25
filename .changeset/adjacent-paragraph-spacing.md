---
'@docx-editor.dev/core': patch
---

Documents with the `doNotUseHTMLParagraphAutoSpacing` compatibility setting now add the space after one paragraph to the space before the next, instead of using only the larger of the two. In these documents, automatic paragraph spacing is 5pt before and 10pt after.
