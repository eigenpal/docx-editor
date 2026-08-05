---
'@docx-editor.dev/react': patch
---

Select All then Delete no longer no-ops on documents that carry inert body-level siblings such as a misplaced `w:pBdr`. Range-delete planning treats those nodes as join barriers so a refused `joinParagraphs` cannot veto the rest of the atomic removal.
