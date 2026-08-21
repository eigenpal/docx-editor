---
'@docx-editor.dev/core': patch
---

Paragraphs in a header, footer or note are addressable. `snapshot().selection` reports a caret in one instead of `null`, `hyperlinkAt` finds a link there, and `setSelection` accepts an anchor that names one. A `w14:paraId` that two stories both claim is now refused as ambiguous rather than resolving to whichever story came first.
