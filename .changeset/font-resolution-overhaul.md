---
'@docx-editor.dev/react': minor
---

Word-accurate text measurement without manual font wiring: fonts embedded in a DOCX now feed shaped (HarfBuzz) measurement automatically on load — and register with the browser so painted pages render with the same glyphs — and the adapters re-export `composeFontConfiguration` and `loadFonts` for composing and fetching app-supplied fonts with hash-verified caching. The `fonts` prop also accepts a bare `{ sources, substitutions }` fragment. A companion fonts package with metric-compatible substitutes for Word's default fonts (Carlito, Caladea, Liberation) ships with the workspace and publishes with the v2 line. Documents still open instantly on the fixed-measure fallback and swap in one remount when fonts resolve.
