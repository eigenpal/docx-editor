---
'@docx-editor.dev/core': patch
---

Documents whose styles part marks no paragraph style with `w:default` now lay out unstyled paragraphs in the paragraph style named "Normal", and style reads, copy, and paste resolve the same default. A later duplicate of the default paragraph style without `w:default` no longer removes the default.
