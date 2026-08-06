---
'@docx-editor.dev/core': patch
---

Trailing tabs no longer start a new line, so a header authored as tabbed columns keeps its own height and stops pushing the body down the page. Header and footer shapes marked `behindDoc` now paint beneath the body text instead of over it.
