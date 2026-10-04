# Compatibility modes

A DOCX file declares the Word feature set it was saved with, and it can turn on legacy layout options. The layout engine reads both once, and every layout branch that depends on them is a named rule. The code lives in `packages/core/src/layout/compatibility/`:

- `compatibility-profile.ts` reads the mode and the options from `settings.xml`.
- `compatibility-rules.ts` names each rule and says when it applies.

## Modes

The mode is a `w:compatSetting` with `w:name="compatibilityMode"` and `w:uri="http://schemas.microsoft.com/office/word"`.

| Value | Feature set | Lays out as |
| --- | --- | --- |
| None | [MS-DOCX] default | `legacy` |
| 11 | Word 2003 | `legacy` |
| 12 | Word 2007 | `legacy` |
| 14 | Word 2010 | `legacy` |
| 15 | Word 2013 and later | `modern` |
| Above 15 | Not defined by Microsoft | `modern` |
| 13 | Not defined | `unlisted`: no mode rule applies |
| Duplicated, malformed, below 11, or above 9999 | Refused | `legacy`, and `preserveExactLineBaseline` is off |

[MS-DOCX] covers Word 2007 through Word LTSC 2024 and defines no value above 15, and the `WdCompatibilityMode` enumeration ends at `wdWord2013 = 15`. Word 16 for Mac lays out a document without a declaration exactly as one that declares 12, and a document that declares 16 exactly as one that declares 15. Declarations of 17, 99, and 9999 also lay out as 15. Word reports a document that declares 13 as unreadable content, so no rule applies to 13.

Sources:

- [[MS-DOCX] 2.3.5 compatibilityMode](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/90138c4d-eb18-4edc-aa6c-dfb799cb1d0d)
- [WdCompatibilityMode enumeration (Word)](https://learn.microsoft.com/en-us/office/vba/api/word.wdcompatibilitymode)

## Read a rule

Layout threads the mode as `compatibilityMode: number | undefined`, which is public API and part of cache keys. Code that branches on it calls `hasCompatibilityRule(compatibilityMode, 'ruleName')`. The style cascade reads the options through `compatibilityProfileFromSettings(settingsRoot).has('ruleName')` and folds the result into its cache token.

The `docx/no-raw-compatibility-mode` lint rule rejects a comparison of `compatibilityMode`, or of a local `mode` alias, with a number in library code outside the compatibility module. It cannot see every form, such as a comparison with a named constant.

## Rules

| Rule | Applies in | Behavior |
| --- | --- | --- |
| `anchorOnlyParagraphSeeding` | `modern` | Seeds the pages of consecutive anchor-only paragraphs first |
| `anchorOnlyParagraphWrapExclusion` | `modern` | An anchor-only paragraph wraps around its own anchors |
| `anchorsLayOutInCell` | `modern` | Every anchored object in a table cell lays out in its cell |
| `fixedTableContentEdgeOrigin` | `legacy` | A fixed left table aligns its first content edge with the text column |
| `floatingTableContentOrigin` | `legacy` | A floating table with a numeric text anchor positions its first cell content |
| `headerFooterAnchorsWrapText` | `modern` | Header and footer text wraps around anchored objects |
| `headerRowsKeepWithBody` | `modern` | Header rows keep with the opening body rows |
| `justifiedSpaceShrink` | `modern` | Justified lines may shrink spaces |
| `keepNextGivesTailLines` | `modern` | A keep-with-next paragraph gives its last lines to the next page |
| `legacyPercentTableContentWidth` | `legacy` | A percent-width table resolves against the legacy content width |
| `legacySharedGridLineSideRules` | `legacy` | Side rules center on shared grid lines |
| `modernGridLineSideRules` | `modern` | Side rules center on grid lines for covered shapes; edge-aligned grids move by half a rule |
| `noteTableCellKeeps` | `modern` | Note bands in table rows honor cell widow control and `w:keepLines` |
| `pageBreakLinesStretch` | `legacy` | A justified line before a page or column break stretches, unless it ends its paragraph |
| `rowPageBreakYieldsToKeep` | `modern` | A row with a page break follows a row that keeps with it |
| `tableParagraphWidowControl` | `modern` | Paragraphs that split in table cells apply widow control |
| `vMergeTextMovesPastHeadRow` | `modern` | Merged cell text moves whole past a head row that cannot hold it |
| `adjustLineHeightInTable` | `w:adjustLineHeightInTable` | Cell paragraphs snap to the line grid |
| `doNotBreakWrappedTables` | `w:doNotBreakWrappedTables` | A floating table that fits a page does not break |
| `fixedParagraphSpacing` | `w:doNotUseHTMLParagraphAutoSpacing` | Adjacent paragraph spacing adds up |
| `ignoreIndentAsNumberingTabStop` | `w:doNotUseIndentAsNumberingTabStop` | A numbering tab ignores the hanging indent |
| `optionalLigatures` | `enableOpenTypeFeatures`, else `modern` | Optional OpenType ligatures apply |
| `preserveExactLineBaseline` | `w:noExtraLineSpacing` in `legacy`, mode not refused | An exact-height line keeps the face baseline |
| `strictTableStyleHierarchy` | `overrideTableStyleFontSizeAndJustification` | Table style size and justification win |
| `unstretchedManualBreakLines` | `w:doNotExpandShiftReturn` | A justified line before a manual line break keeps its spacing |

Each rule in `compatibility-rules.ts` also names the specification section of the construct it acts on.

## Add a rule

1. Add the rule to `MODE_RULES` or `PROFILE_RULES` in `compatibility-rules.ts`, with its behavior and source. If it reads a new option, add the option to `compatibility-profile.ts`.
1. Branch on it with `hasCompatibilityRule(compatibilityMode, 'ruleName')`, or with `profile.has('ruleName')`.
1. Add it to the matrix in `packages/core/src/layout/__tests__/compatibility-rules.test.ts` and to the table on this page.
1. Before you make a rule depend on the mode, render the same markup with Word in each mode and confirm that the layout differs.
