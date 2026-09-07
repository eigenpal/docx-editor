import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import {
  symbolFieldFontFamilies,
  usedNumberingFontFamilies,
} from '../layout/synthesized-font-families.ts';

/** Glyph-only faces use the resolver's reserved share, not the declaration catalog. */
export function resolverGlyphFontFamilies(session: TreeDocxSessionView): readonly string[] {
  const roots = session.storyParts().map((part) => part.root);
  return [
    ...session.symbolFontFamilies(),
    ...symbolFieldFontFamilies(roots),
    ...usedNumberingFontFamilies(
      roots,
      session.numberingRoot(),
      session.stylesRoot(),
      session.documentThemeFonts()
    ),
  ];
}
