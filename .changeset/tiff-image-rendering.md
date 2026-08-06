---
'@docx-editor.dev/core': minor
---

TIFF images now render instead of reserving their extent behind a placeholder. The image decode port's `convertMetafile` hook is renamed to `convertPreserved` and receives TIFF alongside EMF and WMF.
