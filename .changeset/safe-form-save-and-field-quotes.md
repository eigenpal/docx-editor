---
'@docx-editor.dev/core': minor
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
---

Preserve pending form values when moving or remounting the editor. Add `PaginatedSurface.save()` to validate pending input and refresh REF fields before serialization. Browser automation and paginated React and Vue refs use this save path. Synchronous saves refuse active edits and destroyed surfaces. Field-exit callbacks can throw or remount the editor without changing date interpretation.

Preserve nested simple-field results in clipboard HTML. Reject partial field quotes in the server-agent review example before an edit can affect additional text. Refuse tracked deletion or replacement of simple fields with nested result structures instead of leaving old text behind.
