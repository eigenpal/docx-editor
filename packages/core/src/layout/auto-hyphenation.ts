// `w:settings/w:autoHyphenation` lets Word hyphenate words at the end of a line, and
// `w:pPr/w:suppressAutoHyphens` turns that off for one paragraph. The editor does not paint
// hyphens. But Word measures an autofit column with hyphenation, so a long word does not widen
// the column. The autofit minimum reads these settings so that the column widths match Word.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';

/** Letters of the scripts that Word hyphenates with a dictionary. */
const HYPHENATED_LETTER = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u;
const LETTER = /\p{L}/u;

function isOn(value: string | undefined): boolean {
  return value === undefined || value === '1' || value === 'true' || value === 'on';
}

/** Whether a settings root turns on automatic hyphenation. The last declaration wins. */
export function autoHyphenationFromSettings(root: OoxmlElement | null): boolean {
  let enabled = false;
  for (const child of root?.children ?? []) {
    if (
      child.kind === 'textValue' ||
      child.namespaceUri !== WML_NAMESPACE_URI ||
      child.localName !== 'autoHyphenation'
    )
      continue;
    enabled = isOn(
      child.attributes.find(
        (item) => item.namespaceUri === WML_NAMESPACE_URI && item.localName === 'val'
      )?.value
    );
  }
  return enabled;
}

/** Whether cascaded paragraph properties turn off automatic hyphenation. The last one wins. */
export function paragraphSuppressesAutoHyphens(props: readonly OoxmlProperty[]): boolean {
  let suppressed = false;
  for (const prop of props)
    if (prop.localName === 'suppressAutoHyphens') suppressed = isOn(prop.attributes?.val);
  return suppressed;
}

/**
 * Add a cut between each two adjacent letters to the break opportunities of `text`. Word
 * hyphenates at points from a dictionary. The editor has no dictionary, so it accepts each
 * point between letters, as the line breaker does for a word wider than its line. A cut never
 * comes before a combining mark, so it never splits a grapheme.
 */
export function withHyphenationCuts(text: string, boundaries: readonly number[]): number[] {
  const cuts: number[] = [];
  let next = 0;
  for (let index = 1; index < text.length; index++) {
    while (next < boundaries.length && boundaries[next]! < index) cuts.push(boundaries[next++]!);
    if (boundaries[next] === index) continue;
    const before = text[index - 1]!;
    const after = text[index]!;
    if (
      LETTER.test(before) &&
      LETTER.test(after) &&
      HYPHENATED_LETTER.test(before) &&
      HYPHENATED_LETTER.test(after)
    )
      cuts.push(index);
  }
  while (next < boundaries.length) cuts.push(boundaries[next++]!);
  return cuts;
}
