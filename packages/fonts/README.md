# @docx-editor.dev/fonts

Metric-compatible, open-licensed substitutes for Word's default fonts, packaged for
shaped (HarfBuzz) measurement in the docx-editor engine.

| Word font       | Substitute       | License |
| --------------- | ---------------- | ------- |
| Calibri         | Carlito          | SIL OFL |
| Cambria         | Caladea          | SIL OFL |
| Times New Roman | Liberation Serif | SIL OFL |
| Arial           | Liberation Sans  | SIL OFL |
| Courier New     | Liberation Mono  | SIL OFL |

Metric-compatible means identical advance widths: line wrap and pagination land where
Word puts them, even though glyph outlines differ slightly. Documents that need exact
rendering of the real faces should supply licensed bytes via `loadFonts` in
`@docx-editor.dev/core`.

## Usage

```ts
import { loadDefaultFonts, installDefaultFontFaces } from '@docx-editor.dev/fonts';

const fragment = await loadDefaultFonts(); // or { families: ['Calibri'] }

// The editor's `fonts` option accepts the fragment directly —
// createDocxEditor({ container, document: bytes, fonts: fragment })
// or <DocxEditor.Root document={bytes} fonts={fragment} /> in the adapters.
// To merge several origins, use composeFontConfiguration (re-exported by
// @docx-editor.dev/react and @docx-editor.dev/vue).

// Optional paint fidelity: register the substitutes with the browser under the Word
// family names so painted glyphs match the measured metrics.
await installDefaultFontFaces();
```

Nothing loads until you call `loadDefaultFonts`: importing the package fetches no
bytes, and the editor engine never calls in here on its own.

Font binaries ship as separate files (`assets/*.ttf`) fetched lazily per requested
family. Each face's `sha256:` hash is baked at packaging time
(`src/manifest.generated.ts`) and CI-verified against the shipped bytes.

## Licenses

The packaged fonts keep their own licenses (see `licenses/`): Carlito and Caladea and
the Liberation family under the SIL Open Font License. The package's own code is
Apache-2.0.
