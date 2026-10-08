// Every layout behavior that depends on the Word compatibility mode or on a compatibility
// option, as a named rule. Layout asks `hasCompatibilityRule(compatibilityMode, 'name')` or
// `profile.has('name')` and never compares mode numbers itself; the
// `docx/no-raw-compatibility-mode` lint rule enforces that. See
// docs/architecture/compatibility-modes.md.

import type { CompatibilityProfile } from './compatibility-profile.ts';

/**
 * How a mode value lays out.
 *
 * - `legacy`: no declaration, 11, 12 or 14. Word lays out a document without a declaration
 *   as one that declares 12, the [MS-DOCX] default.
 * - `modern`: 15 and every value above it. Word lays out 16, 17, 99 and 9999 as 15.
 * - `unlisted`: any other value, such as 13, which Word reports as unreadable content. No
 *   rule applies.
 */
export type CompatibilityModeClass = 'legacy' | 'modern' | 'unlisted';

/** The class of a threaded mode value; `undefined` is an absent or refused declaration. */
export function compatibilityModeClass(value: number | undefined): CompatibilityModeClass {
  if (value === undefined || value === 11 || value === 12 || value === 14) return 'legacy';
  return value >= 15 ? 'modern' : 'unlisted';
}

interface Rule {
  /** What layout does when the rule applies. */
  readonly behavior: string;
  /** The specification section of the construct the rule acts on. */
  readonly source: string;
}

interface ModeRule extends Rule {
  readonly mode: 'legacy' | 'modern';
}

interface ProfileRule extends Rule {
  readonly applies: (profile: CompatibilityProfile) => boolean;
}

const modern = (behavior: string, source: string): ModeRule => ({
  mode: 'modern',
  behavior,
  source,
});
const legacy = (behavior: string, source: string): ModeRule => ({
  mode: 'legacy',
  behavior,
  source,
});

/** Rules that depend only on the mode. */
export const MODE_RULES = {
  anchorOnlyParagraphSeeding: modern(
    'Seed the pages of consecutive anchor-only paragraphs before later bands wrap earlier text',
    'ECMA-376 Part 1 §20.4.2.3 anchor'
  ),
  anchorOnlyParagraphWrapExclusion: modern(
    'An anchor-only paragraph wraps around its own anchors before it is placed',
    'ECMA-376 Part 1 §20.4.2.3 anchor'
  ),
  anchorsLayOutInCell: modern(
    'Every anchored object in a table cell lays out in its cell; none is out of cell',
    'ECMA-376 Part 1 §20.4.2.3 anchor (layoutInCell)'
  ),
  fixedTableContentEdgeOrigin: legacy(
    'A collapsed fixed left table aligns its leading cell content edge with the text column',
    'ECMA-376 Part 1 §17.4.52 tblLayout'
  ),
  floatingTableContentOrigin: legacy(
    'A floating table with a numeric text anchor or a right alignment positions its cell content, not its outer edge',
    'ECMA-376 Part 1 §17.4.57 tblpPr'
  ),
  floatingTableOverlapMovesLeft: modern(
    'A floating table that may not overlap moves left of the table it meets when the right side has no room',
    'ECMA-376 Part 1 §17.4.56 tblOverlap'
  ),
  headerFooterAnchorsWrapText: modern(
    'Header and footer text outside tables wraps around anchored objects',
    'ECMA-376 Part 1 §20.4.2.3 anchor'
  ),
  headerRowsKeepWithBody: modern(
    'Header rows keep with the opening body rows; the table starts on the next page if both do not fit',
    'ECMA-376 Part 1 §17.4.49 tblHeader'
  ),
  justifiedSpaceShrink: modern(
    'Justified lines may shrink spaces to fit one more word',
    'ECMA-376 Part 1 §17.3.1.13 jc'
  ),
  keepNextGivesTailLines: modern(
    'A keep-with-next paragraph that fits whole gives its last lines to the next page with its successor',
    'ECMA-376 Part 1 §17.3.1.15 keepNext'
  ),
  legacyPercentTableContentWidth: legacy(
    'A top-level percent-width table resolves its width against the legacy content width',
    'ECMA-376 Part 1 §17.4.63 tblW'
  ),
  legacySharedGridLineSideRules: legacy(
    'Collapsed side rules center on shared grid lines for every simple top-level table',
    'ECMA-376 Part 1 §17.4.38 tblBorders'
  ),
  modernGridLineSideRules: modern(
    'Side rules center on grid lines for covered dxa/auto width shapes; edge-aligned grids move by half a rule',
    'ECMA-376 Part 1 §17.4.38 tblBorders'
  ),
  noteTableCellKeeps: modern(
    'Note reference bands in table rows honor cell widow control and keep-lines cuts',
    'ECMA-376 Part 1 §17.11 Footnotes and Endnotes'
  ),
  positionedTableBreaksAtMargin: modern(
    'A page- or margin-positioned table that breaks ends its first fragment at the bottom margin, not the page edge',
    'ECMA-376 Part 1 §17.4.57 tblpPr'
  ),
  pageBreakBeforeKeepsSpace: legacy(
    'A paragraph with a page break before keeps its space before at the top of the new page. In modern modes only the first block of a section keeps it',
    'ECMA-376 Part 1 §17.3.1.23 pageBreakBefore'
  ),
  pageBreakLinesStretch: legacy(
    'A justified line that ends in a page or column break stretches to the measure, unless it is the last line of its paragraph',
    'ECMA-376 Part 1 §17.3.3.1 br'
  ),
  rowPageBreakYieldsToKeep: modern(
    'A row with a page break does not start a page when the row before it keeps with it',
    'ECMA-376 Part 1 §17.3.1.15 keepNext'
  ),
  tableParagraphWidowControl: modern(
    'Paragraphs that split inside table cells apply widow and orphan control',
    'ECMA-376 Part 1 §17.3.1.44 widowControl'
  ),
  vMergeTextMovesPastHeadRow: modern(
    'Merged cell text moves whole into the next row when the head row cannot hold it',
    'ECMA-376 Part 1 §17.4.84 vMerge'
  ),
} as const satisfies Record<string, ModeRule>;

/** Rules that read compatibility options, so they need the parsed settings. */
export const PROFILE_RULES = {
  adjustLineHeightInTable: {
    behavior: 'Paragraphs in table cells snap to the section line grid',
    source: 'ECMA-376 Part 1 §17.15.3.1 adjustLineHeightInTable',
    applies: (p) => p.legacy.adjustLineHeightInTable === true,
  },
  doNotBreakWrappedTables: {
    behavior: 'A floating table that fits a full page does not break across pages',
    source: 'ECMA-376 Part 4 §14.8.3.10 doNotBreakWrappedTables',
    applies: (p) => p.legacy.doNotBreakWrappedTables === true,
  },
  fixedParagraphSpacing: {
    behavior:
      'Adjacent paragraph spacing adds up, and automatic spacing is a fixed 5pt before and 10pt after',
    source: 'ECMA-376 Part 4 §14.8.3.15 doNotUseHTMLParagraphAutoSpacing',
    applies: (p) => p.legacy.doNotUseHTMLParagraphAutoSpacing === true,
  },
  ignoreIndentAsNumberingTabStop: {
    behavior: 'A numbering suffix tab ignores the hanging indent as a tab stop',
    source: 'ECMA-376 Part 4 §14.8.3.16 doNotUseIndentAsNumberingTabStop',
    applies: (p) => p.legacy.doNotUseIndentAsNumberingTabStop === true,
  },
  optionalLigatures: {
    behavior:
      'Optional OpenType ligatures apply: as `enableOpenTypeFeatures` says, else in modern modes. A duplicated setting turns them off',
    source: '[MS-DOCX] enableOpenTypeFeatures',
    applies: (p) => {
      const declared = p.settings.enableOpenTypeFeatures;
      return declared === 'ambiguous' ? false : (declared ?? p.modeClass === 'modern');
    },
  },
  preserveExactLineBaseline: {
    behavior:
      'With `w:noExtraLineSpacing` in a legacy mode that was not refused, an exact-height line keeps the face baseline',
    source: 'ECMA-376 Part 4 §14.8.3.28 noExtraLineSpacing',
    applies: (p) =>
      !p.modeRefused && p.modeClass === 'legacy' && p.legacy.noExtraLineSpacing === true,
  },
  strictTableStyleHierarchy: {
    behavior: 'Table style font size and justification apply over the default paragraph style',
    source: '[MS-DOCX] 2.3.1 overrideTableStyleFontSizeAndJustification',
    applies: (p) => p.settings.overrideTableStyleFontSizeAndJustification === true,
  },
  unstretchedManualBreakLines: {
    behavior:
      'A justified line that ends in a manual line break keeps its natural spacing, as a last line does. A distributed line still stretches',
    source: 'ECMA-376 Part 4 §14.8.3 doNotExpandShiftReturn',
    applies: (p) => p.legacy.doNotExpandShiftReturn === true,
  },
} as const satisfies Record<string, ProfileRule>;

export type ModeRuleName = keyof typeof MODE_RULES;
/** Any registered rule. A typo or an unregistered rule fails typecheck. */
export type CompatibilityRuleName = ModeRuleName | keyof typeof PROFILE_RULES;

/** Whether a mode rule applies to the threaded `compatibilityMode` value. */
export function hasCompatibilityRule(
  compatibilityMode: number | undefined,
  rule: ModeRuleName
): boolean {
  return MODE_RULES[rule].mode === compatibilityModeClass(compatibilityMode);
}
