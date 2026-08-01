---
'@docx-editor.dev/react': minor
---

Word-accurate text measurement without manual font wiring: fonts embedded in a DOCX now feed shaped (HarfBuzz) measurement automatically on load, and the adapters re-export `composeFontConfiguration` and `loadFonts` for composing and fetching app-supplied fonts with hash-verified caching. The `fonts` prop also accepts a bare `{ sources, substitutions }` fragment. A companion fonts package with metric-compatible substitutes for Word's default fonts (Carlito, Caladea, Liberation) is in the workspace; it is not published yet and joins the release group at the v2 publish cutover. Documents still open instantly on the fixed-measure fallback and swap in one remount when fonts resolve.
