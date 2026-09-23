import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';

const WORD_COMPATIBILITY_URI = 'http://schemas.microsoft.com/office/word';

/**
 * The Word compatibility mode a document authors, or `undefined` when it authors none.
 *
 * Every mode Word can write is projected, not only the ones a lane happens to branch on.
 * Collapsing an unrecognised mode into `undefined` makes "the author said 16" indistinguishable
 * from "the author said nothing", and those mean opposite things: a document with no
 * `w:compatSetting` gets legacy geometry, while one declaring 16 is modern. Word 2019 and
 * Microsoft 365 write 16, so conflating them put legacy table geometry on the most common
 * document there is. `exact-line-baseline.ts` already draws this distinction by reading the
 * element's presence directly, and callers should not have to.
 *
 * `undefined` therefore means absent, duplicated (ambiguous, so no winner is invented), or
 * malformed. A value below Word's first mode is not a mode and reads as absent.
 */
export function compatibilityModeFromSettings(root: OoxmlElement | null): number | undefined {
  if (!root || root.namespaceUri !== WML_NAMESPACE_URI || root.localName !== 'settings') {
    return undefined;
  }
  let result: number | undefined;
  let found = false;
  for (const compat of root.children) {
    if (
      compat.kind === 'textValue' ||
      compat.namespaceUri !== WML_NAMESPACE_URI ||
      compat.localName !== 'compat'
    )
      continue;
    for (const setting of compat.children) {
      if (
        setting.kind === 'textValue' ||
        setting.namespaceUri !== WML_NAMESPACE_URI ||
        setting.localName !== 'compatSetting'
      )
        continue;
      const attribute = (name: string): string | undefined =>
        setting.attributes.find(
          (item) => item.namespaceUri === WML_NAMESPACE_URI && item.localName === name
        )?.value;
      if (attribute('name') !== 'compatibilityMode' || attribute('uri') !== WORD_COMPATIBILITY_URI)
        continue;
      // Duplicate/conflicting declarations are ambiguous; do not invent a winner.
      if (found) return undefined;
      found = true;
      const value = attribute('val');
      // Bounded digits only: the value comes from a file and must not become an unbounded
      // number. Word's first compatibility mode is 11; anything below it is not one.
      const parsed = value !== undefined && /^\d{1,4}$/.test(value) ? Number(value) : undefined;
      result = parsed !== undefined && parsed >= 11 ? parsed : undefined;
    }
  }
  return result;
}

/**
 * Whether a document lays out in Word 2013 or later mode (15+). An absent mode is legacy,
 * never modern; see {@link compatibilityModeFromSettings}.
 */
export function isWord2013OrLaterMode(compatibilityMode: number | undefined): boolean {
  return compatibilityMode !== undefined && compatibilityMode >= 15;
}
