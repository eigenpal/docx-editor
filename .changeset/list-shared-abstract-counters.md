---
'@docx-editor.dev/core': patch
---

Number list items correctly when several lists share one numbering definition and one of them restarts, and start each new list, and each list given a starting number, on its own. Lists that share a definition with no start override now continue one count, so lists that earlier versions started this way can renumber. Fixes #1597.
