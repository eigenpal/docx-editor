# @docx-editor.dev/fonts-cjk

This package supplies Noto Sans CJK JP, the fallback font for Chinese, Japanese, and Korean text in [`@docx-editor.dev/docx-to-pdf`](https://www.npmjs.com/package/@docx-editor.dev/docx-to-pdf). The font file is about 16 MB, so it is a separate package.

## Install

Install the package next to `@docx-editor.dev/docx-to-pdf`:

```bash
npm install @docx-editor.dev/docx-to-pdf @docx-editor.dev/fonts-cjk
```

PDF export finds the package without configuration. It reads the font file only for a document that needs a CJK face.

If you do not install this package, PDF export can use installed Word CJK fonts, such as SimSun, Batang, and MS Gothic. If no font covers a CJK character, the export reports a `missing-glyph` diagnostic that names this package, and a strict export fails.

## Use the font directly

The package exports the family name and the `file:` URL of the font:

```ts
import { readFile } from 'node:fs/promises';
import { NOTO_SANS_CJK_JP_FAMILY, NOTO_SANS_CJK_JP_URL } from '@docx-editor.dev/fonts-cjk';

const bytes = await readFile(NOTO_SANS_CJK_JP_URL);
console.log(NOTO_SANS_CJK_JP_FAMILY, bytes.byteLength);
```

The package runs on Node.js. It does not bundle the font into JavaScript.

## Licenses

The package code uses the Apache License 2.0. For more information, see [`LICENSE`](LICENSE).

The font uses the SIL Open Font License, Version 1.1. The license text is in [`licenses/NotoSansCJK-OFL.txt`](licenses/NotoSansCJK-OFL.txt).

- Font: Noto Sans CJK JP Regular, version 2.004.
- Copyright: © 2014-2021 Adobe (http://www.adobe.com/).
- Trademark: Noto is a trademark of Google Inc.
- Source: [`notofonts/noto-cjk`](https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf).

The font file is the unmodified upstream binary. [`assets/sources.json`](assets/sources.json) records its source URL and SHA-256 hash. A PDF export embeds a subset of the font that contains only the glyphs the document uses.
