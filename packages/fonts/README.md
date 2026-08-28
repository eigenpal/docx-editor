# @docx-editor.dev/fonts

Open-licensed substitutes for common Word fonts, packaged for shaped (HarfBuzz)
measurement in the docx-editor engine.

| Word font       | Substitute        | License           |
| --------------- | ----------------- | ----------------- |
| Calibri         | Carlito           | SIL OFL           |
| Cambria         | Caladea           | SIL OFL           |
| Times New Roman | Liberation Serif  | SIL OFL           |
| Arial           | Liberation Sans   | SIL OFL           |
| Courier New     | Liberation Mono   | SIL OFL           |
| Century Gothic  | TeX Gyre Adventor | GUST Font License |

The first five substitutes use identical advance widths. TeX Gyre Adventor is close but
not identical: `bun run check:font-width-fidelity` holds it to within 1% of Word's own
Century Gothic advances, and the widest sample is -0.85% (`of work` at 40 pt bold). That
1% is the gate's bound, not a description of it. Documents that need exact glyphs can
supply licensed bytes through `loadFonts` in `@docx-editor.dev/core`.

`loadDefaultFonts()` and `defaultFonts()` load the five families Word applies to a
document by default. Century Gothic is not one of them and adds about 709 KB, so it is
opt-in: pass `families: ALL_WORD_DEFAULT_FAMILIES`, or use `googleFonts()`, which serves
it from these same packaged bytes only when a document names it.

## Usage

```ts
import { packagedFonts } from '@docx-editor.dev/fonts';
import { useFonts } from '@docx-editor.dev/react';

// A resolver: the editor calls it once per load with the families the file
// declares, so a document using only Times New Roman loads Liberation Serif and
// nothing else, and one naming none of the five loads nothing at all.
//
// `useFonts` is not optional here. The `fonts` prop rebuilds the editor when its
// identity changes, and `packagedFonts()` written inline is a new function on
// every render; `useFonts` keeps one for the component's life.
const fonts = useFonts(packagedFonts());
<DocxEditor.Root document={bytes} fonts={fonts} />;
```

Same call shape as `googleFonts()` below, so composing the two is adding an argument:

```ts
const fonts = useFonts(packagedFonts(), googleFonts());
```

To load every face up front instead — no re-pagination, all 7.4 MB, whichever document
opens — use `defaultFonts()`:

```ts
import { defaultFonts, installDefaultFontFaces } from '@docx-editor.dev/fonts';

const fragment = await defaultFonts(); // or { families: ['Calibri'] }

// `defaultFonts` already registers the paint-side faces. `loadDefaultFonts` is the
// same load without that half, and `installDefaultFontFaces` is that half alone.
await installDefaultFontFaces();
```

Nothing loads until you call one of these: importing the package fetches no bytes, and
the editor engine never calls in here on its own.

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

The substitution map is consulted FIRST, and your `substitute` entries are merged over the
built-in one, so you can redirect any family — a catalogued one, or one this package
answers from its own assets.

A family the catalog cannot match may still be answered from those assets. Century Gothic
is the one, read from `assets/` rather than the CDN, so it costs no third-party request.

A family none of that answers resolves to nothing, and the host's own measurement stands.
That is deliberate. Only a metric-compatible substitute keeps pagination Word-accurate,
and a face picked from how a font describes itself is not one: `word/fontTable.xml` states
a PANOSE classification, never an advance width, so nothing in the file bounds how much
wider the substitute runs. A ranking over PANOSE was tried here and removed after it
picked faces 22-24% wider than the family a document named — worse than the fixed fallback
it replaced; issue #576 records the measurements. Supply the real bytes through
`substitute` or `loadFonts` when you have them.

A fetching resolver makes opening a document perform network requests, and the CDN learns
which families a document uses. The engine never supplies one, so opting in stays your call.
`packagedFonts()` remains the zero-network answer, and
`googleFonts({ allow: ['Tinos', 'Lato'] })` narrows what may ever be fetched. Listed
after `packagedFonts()`, this resolver is told which families are already covered and
skips them, so the packaged five never cost a CDN request.

Regenerate the catalog with `bun run google:catalog` (downloads ~90 MB, pins hashes).

`bun run check:google-catalog` guards the committed file offline and runs in CI. It is
what enforces the revision pin: every URL has to name one of the commits the generator
records, so a regenerated catalog cannot quietly point at a mutable branch tip. Run
`google:verify` from this package to re-download every catalogued face and compare hashes
against the CDN.

`bun run check:font-width-fidelity` compares privacy-safe synthetic strings against Word's
own advances and line metrics, read from the font subsets Word embeds in its PDF export,
and prints the families the package does not cover.

## Licenses

The packaged fonts keep their licenses in `licenses/`. Carlito, Caladea, and Liberation
use the SIL Open Font License. TeX Gyre Adventor uses the GUST Font License, which has no
SPDX identifier of its own, so `package.json` names it `LicenseRef-GUST-Font-License`.
Its operative terms are the LaTeX Project Public License 1.3c or, at your option, any
later version; the one clause it adds on top asks you to rename a modified font, and says
so as a request rather than a legal requirement. `licenses/` carries both texts, because
the GUST license states its terms by reference to the LPPL. The package code uses
Apache-2.0.
