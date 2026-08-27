# @docx-editor.dev/fonts

Metric-compatible, open-licensed substitutes for common Word fonts, packaged for
shaped (HarfBuzz) measurement in the docx-editor engine.

| Word font       | Substitute        | License           |
| --------------- | ----------------- | ----------------- |
| Calibri         | Carlito           | SIL OFL           |
| Cambria         | Caladea           | SIL OFL           |
| Times New Roman | Liberation Serif  | SIL OFL           |
| Arial           | Liberation Sans   | SIL OFL           |
| Courier New     | Liberation Mono   | SIL OFL           |
| Century Gothic  | TeX Gyre Adventor | GUST Font License |

The default substitutes use identical advance widths. TeX Gyre Adventor stays within
0.5% of the recorded Century Gothic widths. Documents that need exact glyphs can supply
licensed bytes through `loadFonts` in `@docx-editor.dev/core`.

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

Font binaries ship as separate files (`assets/*.ttf` and `assets/*.otf`) fetched per requested
family. Each face's `sha256:` hash is baked at packaging time
(`src/manifest.generated.ts`) and CI-verified against the shipped bytes.

## Google Fonts, on demand

`@docx-editor.dev/fonts/google` ships nothing in the bundle and fetches nothing until a
document names a family the catalog covers.

```ts
import { googleFonts } from '@docx-editor.dev/fonts/google';

// A resolver, not a value: the editor calls it once per load with the families
// the file declares, and only those are fetched.
<DocxEditor.Root document={bytes} fonts={googleFonts()} />;
```

Open a file that uses only Calibri and one family is fetched (Carlito, its
metric-compatible stand-in). Open one that names nothing cataloged and no request is
made at all.

The catalog is generated, closed, and pinned to immutable google/fonts commits
(`src/google-catalog.generated.ts`, 107 families). A family a document names is only
ever a lookup key, never interpolated into a URL, and every entry carries a baked
`sha256:` that the engine re-derives on admission. Families are included by rule:
all four static faces present, and the shaper's table checks passed. Variable-only
families (Roboto, Arimo, Open Sans, …) are excluded, because the shaper refuses
variation axes and a variable file would render bold at regular weight.

A fetching resolver makes opening a document perform network requests, and the CDN learns
which families a document uses. The engine never supplies one, so opting in stays your call.
`loadDefaultFonts()` remains the zero-network answer, and
`googleFonts({ allow: ['Tinos', 'Lato'] })` narrows what may ever be fetched.

Regenerate the catalog with `bun run google:catalog` (downloads ~90 MB, pins hashes);
`google:check` guards the committed file offline, `google:verify` re-checks it against
the CDN.

## Licenses

The packaged fonts keep their licenses in `licenses/`. Carlito, Caladea, and Liberation
use the SIL Open Font License. TeX Gyre Adventor uses the GUST Font License.
The package code uses Apache-2.0.
