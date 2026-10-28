// OOXML East Asian typography policy. Settings travel with the style cascade so its
// producer fingerprint invalidates all stories when document typography changes.
// References: ECMA-376 §17.3.1.16, §17.3.1.21, §17.15.1.18, §17.15.1.58–59, §17.15.1.82.
import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import { isEastAsianFace } from '../store/package/default-font-faces.ts';
import { omittedDocDefaults } from '../store/package/application-doc-defaults.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import { resolveRunStyle, type ThemeFonts } from './run-style.ts';

/** Document-wide East Asian line-break and whitespace policy. @public */
export interface CjkTypographySettings {
  /** Apply the strict Japanese small-kana and prolonged-sound-mark restrictions. */
  readonly strict: boolean;
  /** Disable adjacent full-width punctuation compression when false. */
  readonly punctuationKerning?: boolean;
  /** The document defaults explicitly select an East Asian face as the East Asian font. */
  readonly sourceEastAsianFont?: boolean;
  /**
   * False when the document defaults turn off inter-character East Asian justification on
   * justified lines and automatic spacing between East Asian and other text
   * ({@link defaultsTypography}). Absent means both apply.
   * @internal
   */
  readonly eastAsianSpacing?: false;
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
  /** Authored `w:overflowPunct` switch. */
  readonly overflowPunctuation: boolean;
  /**
   * Line-end punctuation may hang past the margin: the authored switch is on, the paragraph is
   * justified, and the document defaults name an East Asian face (`sourceEastAsianFont`).
   * Absent (no paragraph properties resolved) means the authored switch decides.
   */
  readonly hangingPunctuation?: boolean;
  readonly characterWrap: boolean;
  /** Automatic spacing at number/East Asian boundaries; absent means enabled. */
  readonly autoSpaceDN?: boolean;
  /** Automatic spacing at Latin/East Asian boundaries; absent means enabled. */
  readonly autoSpaceDE?: boolean;
  /**
   * Automatic spacing opens only beside East Asian text whose run authors an East Asian font
   * (`ResolvedRunStyle.eastAsianFontAuthored`): a distributed paragraph whose document defaults
   * turn East Asian spacing off.
   * @internal
   */
  readonly automaticSpacingNeedsEastAsianFont?: true;
}

export const DEFAULT_CJK_TYPOGRAPHY: CjkParagraphTypography = Object.freeze({
  kinsoku: true,
  overflowPunctuation: true,
  characterWrap: false,
});

const on = (value: string | undefined): boolean => !['0', 'false', 'off'].includes(value ?? '');
// The `w:jc` values that justify a line (see `paragraphAlignment`).
const JUSTIFIED = new Set([
  'both',
  'distribute',
  'lowKashida',
  'mediumKashida',
  'highKashida',
  'thaiDistribute',
]);
export function cjkTypographyFromSettings(root: OoxmlElement | null): CjkTypographySettings {
  let strict = false;
  let punctuationKerning = true;
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
    if (child.localName === 'noPunctuationKerning') punctuationKerning = !on(value);
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
    punctuationKerning,
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
  let justified = false;
  let distributed = false;
  let autoSpaceDN = true;
  let autoSpaceDE = true;
  for (const prop of props) {
    if (prop.localName === 'autoSpaceDN') autoSpaceDN = on(prop.attributes?.val);
    if (prop.localName === 'autoSpaceDE') autoSpaceDE = on(prop.attributes?.val);
    if (prop.localName === 'kinsoku') kinsoku = on(prop.attributes?.val);
    if (prop.localName === 'overflowPunct') overflowPunctuation = on(prop.attributes?.val);
    if (prop.localName === 'wordWrap') characterWrap = !on(prop.attributes?.val);
    if (prop.localName === 'jc') {
      justified = JUSTIFIED.has(prop.attributes?.val ?? '');
      distributed = prop.attributes?.val === 'distribute';
    }
  }
  // Document defaults that turn East Asian spacing off override the paragraph switches. A
  // distributed paragraph, which then spreads every character, keeps automatic spacing beside
  // runs that author an East Asian font.
  const spacingOff = settings?.eastAsianSpacing === false;
  if (spacingOff && !distributed) autoSpaceDN = autoSpaceDE = false;
  // Punctuation hangs only in justified paragraphs, full-width and Latin alike. Left, centered,
  // and right-aligned lines keep line-end punctuation inside the margin. A document whose
  // defaults name no East Asian face hangs no punctuation at all.
  return {
    settings,
    kinsoku,
    overflowPunctuation,
    hangingPunctuation: overflowPunctuation && justified && settings?.sourceEastAsianFont === true,
    characterWrap,
    autoSpaceDN,
    autoSpaceDE,
    ...(spacingOff && distributed ? { automaticSpacingNeedsEastAsianFont: true as const } : {}),
  };
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

/**
 * Whether the authored document defaults select an East Asian face as the East Asian font.
 * Adjacent full-width punctuation compression needs one. Only `w:rPrDefault` counts: an
 * application or theme fallback alone does not. The resolved face must be a Chinese,
 * Japanese, or Korean font (`isEastAsianFace`). An empty theme slot resolves to a built-in
 * East Asian face.
 */
export function defaultsSelectEastAsianFace(
  defaultRun: readonly OoxmlProperty[],
  themeFonts: ThemeFonts
): boolean {
  if (!namesEastAsianFont(defaultRun)) return false;
  const face = resolveRunStyle(defaultRun, themeFonts).fontFamilyEastAsia;
  return isEastAsianFace(face, themeFonts.eastAsianFontTableFaces);
}

/** Whether run defaults name an East Asian face slot (`w:eastAsia` or `w:eastAsiaTheme`). */
function namesEastAsianFont(defaultRun: readonly OoxmlProperty[]): boolean {
  return defaultRun.some(
    (prop) =>
      prop.localName === 'rFonts' &&
      Boolean(prop.attributes?.eastAsia || prop.attributes?.eastAsiaTheme)
  );
}

/**
 * The East Asian typography the styles part's document defaults select. East Asian spacing
 * (inter-character justification on justified lines, and automatic spacing between East Asian
 * and other text) applies when the styles part omits `w:rPrDefault`, or when `w:rPrDefault`
 * names an East Asian font in `w:rFonts`. Any other `w:rPrDefault`, even an empty one, turns
 * it off, in every compatibility mode. Fonts set on styles or runs do not count.
 */
export function defaultsTypography(
  stylesRoot: OoxmlElement,
  defaultRun: readonly OoxmlProperty[],
  themeFonts: ThemeFonts
): Pick<CjkTypographySettings, 'sourceEastAsianFont' | 'eastAsianSpacing'> {
  const sourceEastAsianFont = defaultsSelectEastAsianFace(defaultRun, themeFonts);
  const spacing =
    stylesRoot.namespaceUri !== WML_NAMESPACE_URI ||
    omittedDocDefaults(stylesRoot).run ||
    namesEastAsianFont(defaultRun);
  return spacing ? { sourceEastAsianFont } : { sourceEastAsianFont, eastAsianSpacing: false };
}
