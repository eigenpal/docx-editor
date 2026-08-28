// Toggle properties of the style hierarchy (ECMA-376 §17.7.3).
//
// A toggle property is the one class of run property that does NOT resolve by last-wins.
// §17.7.3 states the rule in two halves, and both halves are load-bearing:
//
//   Within ONE level of the hierarchy the value is "the first value encountered by the
//   following algorithm ... Attempt to read the value in the style. If it does not exist and
//   the style has a basedOn element with a non-empty value, repeat step 1 using the style
//   specified by the basedOn element." So a level resolves tip → base and STOPS at the first
//   style that states the property — including one that states it false.
//
//   Across levels: "If the value specified by the document defaults is true, the effective
//   value is true. Otherwise, the values are combined by a Boolean XOR as follows:
//   value_effective = val_table XOR val_paragraph XOR val_character."
//
// So exactly three values enter the XOR, the document defaults are a SHORT CIRCUIT and not a
// fourth term, and a `basedOn` chain contributes one value, not one per style. Combining the
// styles of one level by parity is what makes an ordinary Word edit — re-tick bold on a style
// whose base is already bold — come back unbold.
//
// Direct formatting never reaches this module: "If a toggle property is explicitly set in
// direct formatting applied to a given piece of content, then its value in the direct
// formatting shall be used." Callers append direct `w:rPr` after the combined result, where
// `resolveRunStyle`'s last-wins reading makes it absolute.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';

/**
 * The toggle properties §17.7.3 enumerates, and only those.
 *
 * §17.3.2.1 (`b`), §17.3.2.2 (`bCs`), §17.3.2.5 (`caps`), §17.3.2.13 (`emboss`), §17.3.2.16
 * (`i`), §17.3.2.17 (`iCs`), §17.3.2.18 (`imprint`), §17.3.2.23 (`outline`), §17.3.2.31
 * (`shadow`), §17.3.2.33 (`smallCaps`), §17.3.2.37 (`strike`), §17.3.2.41 (`vanish`).
 *
 * `w:dstrike` (§17.3.2.9) is NOT in that list, and its own section uses the non-toggle
 * wording ("leave the formatting applied at previous level in the style hierarchy"). Treating
 * it as a toggle made two levels that each set `<w:dstrike/>` cancel, where Word keeps the
 * double strikethrough on.
 *
 * `w:bCs` and `w:iCs` are in the list and are therefore in this set, even though the
 * complex-script lane does not read them yet: leaving them out would resolve them by
 * last-wins the moment something does.
 */
export const STYLE_TOGGLE_PROPERTIES: ReadonlySet<string> = new Set([
  'b',
  'bCs',
  'caps',
  'emboss',
  'i',
  'iCs',
  'imprint',
  'outline',
  'shadow',
  'smallCaps',
  'strike',
  'vanish',
]);

/** `CT_OnOff`: a missing `w:val` means true, and only the false spellings mean false. */
export function styleToggleIsOn(property: OoxmlProperty): boolean {
  const value = property.attributes?.val;
  return value === undefined || !(value === '0' || value === 'false' || value === 'off');
}

/**
 * One `w:rPr` from a STYLE, with duplicate toggles reduced to the first instance.
 *
 * `CT_RPr`'s `EG_RPrBase` is a repeatable choice, so `<w:rPr><w:b w:val="0"/><w:b/></w:rPr>`
 * is schema-valid. §17.7.3 resolves a level by reading *the* value in the style, so one
 * `w:rPr` states one value per toggle, and the reader takes the first. Non-toggle properties
 * are untouched and keep last-wins.
 *
 * Returns the input array by identity when there is nothing to drop, which is every real
 * document.
 */
export function firstToggleInstanceWins(
  properties: readonly OoxmlProperty[]
): readonly OoxmlProperty[] {
  let seen: Set<string> | undefined;
  let duplicated = false;
  for (const property of properties) {
    if (!STYLE_TOGGLE_PROPERTIES.has(property.localName)) continue;
    if (!seen) seen = new Set();
    if (seen.has(property.localName)) {
      duplicated = true;
      break;
    }
    seen.add(property.localName);
  }
  if (!duplicated) return properties;
  const kept = new Set<string>();
  return properties.filter((property) => {
    if (!STYLE_TOGGLE_PROPERTIES.has(property.localName)) return true;
    if (kept.has(property.localName)) return false;
    kept.add(property.localName);
    return true;
  });
}

/** One level of the style hierarchy, as {@link combineStyleToggles} reads it. */
export interface StyleToggleLevel {
  /**
   * The level's properties, WEAKEST SOURCE FIRST: `basedOn` base before tip, and a table
   * style's conditional `w:tblStylePr` after its whole-table `w:rPr`. The last instance of a
   * toggle is therefore the first one §17.7.3's tip → base walk reaches, which is why this
   * order is part of the contract rather than an implementation detail.
   */
  readonly properties: readonly OoxmlProperty[];
  /**
   * `defaults` is the document defaults: a true value here IS the effective value and the XOR
   * never runs. `xor` levels (table, paragraph, character) combine by parity.
   */
  readonly role: 'defaults' | 'xor';
  /**
   * Whether this level's NON-toggle properties join the result.
   *
   * The document defaults contribute their ordinary properties once, in the paragraph
   * cascade. The run cascade re-reads them for the short circuit alone, because its inherited
   * level already carries them.
   */
  readonly emit: boolean;
}

/**
 * Combine the levels of the style hierarchy into one property list.
 *
 * Non-toggle properties come through in level order, so the existing last-wins resolvers see
 * what they always saw. Every toggle the levels state is replaced by one resolved property,
 * appended at the end; a toggle that resolves false is simply absent, which is its default.
 */
export function combineStyleToggles(levels: readonly StyleToggleLevel[]): readonly OoxmlProperty[] {
  const ordinary: OoxmlProperty[] = [];
  const forcedOn = new Set<string>();
  const parity = new Map<string, boolean>();
  let sawToggle = false;
  for (const level of levels) {
    // Collected per level first: the parity flip is one value per level, however many styles
    // of that level stated it.
    let levelValues: Map<string, boolean> | undefined;
    for (const property of level.properties) {
      if (!STYLE_TOGGLE_PROPERTIES.has(property.localName)) {
        if (level.emit) ordinary.push(property);
        continue;
      }
      sawToggle = true;
      if (!levelValues) levelValues = new Map();
      // Last instance wins: the array runs weakest source first.
      levelValues.set(property.localName, styleToggleIsOn(property));
    }
    if (!levelValues) continue;
    for (const [localName, on] of levelValues) {
      if (level.role === 'defaults') {
        if (on) forcedOn.add(localName);
        continue;
      }
      if (on) parity.set(localName, !(parity.get(localName) ?? false));
      // A level that states false still counts as a level that stated the property; false
      // XOR anything is the identity, so only its presence has to survive.
      else if (!parity.has(localName)) parity.set(localName, false);
    }
  }
  if (!sawToggle) return ordinary;
  for (const localName of forcedOn) parity.set(localName, true);
  for (const [localName, on] of parity) if (on) ordinary.push({ localName });
  return ordinary;
}
