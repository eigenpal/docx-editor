// Last-wins run language from a cascaded `w:rPr` bag (ECMA-376 §17.3.2.20).
//
// Layout reads `@w:val` (Latin / default). `w:eastAsia` and `w:bidi` are not admitted
// hyphenation families. The property is not authorable — it is not in
// `ACCEPTED_RUN_PROPERTIES` — so this module never writes it.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';

/**
 * Last cascaded `w:lang/@w:val`, or `null` when no readable value remains.
 *
 * Later bags win: document defaults, then style, then direct run properties.
 * An entry without `@w:val` does not clear an earlier value.
 */
export function lastWinsRunLanguage(props: readonly OoxmlProperty[]): string | null {
  let value: string | null = null;
  for (const property of props) {
    if (property.localName !== 'lang') continue;
    const raw = property.attributes?.val;
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    value = trimmed;
  }
  return value;
}
