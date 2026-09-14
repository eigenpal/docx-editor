---
'@docx-editor.dev/core': patch
---

Use the declarations shipped by bidi-js 1.1.0 and update the HarfBuzz runtime version check to 14.4.0 for harfbuzzjs 1.6.1. This fixes the declaration build and allows the upgraded text shaper to initialize. The shaping parity fixture output is unchanged apart from version metadata.
