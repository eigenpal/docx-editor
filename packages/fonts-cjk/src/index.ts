// Modified in the Grant Workbench fork of docx-editor (Eigenpal, Inc., Apache-2.0), 2026. See FORK-CHANGES.md.
/**
 * `@docx-editor.dev/fonts-cjk` carries Noto Sans CJK JP, the fallback face for Chinese,
 * Japanese, and Korean text.
 *
 * The face is about 16 MB, so it ships in its own package.
 *
 * Node.js only: the face is a file beside this module, not a bundled asset. For the editor in
 * a browser, use `cjkFonts()` from `@docx-editor.dev/fonts-cjk/browser`.
 *
 * @packageDocumentation
 * @public
 */
import { pathToFileURL } from 'node:url';

export {
  CJK_SUBSTITUTED_FAMILIES,
  LOCALIZED_CJK_FAMILIES,
  NOTO_SANS_CJK_JP_FAMILY,
} from './families.ts';

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
