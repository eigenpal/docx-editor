---
'@docx-editor.dev/core': patch
---

Keystrokes arriving in a burst now land as one transaction and one layout flush instead of one per character, so fast typing in long documents stays responsive; a burst is also one undo step and one tracked change.
