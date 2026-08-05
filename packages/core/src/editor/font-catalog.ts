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

import type { FontConfiguration } from '../contracts/editor.ts';
import { WORD_DEFAULT_FONT, type FontConfigurationBase } from './font-composition.ts';

/**
 * The same family-name bound `document-catalog.ts` and the paint sink enforce: kept in
 * sync by value because each module re-validates at its own boundary (see the note
 * there). Every name this module emits can end up in a CSS `font-family` declaration.
 */
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

/** A configuration in either public spelling — full or fragment-with-defaults. */
export type FontCatalogConfiguration = FontConfiguration | FontConfigurationBase;

/**
 * The face a run with no authored font is measured and reported as: the configured
 * default when it names a valid family, Word's own (Calibri) otherwise.
 */
export function configuredDefaultFontFamily(configuration?: FontCatalogConfiguration): string {
  const family = configuration?.defaultFont?.family;
  return family !== undefined && FONT_NAME.test(family) ? family : WORD_DEFAULT_FONT.family;
}

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
  for (const family of documentFonts) add(family);

  const fonts = [...byFold.values()];
  fonts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return fonts;
}
