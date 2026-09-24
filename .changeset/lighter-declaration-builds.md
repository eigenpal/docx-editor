---
'@docx-editor.dev/core': patch
---

Build the packages' type declarations with a quarter of the memory, so the packages build with Node's default heap. The published types are unchanged, although some inferred unions list their members in a different order.
