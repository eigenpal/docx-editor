---
'@docx-editor.dev/core': patch
---

Enabling suggesting mode without a configured author now returns a clear configuration error and logs it once, instead of entering the mode and silently ignoring keystrokes. Setting the author later enters the requested mode. Fixes #692
