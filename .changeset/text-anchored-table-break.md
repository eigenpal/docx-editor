---
'@docx-editor.dev/core': patch
---

Text-anchored floating tables break across pages, and text after a breaking floating table continues beside or below its last part. Split table rows keep their minimum height on the next page and leave room for the rule at the cut. Fixes #1489
