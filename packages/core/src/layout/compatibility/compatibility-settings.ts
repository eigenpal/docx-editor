// The `w:compat` children of `settings.xml`: every legacy on/off option and every Word-defined
// `w:compatSetting`, as typed catalogs, and one bounded walk that reads them.
//
// Legacy options are `CT_OnOff` children of `w:compat`. Seven are in the strict schema
// (ECMA-376 Part 1 §17.15.3); the rest are transitional migration features (ECMA-376 Part 4
// §14.8.3). Word also stores named settings as `w:compatSetting` with the Word URI
// ([MS-DOCX] 2.3). No source says a compatibility mode implies a legacy option: Word writes
// each option it applies explicitly, so the engine reads only what the file states.
//
// File input is attacker-controlled. The walk visits each `w:compat` child once, keys every
// result by a name from the fixed catalogs below (never by a file string), and reads values as
// bounded string comparisons.

import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import { WORD_COMPAT_SETTING_URI, isSettingsRoot, wordAttribute } from './compatibility-mode.ts';

/**
 * How a reader turns an `ST_OnOff` `w:val` into a boolean.
 *
 * - `on-or-missing`: on for a missing value or `1`, `true`, `on`; anything else is off.
 * - `not-off`: off only for `0`, `false`, `off`; anything else, missing included, is on.
 * - `explicit-on`: on only for `1`, `true`, `on`; a missing value is off.
 */
export type OnOffReading = 'on-or-missing' | 'not-off' | 'explicit-on';

/** How a reader chooses among repeated options. */
export type RepeatReading =
  /** The last occurrence in any `w:compat` child wins. */
  | 'last'
  /** Only the first occurrence in the first `w:compat` child counts. */
  | 'first-compat-first'
  /** A second `w:compatSetting` of the same name makes the setting ambiguous. */
  | 'refuse-duplicates';

/** One cataloged option: where it is specified and how the engine reads it. */
export interface CompatOptionSpec {
  /** Specification section that defines the option. */
  readonly source: string;
  /** One-line summary of what the option asks for. */
  readonly summary: string;
  readonly onOff: OnOffReading;
  readonly repeat: RepeatReading;
}

const PART1 = 'ECMA-376 Part 1 §17.15.3';
const PART4 = 'ECMA-376 Part 4 §14.8.3';

function legacy(section: string, summary: string, overrides?: Partial<CompatOptionSpec>) {
  return Object.freeze({
    source: section,
    summary,
    onOff: 'on-or-missing',
    repeat: 'last',
    ...overrides,
  }) satisfies CompatOptionSpec;
}

/**
 * Every legacy `w:compat` option. The reading of an option a rule consults is the reading its
 * original reader used; the others use the default (`last`, `on-or-missing`).
 */
export const LEGACY_COMPAT_OPTIONS = Object.freeze({
  adjustLineHeightInTable: legacy(
    `${PART1}.1`,
    'Add document grid line pitch to lines in table cells',
    {
      onOff: 'not-off',
    }
  ),
  applyBreakingRules: legacy(`${PART1}.2`, 'Use legacy Ethiopic and Amharic line breaking rules'),
  balanceSingleByteDoubleByteWidth: legacy(
    `${PART1}.3`,
    'Balance single byte and double byte characters'
  ),
  doNotExpandShiftReturn: legacy(`${PART1}.5`, 'Do not justify lines ending in a soft line break'),
  doNotLeaveBackslashAlone: legacy(`${PART1}.6`, 'Display backslash as yen sign'),
  spaceForUL: legacy(`${PART1}.7`, 'Add space below baseline for underlined East Asian text'),
  ulTrailSpace: legacy(`${PART1}.8`, 'Underline all trailing spaces'),
  alignTablesRowByRow: legacy(`${PART4}.1`, 'Align table rows independently'),
  allowSpaceOfSameStyleInTable: legacy(
    `${PART4}.2`,
    'Allow contextual spacing of paragraphs in tables'
  ),
  autofitToFirstFixedWidthCell: legacy(
    `${PART4}.3`,
    'Allow table columns to exceed preferred widths of constituent cells'
  ),
  autoSpaceLikeWord95: legacy(`${PART4}.4`, 'Adjust text spacing for specific Unicode ranges'),
  cachedColBalance: legacy(`${PART4}.5`, 'Use cached paragraph information for column balancing'),
  convMailMergeEsc: legacy(
    `${PART4}.6`,
    'Treat backslash quotation delimiter as two quotation marks'
  ),
  displayHangulFixedWidth: legacy(`${PART4}.7`, 'Always use fixed width for Hangul characters'),
  doNotAutofitConstrainedTables: legacy(
    `${PART4}.8`,
    'Do not AutoFit tables to fit next to wrapped objects'
  ),
  doNotBreakConstrainedForcedTable: legacy(
    `${PART4}.9`,
    'Do not break table rows around floating tables'
  ),
  doNotBreakWrappedTables: legacy(
    `${PART4}.10`,
    'Do not allow floating tables to break across pages',
    {
      repeat: 'first-compat-first',
    }
  ),
  doNotSnapToGridInCell: legacy(
    `${PART4}.11`,
    'Do not snap to document grid in table cells with objects'
  ),
  doNotSuppressIndentation: legacy(
    `${PART4}.12`,
    'Do not ignore floating objects when calculating paragraph indentation'
  ),
  doNotSuppressParagraphBorders: legacy(
    `${PART4}.13`,
    'Do not suppress paragraph borders next to frames'
  ),
  doNotUseEastAsianBreakRules: legacy(
    `${PART4}.14`,
    'Do not compress compressible characters when using document grid'
  ),
  doNotUseHTMLParagraphAutoSpacing: legacy(
    `${PART4}.15`,
    'Use fixed paragraph spacing for HTML auto setting',
    {
      repeat: 'first-compat-first',
    }
  ),
  doNotUseIndentAsNumberingTabStop: legacy(
    `${PART4}.16`,
    'Ignore hanging indent when creating tab stop after numbering',
    {
      repeat: 'first-compat-first',
    }
  ),
  doNotVertAlignCellWithSp: legacy(
    `${PART4}.17`,
    'Do not vertically align cells containing floating objects'
  ),
  doNotVertAlignInTxbx: legacy(`${PART4}.18`, 'Ignore vertical alignment in text boxes'),
  doNotWrapTextWithPunct: legacy(
    `${PART4}.19`,
    'Do not allow hanging punctuation with character grid'
  ),
  footnoteLayoutLikeWW8: legacy(`${PART4}.20`, 'Ignore page break from continuous section break'),
  forgetLastTabAlignment: legacy(
    `${PART4}.21`,
    'Ignore width of last tab stop when aligning paragraph if it is not left aligned'
  ),
  growAutofit: legacy(`${PART4}.22`, 'Allow tables to AutoFit into page margins'),
  layoutRawTableWidth: legacy(
    `${PART4}.23`,
    'Ignore space before table when deciding if table should wrap floating object'
  ),
  layoutTableRowsApart: legacy(
    `${PART4}.24`,
    'Allow table rows to wrap inline objects independently'
  ),
  lineWrapLikeWord6: legacy(
    `${PART4}.25`,
    'Ignore compression of full-width punctuation ending a line'
  ),
  mwSmallCaps: legacy(`${PART4}.26`, 'Use specific small caps algorithm'),
  noColumnBalance: legacy(`${PART4}.27`, 'Do not balance text columns within a section'),
  noExtraLineSpacing: legacy(
    `${PART4}.28`,
    'Do not center content on lines with exact line height'
  ),
  noLeading: legacy(`${PART4}.29`, 'Do not add leading between lines of text'),
  noSpaceRaiseLower: legacy(
    `${PART4}.30`,
    'Do not increase line height for raised or lowered text'
  ),
  noTabHangInd: legacy(`${PART4}.31`, 'Do not create custom tab stop for hanging indent'),
  printBodyTextBeforeHeader: legacy(
    `${PART4}.32`,
    'Print body text before header and footer contents'
  ),
  printColBlack: legacy(`${PART4}.33`, 'Print colors as black and white without dithering'),
  selectFldWithFirstOrLastChar: legacy(
    `${PART4}.34`,
    'Select field when first or last character is selected'
  ),
  shapeLayoutLikeWW8: legacy(
    `${PART4}.35`,
    'Ignore text wrapping around objects at bottom of page'
  ),
  showBreaksInFrames: legacy(`${PART4}.36`, 'Display page and column breaks present in frames'),
  spacingInWholePoints: legacy(`${PART4}.37`, 'Only expand or condense text by whole points'),
  splitPgBreakAndParaMark: legacy(
    `${PART4}.38`,
    'Always move paragraph mark to page after a page break'
  ),
  subFontBySize: legacy(`${PART4}.39`, 'Require exact size during font substitution'),
  suppressBottomSpacing: legacy(`${PART4}.40`, 'Ignore exact line height for last line on page'),
  suppressSpacingAtTopOfPage: legacy(
    `${PART4}.41`,
    'Ignore minimum line height for first line on page'
  ),
  suppressSpBfAfterPgBrk: legacy(
    `${PART4}.42`,
    'Do not use space before on first line after a page break'
  ),
  suppressTopSpacing: legacy(
    `${PART4}.43`,
    'Ignore minimum and exact line height for first line on page'
  ),
  suppressTopSpacingWP: legacy(`${PART4}.44`, 'Use static text leading'),
  swapBordersFacingPages: legacy(`${PART4}.45`, 'Swap paragraph borders on odd numbered pages'),
  truncateFontHeightsLikeWP6: legacy(
    `${PART4}.46`,
    'Use truncated integer division for font calculation'
  ),
  underlineTabInNumList: legacy(`${PART4}.47`, 'Underline following character following numbering'),
  useAltKinsokuLineBreakRules: legacy(
    `${PART4}.48`,
    'Use alternate set of East Asian line breaking rules'
  ),
  useAnsiKerningPairs: legacy(`${PART4}.49`, 'Use ANSI kerning pairs from fonts'),
  useFELayout: legacy(`${PART4}.50`, 'Do not bypass East Asian and complex script layout code'),
  useNormalStyleForList: legacy(
    `${PART4}.51`,
    'Do not automatically apply list paragraph style to bulleted or numbered text'
  ),
  usePrinterMetrics: legacy(`${PART4}.52`, 'Use printer metrics to display documents'),
  useSingleBorderforContiguousCells: legacy(
    `${PART4}.53`,
    'Use simplified rules for table border conflicts'
  ),
  useWord2002TableStyleRules: legacy(
    `${PART4}.54`,
    'Display top border of conditional columns with Word 2002 rules'
  ),
  useWord97LineBreakRules: legacy(`${PART4}.55`, 'Use Word 97 inter-character spacing rules'),
  wpJustification: legacy(
    `${PART4}.56`,
    'Fit to expanded width when performing full justification'
  ),
  wpSpaceWidth: legacy(`${PART4}.57`, 'Use specific space width'),
  wrapTrailSpaces: legacy(`${PART4}.58`, 'Line wrap trailing spaces'),
});

/** The name of a legacy `w:compat` option. */
export type LegacyCompatOption = keyof typeof LEGACY_COMPAT_OPTIONS;

function setting(section: string, summary: string, overrides?: Partial<CompatOptionSpec>) {
  return Object.freeze({
    source: `[MS-DOCX] ${section}`,
    summary,
    onOff: 'explicit-on',
    repeat: 'refuse-duplicates',
    ...overrides,
  }) satisfies CompatOptionSpec;
}

/**
 * Every on/off `w:compatSetting` [MS-DOCX] defines under the Word URI. `compatibilityMode`
 * itself is read by `readWordCompatibilityMode`.
 */
export const WORD_COMPAT_SETTINGS = Object.freeze({
  overrideTableStyleFontSizeAndJustification: setting(
    '2.3, overrideTableStyleFontSizeAndJustification',
    'Apply the table style font size and justification over the default paragraph style',
    { repeat: 'last' }
  ),
  enableOpenTypeFeatures: setting(
    '2.3, enableOpenTypeFeatures',
    'Enable OpenType ligatures and other font features'
  ),
  doNotFlipMirrorIndents: setting(
    '2.3, doNotFlipMirrorIndents',
    'Do not swap mirrored paragraph indents'
  ),
  differentiateMultirowTableHeaders: setting(
    '2.3.4 differentiateMultirowTableHeaders',
    'Apply header-row conditional formatting to each row of a multi-row header'
  ),
  allowTextAfterFloatingTableBreak: setting(
    '2.3.6 allowTextAfterFloatingTableBreak',
    'Let content after a floating table that breaks across pages share its pages'
  ),
  allowHyphenationAtTrackBottom: setting(
    '2.3.7 allowHyphenationAtTrackBottom',
    'Allow a hyphenated word to end a page or column'
  ),
  useWord2013TrackBottomHyphenation: setting(
    '2.3.8 useWord2013TrackBottomHyphenation',
    'Move the whole line of a hyphenated word that ends a page or column'
  ),
});

/** The name of a Word-defined on/off `w:compatSetting`. */
export type WordCompatSettingName = keyof typeof WORD_COMPAT_SETTINGS;

/** A `w:compatSetting` reading: its value, or `ambiguous` for refused duplicates. */
export type CompatSettingValue = boolean | 'ambiguous';

/** Every option the walk found, under the catalog's reading. Absent options have no key. */
export interface CompatibilityOptions {
  readonly legacy: Readonly<Partial<Record<LegacyCompatOption, boolean>>>;
  readonly settings: Readonly<Partial<Record<WordCompatSettingName, CompatSettingValue>>>;
}

const LEGACY_SPECS: ReadonlyMap<string, CompatOptionSpec> = new Map(
  Object.entries(LEGACY_COMPAT_OPTIONS)
);
const SETTING_SPECS: ReadonlyMap<string, CompatOptionSpec> = new Map(
  Object.entries(WORD_COMPAT_SETTINGS)
);

/** Read an `ST_OnOff` value under one of the catalog readings. */
export function readOnOff(raw: string | undefined, reading: OnOffReading): boolean {
  switch (reading) {
    case 'on-or-missing':
      return raw === undefined || raw === '1' || raw === 'true' || raw === 'on';
    case 'not-off':
      return raw === undefined || (raw !== '0' && raw !== 'false' && raw !== 'off');
    case 'explicit-on':
      return raw === '1' || raw === 'true' || raw === 'on';
  }
}

const NO_OPTIONS: CompatibilityOptions = Object.freeze({
  legacy: Object.freeze({}),
  settings: Object.freeze({}),
});

/**
 * Read every cataloged option from a settings root in one walk.
 *
 * `overrideTableStyleFontSizeAndJustification` is read under any part root, as its original
 * reader did; every other option needs a `w:settings` root.
 */
export function readCompatibilityOptions(root: OoxmlElement | null): CompatibilityOptions {
  if (!root) return NO_OPTIONS;
  const settingsRoot = isSettingsRoot(root);
  // Keys come only from the catalogs, never from file strings.
  const legacyValues: Partial<Record<LegacyCompatOption, boolean>> = {};
  const settingValues: Partial<Record<WordCompatSettingName, CompatSettingValue>> = {};
  let firstCompat = true;
  for (const compat of root.children) {
    if (
      compat.kind === 'textValue' ||
      compat.namespaceUri !== WML_NAMESPACE_URI ||
      compat.localName !== 'compat'
    )
      continue;
    const seenInThisCompat = new Set<string>();
    for (const option of compat.children) {
      if (option.kind === 'textValue' || option.namespaceUri !== WML_NAMESPACE_URI) continue;
      if (option.localName === 'compatSetting') {
        if (wordAttribute(option, 'uri') !== WORD_COMPAT_SETTING_URI) continue;
        const name = wordAttribute(option, 'name');
        const spec = name === undefined ? undefined : SETTING_SPECS.get(name);
        if (!spec || name === undefined) continue;
        if (!settingsRoot && name !== 'overrideTableStyleFontSizeAndJustification') continue;
        const key = name as WordCompatSettingName;
        const value = readOnOff(wordAttribute(option, 'val'), spec.onOff);
        settingValues[key] =
          spec.repeat === 'refuse-duplicates' && Object.hasOwn(settingValues, key)
            ? 'ambiguous'
            : value;
        continue;
      }
      if (!settingsRoot) continue;
      const spec = LEGACY_SPECS.get(option.localName);
      if (!spec) continue;
      const key = option.localName as LegacyCompatOption;
      if (spec.repeat === 'first-compat-first') {
        if (!firstCompat || seenInThisCompat.has(key)) continue;
        seenInThisCompat.add(key);
      }
      legacyValues[key] = readOnOff(wordAttribute(option, 'val'), spec.onOff);
    }
    firstCompat = false;
  }
  return Object.freeze({
    legacy: Object.freeze(legacyValues),
    settings: Object.freeze(settingValues),
  });
}
