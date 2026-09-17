---
'@docx-editor.dev/fonts': patch
---

Read the `DOCX_EDITOR_FONT_ASSET_ROOT` environment variable in Node to relocate the packaged font directory, so single-file bundles can ship the fonts beside the executable. `packagedFonts()` now reports its Word-to-substitute mapping for a family an earlier origin covers under the substitute's own name, so registering Carlito yourself no longer leaves Calibri unresolved.
