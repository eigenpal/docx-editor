# @docx-editor.dev/fonts-cjk

This package supplies Noto Sans CJK JP for Chinese, Japanese, and Korean text. The [`@docx-editor.dev/docx-to-pdf`](https://www.npmjs.com/package/@docx-editor.dev/docx-to-pdf) package uses it as an optional fallback. The font file is about 16 MB, so it ships separately.

## Install

Use Node.js `^20.16.0 || >=22.3.0`. Install the package with the PDF converter and its required engine peer:

```bash
npm install @docx-editor.dev/docx-to-pdf @docx-editor.dev/core @docx-editor.dev/fonts-cjk
```

The converter declares `@docx-editor.dev/fonts-cjk` as an optional peer dependency. Use versions that satisfy the converter's peer dependency ranges. PDF export finds the package without configuration and reads its font from disk. It makes no network request for the font.

## Font selection

PDF export uses this font when earlier sources lack the requested CJK family or characters. Your `fonts`, enabled system fonts, packaged substitutes, and `fallbackFonts` sources take priority. This font resolves before document-embedded fonts and `lastResortFonts`. For the complete order, see [Configure PDF fonts](../docx-to-pdf/docs/fonts.md#choose-a-source).

The default glyph fallback list includes this font. If you supply `glyphFallbacks`, your list replaces the defaults. For this fallback, add an entry with `family: NOTO_SANS_CJK_JP_FAMILY`, `weight: 400`, and `style: 'normal'`.

You can omit this package when installed or supplied fonts cover your CJK text. Installed fonts such as SimSun, Batang, and MS Gothic take priority when `useSystemFonts` is `true`. If no font covers a CJK character, export reports a `missing-glyph` diagnostic. When this package is absent, the diagnostic names it. Strict export fails for missing glyphs.

## Deploy the package

Add the package to your production dependencies. Keep it external to your server bundle so Node.js can resolve it at runtime. Retain its `dist/` and `assets/` directories in their package locations. Include its license files when distributing the package.

An installed package with missing or unreadable font assets reports `font-origin-failed`. Inspect `result.fontResolution.originFailures` to find the cause. Setting `fontPolicy: 'strict'` rejects these source failures.

For deployment examples, see [Integrate PDF conversion](../docx-to-pdf/docs/integrations.md).

## Use the font directly

The package has two public exports:

| Export | Type | Value |
| --- | --- | --- |
| `NOTO_SANS_CJK_JP_FAMILY` | String literal | `'Noto Sans CJK JP'` |
| `NOTO_SANS_CJK_JP_URL` | `URL` | A `file:` URL for `assets/NotoSansCJKjp-Regular.otf`. |

Use the exported URL to read the font without constructing a package path:

```ts
import { readFile } from 'node:fs/promises';
import {
  NOTO_SANS_CJK_JP_FAMILY,
  NOTO_SANS_CJK_JP_URL,
} from '@docx-editor.dev/fonts-cjk';

const bytes = await readFile(NOTO_SANS_CJK_JP_URL);
console.log(NOTO_SANS_CJK_JP_FAMILY, bytes.byteLength);
```

The package runs on Node.js. It does not bundle the font into JavaScript or install a browser font.

## Coverage and limits

- The package includes one OpenType font with CFF outlines: Noto Sans CJK JP Regular.
- Its weight is `400`, and its style is `'normal'`.
- It supplies the Japanese regional face, without separate Chinese or Korean regional faces.
- PDF export can synthesize bold and italic from this regular face.
- Substituting this font can change glyph forms, line breaks, and page counts.
- Characters outside the font's coverage still require another font.

Supply your own font through the converter's `fonts` option when you need a specific regional face or designed style.

## Licenses

The package code uses the Apache License 2.0. For more information, see [`LICENSE`](LICENSE). The PDF converter uses the separate [EigenPal Pro License](../docx-to-pdf/LICENSE.md).

The font uses the SIL Open Font License, Version 1.1. The license text is in [`licenses/NotoSansCJK-OFL.txt`](licenses/NotoSansCJK-OFL.txt).

- Font: Noto Sans CJK JP Regular, version 2.004.
- Copyright: © 2014-2021 Adobe (http://www.adobe.com/).
- Trademark: Noto is a trademark of Google Inc.
- Source: [`notofonts/noto-cjk`](https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf).

The font file is the unmodified upstream binary. [`assets/sources.json`](assets/sources.json) records its source URL and SHA-256 hash. PDF export embeds only the glyphs that the document uses.
