// Text that `w:noBreakHyphen` and `w:softHyphen` stand for in read text.
//
// Both elements are preserved generic nodes with no model offset width. Read text still shows
// them as the characters a text read of the same paragraph returns: U+001E for a non-breaking
// hyphen and U+001F for an optional hyphen. Search folds them like typed text does: a hyphen
// matches U+001E, and U+001F matches nothing.

import { WML_NAMESPACE_URI, type OoxmlNode } from './ooxml-tree.ts';

/** Read-text character for `w:noBreakHyphen`. */
export const NON_BREAKING_HYPHEN_TEXT = '\u001e';
/** Read-text character for `w:softHyphen`. */
export const OPTIONAL_HYPHEN_TEXT = '\u001f';

/** The read-text character of a hyphen element, or null for any other node. */
export function hyphenTextOf(node: OoxmlNode): string | null {
  if (node.kind === 'textValue' || node.namespaceUri !== WML_NAMESPACE_URI) return null;
  if (node.localName === 'noBreakHyphen') return NON_BREAKING_HYPHEN_TEXT;
  if (node.localName === 'softHyphen') return OPTIONAL_HYPHEN_TEXT;
  return null;
}
