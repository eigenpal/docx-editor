// Toggle properties of the style hierarchy (ECMA-376 §17.7.3).
//
// A toggle property is the one class of run property that does NOT resolve by last-wins.
// §17.7.3 gives the shape of the rule:
//
//   "If the value specified by the document defaults is true, the effective value is true.
//   Otherwise, the values are combined by a Boolean XOR as follows:
//   value_effective = val_table XOR val_paragraph XOR val_character."
//
// and it resolves ONE level through its `basedOn` chain, not one value per style:
//
//   "If multiple instances of the toggle property appear at the same level of the style
//   hierarchy, then the first value encountered by the following algorithm shall be used ...
//   Attempt to read the value in the style. If it does not exist and the style has a basedOn
//   element with a non-empty value, repeat step 1 using the style specified by the basedOn
//   element."
//
// So three values enter the combination, and a whole `basedOn` chain contributes one of them.
// Combining a chain by parity instead is what made an ordinary Word edit — re-tick bold on a
// style whose base is already bold — come back unbold.
//
// A LEVEL IS TRI-STATE: on, off, or absent. The spec's XOR sentence is worked through with
// true values only and says nothing about what an explicit `w:val="0"` at a level does, so the
// behaviour is settled by the implementations instead, and they agree: LibreOffice renders
// `docDefaults <w:b/>` + a character style `<w:b w:val="0"/>` as regular, and Word's own
// authoring corroborates the split — a "Not Bold" character style over a bold paragraph style
// is spelled `<w:b/>`, because the toggle is how you cancel, which leaves `w:val="0"` meaning
// an explicit off. So:
//
//   absent  falls through; the level is not part of the combination at all
//   on      REVERSES the state the weaker levels resolved to (this is the XOR)
//   off     SETS the state off, and clears the document defaults' short circuit with it
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
   * `defaults` is the document defaults: a true value there IS the effective value, and it
   * stays so through any number of `on` levels. `xor` levels (table, paragraph, character)
   * reverse the state below them.
   *
   * `carried` is not a level at all: it is the ACCUMULATED state of the levels below, handed
   * over by an earlier {@link combineStyleToggles} call. The paragraph cascade resolves the
   * defaults, table and paragraph levels before the run cascade knows which character style a
   * run names, and the two halves have to agree about more than the resolved value — whether
   * the document defaults' short circuit is still standing decides what the character level's
   * `on` does next. A `carried` level whose properties were not produced here (a caller that
   * assembles its own list) is read as one `xor` level instead, which is the most a bare
   * property list can say.
   */
  readonly role: 'defaults' | 'xor' | 'carried';
  /**
   * Whether this level's NON-toggle properties join the result.
   *
   * The document defaults contribute their ordinary properties once, in the paragraph
   * cascade. The run cascade re-reads them for their toggle values alone, because its
   * inherited level already carries the ordinary ones.
   */
  readonly emit: boolean;
}

interface ToggleState {
  /** The effective value after every level processed so far. */
  readonly value: boolean;
  /**
   * The document defaults said true and no level has stated a value since.
   *
   * §17.7.3: "If the value specified by the document defaults is true, the effective value is
   * true." That outranks the parity of the `on` levels, so it has to survive them; an
   * explicit `off` at a level is a value the level STATES, and it clears the short circuit.
   */
  readonly forced: boolean;
}

/**
 * The state {@link combineStyleToggles} resolved, against the exact array it returned.
 *
 * A side channel and not a return value, because the array travels through
 * `ParagraphLayoutInputs`, the paragraph layout cache key and the line breaker's inherited
 * property closure before the run cascade sees it again, and threading a second value through
 * all of that would put a field nobody reads into the fragment signature. Keyed on the array
 * OBJECT, so only a list this module built can be mistaken for one, and released with it.
 */
const statesByOutput = new WeakMap<readonly OoxmlProperty[], ReadonlyMap<string, ToggleState>>();

/**
 * Combine the levels of the style hierarchy into one property list.
 *
 * Non-toggle properties come through in level order, so the existing last-wins resolvers see
 * what they always saw. Every toggle ANY level stated is replaced by one resolved property
 * appended at the end, written EXPLICITLY — `<w:b/>` for on, `<w:b w:val="0"/>` for off — so
 * a consumer that only ever reads the list still sees the difference between "a level turned
 * this off" and "nobody mentioned it".
 */
export function combineStyleToggles(levels: readonly StyleToggleLevel[]): readonly OoxmlProperty[] {
  const ordinary: OoxmlProperty[] = [];
  // Allocated only once a toggle actually turns up. Most documents state none at style level,
  // and this runs for every paragraph of every layout pass.
  let resolved: Map<string, ToggleState> | undefined;
  for (const level of levels) {
    const carried = level.role === 'carried' ? statesByOutput.get(level.properties) : undefined;
    // Collected per level first: one value per level, however many styles of that level
    // stated it. Last instance wins, because the array runs weakest source first.
    let levelValues: Map<string, boolean> | undefined;
    for (const property of level.properties) {
      if (!STYLE_TOGGLE_PROPERTIES.has(property.localName)) {
        if (level.emit) ordinary.push(property);
        continue;
      }
      // A carried level's toggle properties are the previous call's OUTPUT, and its states say
      // everything they do and more. They are dropped here and re-emitted from the state.
      if (carried) continue;
      if (!levelValues) levelValues = new Map();
      levelValues.set(property.localName, styleToggleIsOn(property));
    }
    if (carried) {
      // Adopt, do not combine: this is the state the levels below already resolved to.
      if (carried.size > 0) {
        if (!resolved) resolved = new Map();
        for (const [localName, state] of carried) resolved.set(localName, state);
      }
      continue;
    }
    if (!levelValues) continue;
    if (!resolved) resolved = new Map();
    for (const [localName, on] of levelValues) {
      const state = resolved.get(localName);
      if (!on) {
        // An explicit off IS this level's value: it sets the state and outranks a true
        // document default, exactly as the base branch and LibreOffice both resolve it.
        resolved.set(localName, { value: false, forced: false });
      } else if (level.role === 'defaults') {
        resolved.set(localName, { value: true, forced: true });
      } else {
        resolved.set(localName, {
          value: state?.forced === true ? true : !(state?.value ?? false),
          forced: state?.forced === true,
        });
      }
    }
  }
  if (!resolved) return ordinary;
  for (const [localName, state] of resolved) {
    ordinary.push(state.value ? { localName } : { localName, attributes: { val: '0' } });
  }
  statesByOutput.set(ordinary, resolved);
  return ordinary;
}
