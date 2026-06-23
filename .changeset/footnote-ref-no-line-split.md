---
'@eigenpal/docx-editor-core': patch
---

Keep a footnote/endnote reference superscript on the same line as the word it follows. The line-breaker treated every run boundary as a wrap opportunity, so a reference mark with no space before it (e.g. `copyright.¹`) could split onto the next line. Adjacent runs with no whitespace between them now wrap as one unbreakable cluster, matching Word.
