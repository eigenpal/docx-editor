// Selectable families are independent of the document and loaded font bytes.
// The standard choices match the standalone FontPicker. Configured and document
// families extend them; listing a choice does not request its font bytes.
// This list does not assert that a family is installed or has been downloaded.
//
// Substitution TARGETS are deliberately excluded: `Carlito` exists to render "Calibri",
// and listing both would offer the same metrics twice under two names — the stand-in is
// an implementation face, not a choice.
//
// Symbol faces are NOT excluded, deliberately. The editor asks a resolver for the face a
// `w:sym` names, so an app can supply the Wingdings a private-use glyph needs — and once it
// has, the editor can honour that family for text as well, which is the only question the
// CONFIGURED half of this catalog answers. Word lists installed symbol fonts in its own
// picker for the same reason. A symbol face also reaches the DOCUMENT half whenever the
// file declares it in a `w:rFonts`, which Word's checkbox markup does (and which
// `applySetContentControlValue` mints when a user ticks one), supplied or not: the document
// half is a catalog of what the file names, and has always offered names nothing can paint.

import { configuredDefaultFontFamily, type FontCatalogConfiguration } from './font-composition.ts';

export { configuredDefaultFontFamily, type FontCatalogConfiguration };

const STANDARD_FONT_FAMILIES: readonly string[] = Object.freeze([
  'Arial',
  'Calibri',
  'Cambria',
  'Consolas',
  'Courier New',
  'Garamond',
  'Georgia',
  'Helvetica',
  'Open Sans',
  'Roboto',
  'Times New Roman',
  'Verdana',
]);

/**
 * The same family-name bound `document-catalog.ts` and the paint sink enforce: kept in
 * sync by value because each module re-validates at its own boundary (see the note
 * there). Every name this module emits can end up in a CSS `font-family` declaration.
 */
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

/**
 * Every family a font picker can offer: standard choices plus the configured catalog
 * (default face, substitution Word-names, host-registered sources) merged with the document's
 * declared families. Deduplicated case-insensitively — configuration first, so its
 * casing wins over a document respelling — and sorted by code point for the same
 * deterministic order as the document derivation. Invalid names are dropped, never
 * repaired, exactly like `collectDocumentFonts`.
 */
export function availableFontFamilies(
  configuration: FontCatalogConfiguration | undefined,
  documentFonts: readonly string[]
): readonly string[] {
  const byFold = new Map<string, string>();
  const add = (family: string | undefined): void => {
    if (family === undefined || !FONT_NAME.test(family)) return;
    const fold = family.toLowerCase();
    if (!byFold.has(fold)) byFold.set(fold, family);
  };

  add(configuredDefaultFontFamily(configuration));
  const substitutions = configuration?.substitutions ?? [];
  const standIns = new Set(substitutions.map((entry) => entry.to.family.toLowerCase()));
  for (const entry of substitutions) add(entry.from.family);
  for (const source of configuration?.sources ?? []) {
    if (standIns.has(source.request.family.toLowerCase())) continue;
    add(source.request.family);
  }
  for (const family of STANDARD_FONT_FAMILIES) add(family);
  for (const family of documentFonts) add(family);

  const fonts = [...byFold.values()];
  fonts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return fonts;
}
