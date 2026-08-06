---
'@docx-editor.dev/core': patch
---

Comment markers now land on the character they were asked for in paragraphs holding a drawing, a field or an inline content control, and a comment can be anchored inside a content control at all. The comment writer measured those paragraphs with a walk of its own that counted such elements as nothing, so commenting near one was either refused outright or, worse, placed the marker silently on the wrong character. A marker at the far edge of a complex field is also placed after the whole field rather than among its parts, where Word would drop it on the next field rebuild.
