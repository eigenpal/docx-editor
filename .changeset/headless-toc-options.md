---
'@eigenpal/docx-editor-core': minor
---

Add `generateTableOfContents(options)` — an options-aware Table of Contents command — and a `GenerateTOCOptions` type, exported from `@eigenpal/docx-editor-core/prosemirror/commands` (and the `prosemirror` barrel).

Options: `minLevel` / `maxLevel` (heading-level range, 1-based), `title` (custom title text; `null`/`""` omits the title paragraph), and `includeHyperlinks` (toggle clickable entries). Omitting `options` reproduces the historical behavior, and the existing `generateTOC: Command` export is unchanged — so current callers (including the React toolbar's Insert → Table of Contents) are unaffected. Useful for headless/programmatic TOC generation. Closes #986.
