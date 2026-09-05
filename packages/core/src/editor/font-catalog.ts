// The font catalog a picker offers: the families the editor can honour, not just the
// families the document happens to declare.
//
// A brand-new document declares no `w:rFonts` anywhere, so a picker fed only the
// document derivation opens empty — a dead control on the commonest document there is.
// The editor, however, always has fonts: the configured default face, every Word-name
// family its substitution map can stand in for, and any family the host registered
// bytes for directly. Those are offerable regardless of what the file says, and the
// document's own declared families join them.
//
// Substitution TARGETS are deliberately excluded: `Carlito` exists to render "Calibri",
// and listing both would offer the same metrics twice under two names — the stand-in is
// an implementation face, not a choice.
//
// Symbol faces are excluded for the same kind of reason. The editor asks a resolver for the
// face a `w:sym` names, so an app can supply the Wingdings a private-use glyph needs — and a
// face that arrives that way must not become a text choice, or the picker offers to set a
// paragraph in dingbats.

import { configuredDefaultFontFamily, type FontCatalogConfiguration } from './font-composition.ts';

export { configuredDefaultFontFamily, type FontCatalogConfiguration };

/**
 * The same family-name bound `document-catalog.ts` and the paint sink enforce: kept in
 * sync by value because each module re-validates at its own boundary (see the note
 * there). Every name this module emits can end up in a CSS `font-family` declaration.
 */
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

/**
 * Every family a font picker can offer: the configured catalog (default face,
 * substitution Word-names, host-registered source families) merged with the document's
 * declared families. Deduplicated case-insensitively — configuration first, so its
 * casing wins over a document respelling — and sorted by code point for the same
 * deterministic order as the document derivation. Invalid names are dropped, never
 * repaired, exactly like `collectDocumentFonts`.
 */
export function availableFontFamilies(
  configuration: FontCatalogConfiguration | undefined,
  documentFonts: readonly string[],
  /** Faces the document uses only through a `w:sym`; never offered as a text choice. */
  symbolFonts: readonly string[] = []
): readonly string[] {
  const byFold = new Map<string, string>();
  // A family the document ALSO declares through `w:rFonts` is a text face that happens to
  // draw a symbol too, so only the symbol-only names are held back.
  const declared = new Set(documentFonts.map((family) => family.toLowerCase()));
  const symbolOnly = new Set(
    symbolFonts.map((family) => family.toLowerCase()).filter((fold) => !declared.has(fold))
  );
  const add = (family: string | undefined): void => {
    if (family === undefined || !FONT_NAME.test(family)) return;
    const fold = family.toLowerCase();
    if (symbolOnly.has(fold) || byFold.has(fold)) return;
    byFold.set(fold, family);
  };

  add(configuredDefaultFontFamily(configuration));
  const substitutions = configuration?.substitutions ?? [];
  const standIns = new Set(substitutions.map((entry) => entry.to.family.toLowerCase()));
  for (const entry of substitutions) add(entry.from.family);
  for (const source of configuration?.sources ?? []) {
    if (standIns.has(source.request.family.toLowerCase())) continue;
    add(source.request.family);
  }
  for (const family of documentFonts) add(family);

  const fonts = [...byFold.values()];
  fonts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return fonts;
}
