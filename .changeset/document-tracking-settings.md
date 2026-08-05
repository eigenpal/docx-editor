---
'@docx-editor.dev/react': minor
---

A document that asks for tracked changes now opens in Suggesting. `settings.xml` is read for `w:trackRevisions`, and for protection restricted to tracked changes, which keeps the mode from being switched off. Choosing a mode yourself still wins, and reloading the document does not undo it.
