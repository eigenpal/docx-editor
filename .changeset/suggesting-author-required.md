---
'@docx-editor.dev/core': patch
---

Enabling suggesting mode without a configured author now returns a clear configuration error and raises it once through the `error` event, instead of entering the mode and silently ignoring keystrokes. Setting the author later enters the requested mode, and the toolbar's mode menu keeps the other modes available. Fixes #692
