---
'@eigenpal/docx-js-editor': patch
---

Render `wp:wrapNone` anchored images (`behind` / `inFront`) as positioned floats instead of block images. They no longer consume paragraph flow height or create text-wrap exclusion zones, matching Word's behavior.
