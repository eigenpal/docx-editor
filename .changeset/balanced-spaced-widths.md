---
'@docx-editor.dev/core': patch
---

With `w:balanceSingleByteDoubleByteWidth`, spaces beside East Asian text keep their balanced width when the run sets character spacing or scaling, so condensed Korean text wraps at the correct words. Fixes #1913
