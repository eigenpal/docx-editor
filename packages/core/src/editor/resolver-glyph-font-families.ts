import { eastAsianLanguageFontFamilies } from '../layout/east-asian-font-families.ts';
import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import {
  symbolFieldFontFamilies,
  usedNumberingFontFamilies,
} from '../layout/synthesized-font-families.ts';

/** Rendered faces absent from declarations use the resolver's reserved share. */
export function resolverGlyphFontFamilies(session: TreeDocxSessionView): readonly string[] {
  const roots = session.storyParts().map((part) => part.root);
  return [
    ...session.symbolFontFamilies(),
    ...eastAsianLanguageFontFamilies(roots, session.stylesRoot(), session.documentThemeFonts()),
    ...symbolFieldFontFamilies(roots),
    ...usedNumberingFontFamilies(
      roots,
      session.numberingRoot(),
      session.stylesRoot(),
      session.documentThemeFonts()
    ),
  ];
}
