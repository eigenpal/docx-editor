// The registry of layout behaviors that depend on the Word compatibility mode or on a
// compatibility option. Every branch the engine takes on either is a named rule here, so one
// file says which behavior depends on which mode or option, and why.
//
// Layout asks `hasCompatibilityRule(mode, 'ruleName')` (mode rules, over the threaded mode
// value) or `profile.has('ruleName')` (any rule, over a parsed settings part). It never
// compares mode numbers itself; the `docx/no-raw-compatibility-mode` lint rule enforces that.
//
// Word lays out a document without a declaration as mode 12, and a declaration above 15 as
// mode 15. Every rule follows both: `absent` reads as `word2007`, and `newer` as `word2013`.
// The matrix test enforces this for every rule, so a rule cannot treat them differently.
//
// No published specification says which modes change these layout behaviors; the specified
// part is the OOXML construct each rule acts on. So every rule names that construct's section
// as `source`, and the layout tests that pin its mode dependence as `pinnedBy`. Those tests
// state positions and page breaks that Word produces for the same markup in each mode.
//
// See docs/architecture/compatibility-modes.md for the full tables and how to add a rule.

import { compatibilityModeClass, type CompatibilityModeClass } from './compatibility-mode.ts';
import type { CompatibilityProfileFacts } from './compatibility-profile.ts';
import type { LegacyCompatOption, WordCompatSettingName } from './compatibility-settings.ts';

interface RuleDocumentation {
  /** One line: what layout does when the rule applies. */
  readonly behavior: string;
  /** The specification section of the construct the rule acts on. */
  readonly source: string;
  /** Test files, relative to `packages/core/src`, that fail when the rule is inverted. */
  readonly pinnedBy: readonly string[];
}

/** A rule that depends only on the compatibility mode. */
export interface ModeCompatibilityRule extends RuleDocumentation {
  readonly kind: 'mode';
  /** The mode classes the behavior applies in. */
  readonly modes: readonly CompatibilityModeClass[];
}

/** A rule that also depends on compatibility options, so it needs the parsed settings. */
export interface ProfileCompatibilityRule extends RuleDocumentation {
  readonly kind: 'profile';
  /** Plain-language form of `applies`, for the documentation table. */
  readonly condition: string;
  /** The options `applies` reads. */
  readonly reads: readonly (LegacyCompatOption | WordCompatSettingName)[];
  readonly applies: (facts: CompatibilityProfileFacts) => boolean;
}

const MODERN: readonly CompatibilityModeClass[] = Object.freeze(['word2013', 'newer']);
const LEGACY: readonly CompatibilityModeClass[] = Object.freeze([
  'absent',
  'word2003',
  'word2007',
  'word2010',
]);
const LEGACY_SET: ReadonlySet<CompatibilityModeClass> = new Set(LEGACY);
const MODERN_SET: ReadonlySet<CompatibilityModeClass> = new Set(MODERN);

function mode(
  modes: readonly CompatibilityModeClass[],
  behavior: string,
  source: string,
  pinnedBy: readonly string[]
): ModeCompatibilityRule {
  return Object.freeze({
    kind: 'mode',
    modes: Object.freeze([...modes]),
    behavior,
    source,
    pinnedBy: Object.freeze([...pinnedBy]),
  });
}

/** Every mode rule, by name. */
export const MODE_COMPATIBILITY_RULES = Object.freeze({
  anchorOnlyParagraphSeeding: mode(
    MODERN,
    'Seed the pages of consecutive anchor-only paragraphs before later bands wrap earlier text',
    'ECMA-376 Part 1 §20.4.2.3 anchor',
    ['layout/__tests__/empty-anchor-pagination.test.ts']
  ),
  anchorOnlyParagraphWrapExclusion: mode(
    MODERN,
    'An anchor-only paragraph wraps around its own anchors before it is placed',
    'ECMA-376 Part 1 §20.4.2.3 anchor',
    ['layout/__tests__/empty-anchor-pagination.test.ts']
  ),
  anchorsLayOutInCell: mode(
    MODERN,
    'Every anchored object in a table cell lays out in its cell; none is out of cell',
    'ECMA-376 Part 1 §20.4.2.3 anchor (layoutInCell)',
    [
      'layout/__tests__/layout-in-cell-exclusion.test.ts',
      'layout/__tests__/table-out-of-cell-floats.test.ts',
    ]
  ),
  fixedTableContentEdgeOrigin: mode(
    LEGACY,
    'A collapsed fixed left table aligns its leading cell content edge with the text column',
    'ECMA-376 Part 1 §17.4.52 tblLayout',
    [
      'layout/__tests__/legacy-fixed-table-content.test.ts',
      'layout/__tests__/modern-edge-aligned-side-rules.test.ts',
    ]
  ),
  floatingTableContentOrigin: mode(
    LEGACY,
    'A floating table with a numeric text anchor positions its first cell content, not its outer edge',
    'ECMA-376 Part 1 §17.4.57 tblpPr',
    ['layout/__tests__/legacy-table-float-origin.test.ts']
  ),
  headerFooterAnchorsWrapText: mode(
    MODERN,
    'Header and footer text outside tables wraps around anchored objects',
    'ECMA-376 Part 1 §20.4.2.3 anchor',
    ['output/__tests__/header-margin-anchor.test.ts']
  ),
  headerRowsKeepWithBody: mode(
    MODERN,
    'Header rows keep with the opening body rows; the table starts on the next page if both do not fit',
    'ECMA-376 Part 1 §17.4.49 tblHeader',
    [
      'layout/__tests__/table-row-keep-chains.test.ts',
      'layout/__tests__/table-row-keep-next.test.ts',
    ]
  ),
  justifiedSpaceShrink: mode(
    MODERN,
    'Justified lines may shrink spaces to fit one more word',
    'ECMA-376 Part 1 §17.3.1.13 jc',
    ['layout/__tests__/paragraph-space-shrink.test.ts']
  ),
  keepNextGivesTailLines: mode(
    MODERN,
    'A keep-with-next paragraph that fits whole gives its last lines to the next page with its successor',
    'ECMA-376 Part 1 §17.3.1.15 keepNext',
    ['layout/__tests__/keep-next-natural-split.test.ts']
  ),
  legacyPercentTableContentWidth: mode(
    LEGACY,
    'A top-level percent-width table resolves its width against the legacy content width',
    'ECMA-376 Part 1 §17.4.63 tblW',
    ['layout/__tests__/legacy-table-content-width.test.ts']
  ),
  legacySharedGridLineSideRules: mode(
    LEGACY,
    'Collapsed side rules center on shared grid lines for every simple top-level table',
    'ECMA-376 Part 1 §17.4.38 tblBorders',
    ['layout/__tests__/legacy-table-side-rules.test.ts']
  ),
  modernGridLineSideRules: mode(
    MODERN,
    'Side rules center on grid lines only for covered dxa/auto width shapes; edge-aligned grids move by half a rule',
    'ECMA-376 Part 1 §17.4.38 tblBorders',
    [
      'layout/__tests__/modern-edge-aligned-side-rules.test.ts',
      'layout/__tests__/legacy-table-side-rules.test.ts',
    ]
  ),
  noteTableCellKeeps: mode(
    MODERN,
    'Note reference bands in table rows honor cell widow control and keep-lines cuts',
    'ECMA-376 Part 1 §17.11 Footnotes and Endnotes',
    ['layout/__tests__/footnote-table-row-bands.test.ts']
  ),
  rowPageBreakYieldsToKeep: mode(
    MODERN,
    'A row with a page break does not start a page when the row before it keeps with it',
    'ECMA-376 Part 1 §17.3.1.15 keepNext',
    ['layout/__tests__/table-row-keep-chains.test.ts']
  ),
  tableParagraphWidowControl: mode(
    MODERN,
    'Paragraphs that split inside table cells apply widow and orphan control',
    'ECMA-376 Part 1 §17.3.1.44 widowControl',
    ['layout/__tests__/table-paragraph-widows.test.ts']
  ),
  vMergeTextMovesPastHeadRow: mode(
    MODERN,
    'Merged cell text moves whole into the next row when the head row cannot hold it',
    'ECMA-376 Part 1 §17.4.84 vMerge',
    ['layout/__tests__/table-vmerge-head-row-boundary.test.ts']
  ),
});

/** The name of a mode rule. */
export type ModeCompatibilityRuleName = keyof typeof MODE_COMPATIBILITY_RULES;

function profile(
  reads: readonly (LegacyCompatOption | WordCompatSettingName)[],
  condition: string,
  applies: (facts: CompatibilityProfileFacts) => boolean,
  behavior: string,
  source: string,
  pinnedBy: readonly string[]
): ProfileCompatibilityRule {
  return Object.freeze({
    kind: 'profile',
    reads: Object.freeze([...reads]),
    condition,
    applies,
    behavior,
    source,
    pinnedBy: Object.freeze([...pinnedBy]),
  });
}

/** Every rule that reads compatibility options, by name. */
export const PROFILE_COMPATIBILITY_RULES = Object.freeze({
  adjustLineHeightInTable: profile(
    ['adjustLineHeightInTable'],
    '`w:adjustLineHeightInTable` is on (any value but `0`, `false`, `off`)',
    (facts) => facts.legacy.adjustLineHeightInTable === true,
    'Paragraphs in table cells snap to the section line grid',
    'ECMA-376 Part 1 §17.15.3.1',
    ['layout/__tests__/line-grid.test.ts']
  ),
  doNotBreakWrappedTables: profile(
    ['doNotBreakWrappedTables'],
    '`w:doNotBreakWrappedTables` is on; only its first occurrence in the first `w:compat` counts',
    (facts) => facts.legacy.doNotBreakWrappedTables === true,
    'A floating table that fits a full page does not break across pages',
    'ECMA-376 Part 4 §14.8.3.10',
    ['layout/__tests__/floating-table-page-break.test.ts']
  ),
  fixedParagraphSpacing: profile(
    ['doNotUseHTMLParagraphAutoSpacing'],
    '`w:doNotUseHTMLParagraphAutoSpacing` is on; only its first occurrence in the first `w:compat` counts',
    (facts) => facts.legacy.doNotUseHTMLParagraphAutoSpacing === true,
    'Adjacent paragraph spacing adds up, and automatic spacing is a fixed 5pt before and 10pt after',
    'ECMA-376 Part 4 §14.8.3.15',
    ['layout/__tests__/adjacent-paragraph-spacing.test.ts']
  ),
  ignoreIndentAsNumberingTabStop: profile(
    ['doNotUseIndentAsNumberingTabStop'],
    '`w:doNotUseIndentAsNumberingTabStop` is on; only its first occurrence in the first `w:compat` counts',
    (facts) => facts.legacy.doNotUseIndentAsNumberingTabStop === true,
    'A numbering suffix tab ignores the hanging indent as a tab stop',
    'ECMA-376 Part 4 §14.8.3.16',
    ['layout/__tests__/list-numbering-tab-stop.test.ts']
  ),
  optionalLigatures: profile(
    ['enableOpenTypeFeatures'],
    '`enableOpenTypeFeatures` is on; without it, the mode is `word2013` or `newer`. A duplicated `enableOpenTypeFeatures` turns the rule off',
    (facts) => {
      const declared = facts.settings.enableOpenTypeFeatures;
      if (declared === 'ambiguous') return false;
      return declared ?? MODERN_SET.has(facts.modeClass);
    },
    'Optional OpenType ligatures apply as run properties ask',
    '[MS-DOCX] enableOpenTypeFeatures',
    ['layout/__tests__/run-ligatures.test.ts']
  ),
  preserveExactLineBaseline: profile(
    ['noExtraLineSpacing'],
    '`w:noExtraLineSpacing` is on, the mode is `absent`, `word2003`, `word2007` or `word2010`, and the mode declaration is not refused',
    (facts) =>
      facts.mode.kind !== 'refused' &&
      LEGACY_SET.has(facts.modeClass) &&
      facts.legacy.noExtraLineSpacing === true,
    'An exact-height line keeps the face baseline instead of centering content',
    'ECMA-376 Part 4 §14.8.3.28',
    ['layout/__tests__/exact-line-baseline.test.ts']
  ),
  strictTableStyleHierarchy: profile(
    ['overrideTableStyleFontSizeAndJustification'],
    '`overrideTableStyleFontSizeAndJustification` is on (`1`, `true` or `on`)',
    (facts) => facts.settings.overrideTableStyleFontSizeAndJustification === true,
    'Table style font size and justification apply over the default paragraph style',
    '[MS-DOCX] 2.3.1 overrideTableStyleFontSizeAndJustification',
    ['layout/__tests__/table-style-compatibility.test.ts']
  ),
});

/** The name of a rule that needs the parsed settings. */
export type ProfileCompatibilityRuleName = keyof typeof PROFILE_COMPATIBILITY_RULES;

/** The name of any registered rule. A typo or an unregistered rule fails typecheck. */
export type CompatibilityRuleName = ModeCompatibilityRuleName | ProfileCompatibilityRuleName;

/** The classes each mode rule applies in. Built once; lookups are constant time. */
const MODE_RULE_TABLE: ReadonlyMap<string, ReadonlySet<CompatibilityModeClass>> = new Map(
  Object.entries(MODE_COMPATIBILITY_RULES).map(([name, rule]) => [name, new Set(rule.modes)])
);

/** Whether a mode rule applies to a mode class. */
export function modeRuleApplies(
  rule: ModeCompatibilityRuleName,
  modeClass: CompatibilityModeClass
): boolean {
  return MODE_RULE_TABLE.get(rule)?.has(modeClass) === true;
}

/**
 * Whether a mode rule applies to the threaded mode value (`compatibilityMode` in layout
 * options). `undefined` is an absent or refused declaration.
 */
export function hasCompatibilityRule(
  compatibilityMode: number | undefined,
  rule: ModeCompatibilityRuleName
): boolean {
  return modeRuleApplies(rule, compatibilityModeClass(compatibilityMode));
}
