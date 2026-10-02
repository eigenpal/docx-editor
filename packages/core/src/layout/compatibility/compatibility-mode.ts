// The Word compatibility mode a document declares, read once and classified.
//
// `w:settings/w:compat/w:compatSetting` with `w:name="compatibilityMode"` and
// `w:uri="http://schemas.microsoft.com/office/word"` names the feature set in use when the
// document was last saved ([MS-DOCX] 2.3.5). Its `w:val` is an `ST_UnsignedDecimalNumber`:
//
// - 11: the features of the binary format [MS-DOC] (Word 2003, `wdWord2003`).
// - 12: the features of ECMA-376 (Word 2007, `wdWord2007`). [MS-DOCX] names 12 the default,
//   which is why an absent declaration reads as legacy.
// - 14: ISO/IEC 29500 plus the [MS-DOCX] extensions, less those added after Word 2010
//   (Word 2010, `wdWord2010`).
// - 15: ISO/IEC 29500 plus every [MS-DOCX] extension (Word 2013, `wdWord2013`). [MS-DOCX]
//   Appendix B lists Word 2013, 2016, 2019, 2021 and LTSC 2024, and documents no value above
//   15. The Word object model's `WdCompatibilityMode` also ends at `wdWord2013 = 15`
//   ("Default. All Word features are enabled"); its `wdCurrent = 65535` is an API alias for
//   "the running version", not a value Word writes. So Word 2013 and later write 15.
//
// Word 2010 ignores a declaration of 15 ([MS-DOCX] Appendix B note 13). No Microsoft source
// defines 13 or anything above 15, but other producers write them. Word 16 for Mac lays out a
// document with no declaration exactly as one that declares 12, and one that declares 16
// exactly as one that declares 15, in table and footnote probe documents. Declarations of 17,
// 99 and 9999 lay out as 15 in the table probes. Word reports a document that declares 13 as
// unreadable content and offers to recover it. So a value above 15 lays out as 15 here, and 13 is unlisted and lays out with
// no rule that names a mode (see `compatibility-rules.ts`).
//
// Sources:
// - [MS-DOCX] 2.3.5 compatibilityMode:
//   https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/90138c4d-eb18-4edc-aa6c-dfb799cb1d0d
// - [MS-DOCX] Appendix B, Product Behavior:
//   https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/11e00e62-c73a-4371-93d5-cddcc63fcbf0
// - WdCompatibilityMode enumeration:
//   https://learn.microsoft.com/en-us/office/vba/api/word.wdcompatibilitymode
// - ECMA-376 Part 1 §17.15.3.4 compatSetting (implementation-defined custom setting).

import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';

/** The `w:uri` every Word-defined `w:compatSetting` carries. */
export const WORD_COMPAT_SETTING_URI = 'http://schemas.microsoft.com/office/word';

/** The mode values Microsoft documents, oldest first. */
export const KNOWN_WORD_COMPATIBILITY_MODES = [11, 12, 14, 15] as const;

/** A documented mode value. */
export type KnownWordCompatibilityMode = (typeof KNOWN_WORD_COMPATIBILITY_MODES)[number];

/**
 * What a document's settings say about its compatibility mode.
 *
 * - `absent`: no declaration, or no settings part. [MS-DOCX] makes 12 the default.
 * - `refused`: declared, but unusable. `duplicate` means two declarations, which is ambiguous,
 *   so no winner is invented. `malformed` means a value that is not 1 to 4 digits, or is below
 *   11, Word's first mode.
 * - `known`: one of {@link KNOWN_WORD_COMPATIBILITY_MODES}.
 * - `unknown`: any other bounded value: 13, or a value above 15.
 */
export type WordCompatibilityMode =
  | { readonly kind: 'absent' }
  | { readonly kind: 'refused'; readonly reason: 'duplicate' | 'malformed' }
  | { readonly kind: 'known'; readonly value: KnownWordCompatibilityMode }
  | { readonly kind: 'unknown'; readonly value: number };

/**
 * The classes layout rules are declared over. Every mode value maps to exactly one class.
 *
 * `newer` is every value above 15: a mode newer than this engine knows lays out as modern.
 * `unlisted` is a value between known modes (13). A refused declaration has no class of its
 * own: it lays out as `absent`, because layout threads only the mode value.
 */
export type CompatibilityModeClass =
  | 'absent'
  | 'word2003'
  | 'word2007'
  | 'word2010'
  | 'word2013'
  | 'unlisted'
  | 'newer';

/** Every class, oldest first. Tables and tests iterate in this order. */
export const COMPATIBILITY_MODE_CLASSES: readonly CompatibilityModeClass[] = Object.freeze([
  'absent',
  'word2003',
  'word2007',
  'word2010',
  'word2013',
  'unlisted',
  'newer',
]);

const ABSENT: WordCompatibilityMode = Object.freeze({ kind: 'absent' });
const DUPLICATE: WordCompatibilityMode = Object.freeze({ kind: 'refused', reason: 'duplicate' });
const MALFORMED: WordCompatibilityMode = Object.freeze({ kind: 'refused', reason: 'malformed' });

function isKnownMode(value: number): value is KnownWordCompatibilityMode {
  return (KNOWN_WORD_COMPATIBILITY_MODES as readonly number[]).includes(value);
}

/** Read one `w:`-namespaced attribute; a prefix alone never matches. */
export function wordAttribute(element: OoxmlElement, localName: string): string | undefined {
  return element.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
  )?.value;
}

/** Whether `root` is a `w:settings` element (namespace URI, not prefix). */
export function isSettingsRoot(root: OoxmlElement | null): root is OoxmlElement {
  return !!root && root.namespaceUri === WML_NAMESPACE_URI && root.localName === 'settings';
}

/** Classify one declared `w:val`. Bounded digits only: the value comes from a file. */
export function classifyCompatibilityModeValue(raw: string | undefined): WordCompatibilityMode {
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return MALFORMED;
  const value = Number(raw);
  if (value < 11) return MALFORMED;
  return isKnownMode(value) ? { kind: 'known', value } : { kind: 'unknown', value };
}

/**
 * Read the declared mode from a settings root. Walks every `w:compat` child and every
 * `w:compatSetting` in it; a second declaration refuses the whole reading.
 */
export function readWordCompatibilityMode(root: OoxmlElement | null): WordCompatibilityMode {
  if (!isSettingsRoot(root)) return ABSENT;
  let result: WordCompatibilityMode = ABSENT;
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
      if (
        wordAttribute(setting, 'name') !== 'compatibilityMode' ||
        wordAttribute(setting, 'uri') !== WORD_COMPAT_SETTING_URI
      )
        continue;
      // Duplicate/conflicting declarations are ambiguous; do not invent a winner.
      if (result !== ABSENT) return DUPLICATE;
      result = classifyCompatibilityModeValue(wordAttribute(setting, 'val'));
    }
  }
  return result;
}

/**
 * The mode value layout threads through its options and cache keys: the declared number, or
 * `undefined` when the declaration is absent or refused.
 */
export function compatibilityModeValue(mode: WordCompatibilityMode): number | undefined {
  return mode.kind === 'known' || mode.kind === 'unknown' ? mode.value : undefined;
}

/**
 * The Word compatibility mode a document authors, or `undefined` when it authors none.
 *
 * Every bounded value is reported, not only the documented ones, so "the author said 16" stays
 * distinct from "the author said nothing". `undefined` means absent, duplicated (ambiguous, so
 * no winner is invented), or malformed. A value below Word's first mode is not a mode and
 * reads as absent. Branch on the result only through `hasCompatibilityRule`.
 */
export function compatibilityModeFromSettings(root: OoxmlElement | null): number | undefined {
  return compatibilityModeValue(readWordCompatibilityMode(root));
}

/** The class a threaded mode value belongs to. */
export function compatibilityModeClass(value: number | undefined): CompatibilityModeClass {
  switch (value) {
    case undefined:
      return 'absent';
    case 11:
      return 'word2003';
    case 12:
      return 'word2007';
    case 14:
      return 'word2010';
    case 15:
      return 'word2013';
    default:
      return value > 15 ? 'newer' : 'unlisted';
  }
}
