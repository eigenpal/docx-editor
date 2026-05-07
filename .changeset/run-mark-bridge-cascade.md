---
'@eigenpal/docx-js-editor': patch
---

Run-level OOXML attributes that were already parsed and held as ProseMirror marks now reach the painted DOM. The layout-bridge's `extractRunFormatting` had no `case` arm for several run-level marks, so the visible renderer silently dropped them while the hidden ProseMirror `toDOM` rendered them correctly:

- **`w:caps` (§17.3.2.4) — `allCaps`** — uppercase styling on heading runs is no longer lowercased.
- **`w:smallCaps` (§17.3.2.32) — `smallCaps`** — small-caps styling reaches the painted DOM.
- **`w:position` (§17.3.2.24)** — baseline shift in half-points now applies as `vertical-align`.
- **`w:w` (§17.3.2.43)** — horizontal text scale (e.g. 90% tracking on branded templates) applies as a `transform: scaleX(...)` on an inline-block.
- **`w:kern` (§17.3.2.18)** — kerning threshold gate enables `font-kerning: normal` when the run's font size is at or above the threshold.

The four `w:position` / `w:w` / `w:kern` properties share a single PM mark (`characterSpacing`) with a multi-attribute container; previously only its `spacing` attribute was bridged, so the other three sat in the model unread.

Refs #410.

Also propagates the cosmetic-effect marks (`emboss`, `imprint`, `textShadow`, `textOutline`, `emphasisMark`) which were the same defect class — PM marks parsed correctly but the layout-bridge had no `case` arm, so painted runs lost the effect. Each maps to the same CSS recipe the hidden PM `toDOM` uses, so editable + painted views stay visually identical.

Adjacent fix for #392: paragraph runs without an explicit `fontFamily` mark now inherit the paragraph's resolved style font (from the basedOn → docDefaults cascade) instead of falling back to the painter's hardcoded Calibri stack. Same mechanism applies to `fontSize` — runs that don't override fall through to the paragraph's resolved default. Closes the per-run side of the rFonts cascade gap from #412.

Refs #410, #412, fixes #392.
