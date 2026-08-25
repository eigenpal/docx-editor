---
'@docx-editor.dev/core': patch
---

Fix replacements over a selection in tracked-changes mode: typing, paste, Enter, tab, breaks, and page fields now land after the struck words with the caret following, instead of reversed or in front of the strike. Multi-line paste now splits its paragraphs inside the tracked insertion, and typing over your own pending Enter merges it instead of doing nothing.
