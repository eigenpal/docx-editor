/**
 * `@docx-editor.dev/fonts-cjk` carries Noto Sans CJK JP, the fallback face for Chinese,
 * Japanese, and Korean text in `@docx-editor.dev/docx-to-pdf`.
 *
 * The face is about 16 MB, so it ships in its own package. When this package is installed
 * next to `@docx-editor.dev/docx-to-pdf`, PDF export finds it without configuration.
 *
 * Node.js only: the face is a file beside this module, not a bundled asset.
 *
 * @packageDocumentation
 * @public
 */
import { pathToFileURL } from 'node:url';

/**
 * Family name of the packaged face.
 *
 * @public
 */
export const NOTO_SANS_CJK_JP_FAMILY = 'Noto Sans CJK JP';

/**
 * `file:` URL of the packaged face, `NotoSansCJKjp-Regular.otf`: one weight (400), one style
 * (normal), OpenType with CFF outlines.
 *
 * @public
 */
export const NOTO_SANS_CJK_JP_URL: URL = new URL(
  '../assets/NotoSansCJKjp-Regular.otf',
  // The CommonJS build has no `import.meta`, and its `__dirname` is the same `dist/`.
  typeof __dirname === 'string' ? pathToFileURL(__dirname + '/').href : import.meta.url
);
