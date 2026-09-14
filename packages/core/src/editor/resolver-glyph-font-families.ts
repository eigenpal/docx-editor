import { numberingFontInputs } from './numbering-font-inputs.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { ThemeFonts } from '../layout/run-style.ts';
import { eastAsianLanguageFontFamilies } from '../layout/east-asian-font-families.ts';
import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import {
  symbolFieldFontFamilies,
  usedNumberingFontFamilies,
} from '../layout/synthesized-font-families.ts';

const cache = new WeakMap<
  TreeDocxSessionView,
  {
    revision: number;
    families: readonly string[];
    numberingInputs: readonly string[];
    numberingFamilies: readonly string[];
    numberingRoot: OoxmlElement | null;
    stylesRoot: OoxmlElement | null;
    theme: ThemeFonts;
  }
>();

/** Rendered faces absent from declarations use the resolver's reserved share. */
export function resolverGlyphFontFamilies(session: TreeDocxSessionView): readonly string[] {
  const revision = session.packageRevision();
  const cached = cache.get(session);
  if (cached?.revision === revision) return cached.families;
  const roots = session.storyParts().map((part) => part.root);
  const stylesRoot = session.stylesRoot();
  const numberingRoot = session.numberingRoot();
  const theme = session.documentThemeFonts();
  const numberingInputs = numberingFontInputs(roots);
  const numberingUnchanged =
    cached &&
    cached.stylesRoot === stylesRoot &&
    cached.numberingRoot === numberingRoot &&
    cached.theme === theme &&
    cached.numberingInputs.length === numberingInputs.length &&
    cached.numberingInputs.every((input, index) => input === numberingInputs[index]);
  const numberingFamilies = numberingUnchanged
    ? cached.numberingFamilies
    : usedNumberingFontFamilies(roots, numberingRoot, stylesRoot, theme);
  const families = [
    ...session.symbolFontFamilies(),
    ...eastAsianLanguageFontFamilies(roots, stylesRoot, theme),
    ...symbolFieldFontFamilies(roots),
    ...numberingFamilies,
  ];
  cache.set(session, {
    revision,
    families,
    numberingInputs,
    numberingFamilies,
    numberingRoot,
    stylesRoot,
    theme,
  });
  return families;
}
