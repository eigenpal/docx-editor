---
'@docx-editor.dev/core': patch
---

Apply Word's automatic paragraph spacing when `w:beforeAutospacing` or `w:afterAutospacing` is set, instead of the measurement the flag replaces. Documents written by Word's HTML filter carry it on every paragraph and were laid out 9pt tight per boundary, which moved page breaks.
