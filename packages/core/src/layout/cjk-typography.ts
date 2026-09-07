// OOXML East Asian typography policy. Settings travel with the style cascade so its
// producer fingerprint invalidates all stories when document typography changes.
// References: ECMA-376 §17.3.1.16, §17.3.1.21, §17.15.1.18, §17.15.1.58–59, §17.15.1.82.
import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';

/** Document-wide East Asian line-break and whitespace policy. @public */
export interface CjkTypographySettings {
  /** Apply the strict Japanese small-kana and prolonged-sound-mark restrictions. */
  readonly strict: boolean;
  /** Whitespace compression selected by `w:characterSpacingControl`. */
  readonly compression:
    | 'doNotCompress'
    | 'compressPunctuation'
    | 'compressPunctuationAndJapaneseKana';
  /** Custom no-line-start characters, keyed by normalized language tag. */
  readonly before: Readonly<Record<string, string>>;
  /** Custom no-line-end characters, keyed by normalized language tag. */
  readonly after: Readonly<Record<string, string>>;
}

export interface CjkParagraphTypography {
  readonly settings?: CjkTypographySettings;
  readonly kinsoku: boolean;
  readonly overflowPunctuation: boolean;
  readonly characterWrap: boolean;
}

export const DEFAULT_CJK_TYPOGRAPHY: CjkParagraphTypography = Object.freeze({
  kinsoku: true,
  overflowPunctuation: true,
  characterWrap: false,
});

const on = (value: string | undefined): boolean => !['0', 'false', 'off'].includes(value ?? '');
export function cjkTypographyFromSettings(root: OoxmlElement | null): CjkTypographySettings {
  let strict = false;
  let compression: CjkTypographySettings['compression'] = 'doNotCompress';
  const before: Record<string, string> = Object.create(null);
  const after: Record<string, string> = Object.create(null);
  for (const child of root?.children ?? []) {
    if (!('localName' in child)) continue;
    if (child.namespaceUri !== 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
      continue;
    const value = child.attributes.find(
      (attribute) => attribute.localName === 'val' && attribute.namespaceUri === child.namespaceUri
    )?.value;
    if (child.localName === 'strictFirstAndLastChars') strict = on(value);
    if (
      child.localName === 'characterSpacingControl' &&
      (value === 'doNotCompress' ||
        value === 'compressPunctuation' ||
        value === 'compressPunctuationAndJapaneseKana')
    )
      compression = value;
    if (child.localName !== 'noLineBreaksBefore' && child.localName !== 'noLineBreaksAfter')
      continue;
    const language = child.attributes
      .find(
        (attribute) =>
          attribute.localName === 'lang' && attribute.namespaceUri === child.namespaceUri
      )
      ?.value.toLowerCase();
    // Bound file-derived policy storage independently of XML parser limits.
    if (!language || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/.test(language)) continue;
    const target = child.localName === 'noLineBreaksBefore' ? before : after;
    if (Object.keys(target).length < 64 || Object.hasOwn(target, language))
      target[language] = (value ?? '').slice(0, 4096);
  }
  return Object.freeze({
    strict,
    compression,
    before: Object.freeze(before),
    after: Object.freeze(after),
  });
}

export function resolveCjkTypography(
  props: readonly OoxmlProperty[],
  settings?: CjkTypographySettings
): CjkParagraphTypography {
  let { kinsoku, overflowPunctuation, characterWrap } = DEFAULT_CJK_TYPOGRAPHY;
  for (const prop of props) {
    if (prop.localName === 'kinsoku') kinsoku = on(prop.attributes?.val);
    if (prop.localName === 'overflowPunct') overflowPunctuation = on(prop.attributes?.val);
    if (prop.localName === 'wordWrap') characterWrap = !on(prop.attributes?.val);
  }
  return { settings, kinsoku, overflowPunctuation, characterWrap };
}

export function eastAsianLanguage(props: readonly OoxmlProperty[]): string | undefined {
  let language: string | undefined;
  for (const prop of props) {
    if (prop.localName !== 'lang') continue;
    const value = prop.attributes?.eastAsia ?? prop.attributes?.val;
    if (value && /^(ja|zh|ko)(-|$)/i.test(value)) language = value.toLowerCase();
  }
  return language;
}

// Language-specific default tables from §17.3.1.16. Custom sets replace one direction.
const JA_BEFORE = '!%),.:;?]}¢°’”‰′″℃、。々〉》」』】〕゛゜ゝゞ・ヽヾ！％），．：；？］｝｡｣､･ﾞﾟ￠';
const JA_AFTER = '$([\\{£¥‘“〈《「『【〔＄（［｛｢￡￥';
const ZH_BEFORE =
  '!%),.:;>?]}¢¨°·ˇˉ―‖’”…‰′″›℃∶、。〃〉》」』】〕〗〞︶︺︾﹀﹄﹚﹜﹞！＂％＇），．：；？］｀｜｝～￠';
const ZH_AFTER = '$([{£¥·‘“〈《「『【〔〖〝﹙﹛﹝＄（．［｛￡￥';
const ZH_TRAD_BEFORE =
  '! ),.:;?]}¢·–—’”•‥…‧′╴、。〉》」』】〕〞︰︱︳︴︶︸︺︼︾﹀﹂﹄﹏﹐﹑﹒﹔﹕﹖﹗﹚﹜﹞！），．：；？］｜｝､'.replace(
    ' ',
    ''
  );
const ZH_TRAD_AFTER = '([{£¥‘“‵〈《「『【〔〝︵︷︹︻︽︿﹁﹃﹙﹛﹝（｛';
const KO_BEFORE = '!%),.:;?]}¢°’”′″℃〉》」』】〕！％），．：；？］｝￠';
const KO_AFTER = '$([\\{£¥‘“〈《「『【〔＄（［｛￡￥￦';
export const STRICT_KANA = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶーｧｨｩｪｫｬｭｮｯｰ';

export function kinsokuCharacters(
  language: string,
  settings?: CjkTypographySettings
): { before: string; after: string } {
  const family = language.split('-')[0];
  const traditional = /^zh-(tw|hk|mo|hant)(-|$)/.test(language);
  let before =
    family === 'zh'
      ? traditional
        ? ZH_TRAD_BEFORE
        : ZH_BEFORE
      : family === 'ko'
        ? KO_BEFORE
        : JA_BEFORE;
  let after =
    family === 'zh'
      ? traditional
        ? ZH_TRAD_AFTER
        : ZH_AFTER
      : family === 'ko'
        ? KO_AFTER
        : JA_AFTER;
  if (family === 'ja' && settings?.strict) before += STRICT_KANA;
  before = settings?.before[language] ?? before;
  after = settings?.after[language] ?? after;
  return { before, after };
}
