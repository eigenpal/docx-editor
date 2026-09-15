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

The first five substitutes target matching advance widths for the glyphs they cover.
TeX Gyre Adventor is slightly narrower than Century Gothic; the measured difference stays within 1% in `bun run check:font-width-fidelity`.
Kerning and glyph differences can still change line breaks.
For the original glyphs, supply licensed font bytes through `loadFonts()` from `@docx-editor.dev/core/editor`.

Packaged faces do not cover every script. Liberation Sans has no Arabic glyphs.
The editor keeps native family fallback available for missing glyphs. Exact metrics still
depend on the font available for that script.

`loadDefaultFonts()` and `defaultFonts()` load the five families Word applies to a
document by default. Century Gothic is not one of them and adds about 709 KB, so it is
opt-in: pass `families: ALL_WORD_DEFAULT_FAMILIES`, or use `googleFonts()`, which serves
it from these same packaged bytes only when a document names it.

## Usage

Use `packagedFonts()` to load document fonts on demand. In React, `useFonts()`
keeps the resolver identity stable so rerenders do not rebuild the editor.

```tsx
import { packagedFonts } from '@docx-editor.dev/fonts';
import { DocxEditor, useFonts } from '@docx-editor.dev/react';

function Editor({ bytes }: { bytes: Uint8Array }) {
  const fonts = useFonts(packagedFonts());
  return <DocxEditor document={bytes} fonts={fonts} />;
}
```

To add Google Fonts, import its resolver and pass it after `packagedFonts()`:

```ts
import { googleFonts } from '@docx-editor.dev/fonts/google';

const fonts = useFonts(packagedFonts(), googleFonts());
```

Call `useFonts()` inside a component.

To load all 20 faces of the five default families before opening a document, use `defaultFonts()`.
This loads 7.4 MB and avoids repagination when fonts arrive:

```ts
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { defaultFonts } from '@docx-editor.dev/fonts';

const fonts = await defaultFonts(); // Add families to load a subset.
const editor = createDocxEditor({ document: bytes, fonts });
```

## Custom fonts for the editor

Use `customFonts()` to supply brand fonts or licensed Word fonts to the editor.
Put it first so your supplied faces take precedence.

```tsx
import { customFonts } from '@docx-editor.dev/core/editor';
import { packagedFonts } from '@docx-editor.dev/fonts';
import { googleFonts } from '@docx-editor.dev/fonts/google';
import { DocxEditor, useFonts } from '@docx-editor.dev/react';

function Editor({ bytes }: { bytes: Uint8Array }) {
  const fonts = useFonts(
    customFonts({
      sources: [
        {
          url: '/fonts/AcmeSans-Regular.ttf',
          family: 'Acme Sans',
          weight: 400,
          style: 'normal',
        },
        {
          url: '/fonts/AcmeSans-Bold.ttf',
          family: 'Acme Sans',
          weight: 700,
          style: 'normal',
        },
      ],
      onFailure: (failure) => console.warn(failure.request.family, failure.reason),
    }),
    packagedFonts(),
    googleFonts()
  );
  return <DocxEditor document={bytes} fonts={fonts} />;
}
```

`customFonts()` loads all configured faces when the editor resolves its fonts.
Creating the resolver does not fetch files. It skips faces supplied by earlier sources,
matching the family name without case sensitivity and matching weight and style.

Loaded fonts appear in the picker, including in blank documents.
Select a font to apply it to document text.

The helper uses `loadFonts` for validation and caching. `onFailure` receives each
failed face and defaults to `console.warn`. Cancellation does not trigger `onFailure`.
Core registers the supplied bytes under private names, without changing fonts elsewhere in your app.

`loadFonts()` from Core remains the lower-level eager loader. It starts loading
every listed source when called and returns validated bytes with a typed `failures` list.

## Font registration

`defaultFonts()` and `packagedFonts()` supply font bytes for the editor. Core
registers these bytes under private font names. Your app's header and sidebar keep
their existing fonts. Native fonts remain available for glyphs missing from the substitutes.

### Upgrade from page-wide registration

Before 2.18.0, loaders could register substitutes under public names such as `Arial`.
From 2.18.0, font loaders supply bytes for private editor registration only.
If you already pass `packagedFonts()` or `defaultFonts()` through the editor's `fonts` option, keep that configuration.

The `packagedFonts` option `install` is deprecated and ignored, including `true`.
Remove it while keeping your other loader options:

```diff
- fonts: packagedFonts({ install: true, onFailure })
+ fonts: packagedFonts({ onFailure })
```

`installDefaultFontFaces()` is deprecated. It does nothing and resolves to `0`, without fetching or registering fonts.
Remove its calls and supply `packagedFonts()` or `defaultFonts()` through the editor's `fonts` option instead.
`defaultFonts()` has no `install` option. `loadDefaultFonts()` remains bytes-only.

If surrounding app text relied on these public fonts, configure those fonts separately with your app's CSS or font loader.
Check the fonts in your app's headers, sidebars, and other text after upgrading.

Importing the package does not fetch fonts. Configure a loader or resolver to enable them.

Font binaries ship as separate files (`assets/*.ttf` and `assets/*.otf`) fetched per requested
family. Each face's `sha256:` hash is baked at packaging time
(`src/manifest.generated.ts`) and CI-verified against the shipped bytes.

## Google Fonts, on demand

`@docx-editor.dev/fonts/google` includes a font catalog without bundling its font files.
It fetches fonts requested by the document or its default face.

```tsx
import { googleFonts } from '@docx-editor.dev/fonts/google';
import { DocxEditor, useFonts } from '@docx-editor.dev/react';

function Editor({ bytes }: { bytes: Uint8Array }) {
  const fonts = useFonts(googleFonts());
  return <DocxEditor document={bytes} fonts={fonts} />;
}
```

The editor requests fonts on load and when edits or font selection introduce new families.

A document that uses Calibri loads Carlito, its metric-compatible substitute.
The document's default face also counts as a request. Use `allow` to restrict the catalog.

Resolution checks these sources in order:

1. Your `substitute` mappings, merged over the built-in substitutions.
2. Packaged assets for Century Gothic, which needs no third-party request.
3. A direct match in the Google Fonts catalog.

If no source matches, the editor keeps its fallback measurement. It does not infer
width-compatible substitutes from the document's PANOSE font classification.
Supply your own font bytes when you need a specific face.

Google Fonts requests disclose the requested families to the content delivery network.
Use `packagedFonts()` for packaged assets, or restrict remote requests with
`googleFonts({ allow: ['Tinos', 'Lato'] })`.
When composed after another resolver, Google Fonts skips families whose faces are already loaded.
A partially loaded family still requires its remaining faces.

## Maintain the catalog

The generated catalog pins each face to an immutable `google/fonts` commit and a
`sha256:` hash. Family names are lookup keys, never URL fragments.
The catalog requires regular, bold, italic, and bold-italic static faces that pass
validation. When upstream provides only variable fonts, the catalog can pin an earlier
commit with static files. The shaper does not support variable font axes.

Run these commands from `packages/fonts`:

```bash
# Download fonts and regenerate the catalog and hashes.
bun run google:catalog

# Download catalog faces and verify their hashes.
bun run google:verify
```

From the repository root, run `bun run check:google-catalog` to check the committed
catalog offline. CI runs the same check.
`bun run check:font-width-fidelity` compares synthetic text measurements with
font subsets embedded in Word PDF exports.

## Licenses

The packaged fonts keep their licenses in `licenses/`. Carlito, Caladea, and Liberation
use the SIL Open Font License. TeX Gyre Adventor uses the GUST Font License, which has no
SPDX identifier of its own, so `package.json` names it `LicenseRef-GUST-Font-License`.
Its operative terms are the LaTeX Project Public License 1.3c or, at your option, any
later version; the one clause it adds on top asks you to rename a modified font, and says
so as a request rather than a legal requirement. `licenses/` carries both texts, because
the GUST license states its terms by reference to the LPPL. The package code uses
Apache-2.0.
