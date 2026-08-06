---
'@docx-editor.dev/core': minor
'@docx-editor.dev/react': minor
'@docx-editor.dev/pro': minor
---

Every remaining `ep-` prefixed CSS class and keyframe is renamed to `docx-editor-`, so the whole stylesheet shares one namespace with the `.docx-editor` root class. If your own CSS targets an `.ep-*` class or the `ep-caret-blink` keyframe, switch it to the same name under `docx-editor-` (`.ep-one-surface__caret` becomes `.docx-editor-one-surface__caret`).
