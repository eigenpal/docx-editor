---
'@eigenpal/docx-js-editor': patch
---

Fix long unbroken text overflowing page margins (#334). The page-level CSS default font (`Calibri, "Segoe UI", Arial, sans-serif`) didn't match the canvas measurement fallback (`Calibri, Carlito, ...`), so when Carlito loaded as a web font, line widths were measured against Carlito but rendered against Arial — causing strings like `asdfasdfasdf...` to extend past the right margin. Both sides now use the same `resolveFontFamily('Calibri')` chain.
