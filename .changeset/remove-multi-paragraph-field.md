---
'@docx-editor.dev/core': patch
---

An untracked `Range.delete()` that covers a whole field whose instruction spans paragraphs, from the start of the field through the end of its result, now removes the field and joins the paragraphs on each side. A delete that covers only part of such a field, or any tracked delete of it, still refuses with `NotSupported`.
