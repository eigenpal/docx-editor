---
'@eigenpal/docx-editor-core': patch
---

Honor an explicit `0` for layout offsets that were previously treated as "unset". A full-bleed page margin (`w:pgMar w:top/left="0"`) no longer snaps to the 1-inch default, and a text-wrapping image pinned flush to the text (`w:distL/distR="0"`) no longer opens a phantom 12px gap. Generalizes the #740 header/footer fix behind a shared nullish helper and a documented size-vs-offset rule, so the falsy-zero trap can't recur.
