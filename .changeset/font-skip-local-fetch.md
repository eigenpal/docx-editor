---
'@eigenpal/docx-editor-core': patch
---

Add `setGoogleFontsEnabled(false)` (from `@eigenpal/docx-editor-core` or its `/utils` entry) so strict-CSP / offline embedders can disable the automatic Google Fonts fetching entirely, and skip that fetch automatically when a font already renders locally. Embedded and consumer-hosted (`fonts` prop) faces keep their metric-compatible Google fallback for glyph coverage.
