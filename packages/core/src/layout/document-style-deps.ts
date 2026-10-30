// Shared style/numbering assembly for browser layout and headless exporters.

import type { HeadlessDocumentView, OoxmlElement } from '@docx-editor.dev/core/store';
import { buildNumberingIndex, type NumberingIndex } from './numbering-index.ts';
import { defaultTabIntervalFromSettings } from './paragraph-tabs.ts';
import { compatibilityModeFromSettings } from './compatibility/compatibility-profile.ts';
import { buildStyleCascadeTable, type StyleCascadeTable } from './style-cascade.ts';
import { withMeasuredEastAsianDefaults } from './east-asian-default-face.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** Memoized style inputs shared by every story in one document view. @public */
export interface DocumentStyleDependencies {
  readonly styleCascade: () => StyleCascadeTable | undefined;
  readonly defaultTabStopPt: () => number;
  readonly compatibilityMode?: () => number | undefined;
  readonly numberingIndex: () => NumberingIndex;
}

/** Options of {@link createDocumentStyleDependencies}. @public */
export interface DocumentStyleDependencyOptions {
  /**
   * The measurer layout uses now. Its fonts decide whether the East Asian font the document
   * defaults name is a Chinese, Japanese, or Korean face.
   */
  readonly measurer?: () => TextMeasurer | undefined;
}

/** Build the cascade and numbering projections layout consumes. @public */
export function createDocumentStyleDependencies(
  view: HeadlessDocumentView,
  options: DocumentStyleDependencyOptions = {}
): DocumentStyleDependencies {
  let numberingRoot: OoxmlElement | null | undefined;
  let numbering: NumberingIndex | undefined;
  let stylesRoot: OoxmlElement | null | undefined;
  let styleThemeMajor: string | null | undefined;
  let styleThemeMinor: string | null | undefined;
  let styleThemeMajorEastAsia: string | null | undefined;
  let styleThemeMinorEastAsia: string | null | undefined;
  let styleThemeMajorBidi: string | null | undefined;
  let styleThemeMinorBidi: string | null | undefined;
  let majorSupplemental: Readonly<Record<string, string>> | undefined;
  let minorSupplemental: Readonly<Record<string, string>> | undefined;
  let styles: StyleCascadeTable | undefined;
  let typographyRoot: OoxmlElement | null | undefined;
  let settingsRoot: OoxmlElement | null | undefined;
  let defaultTabStopPt: number | undefined;
  let compatibilityRoot: OoxmlElement | null | undefined;
  let compatibilityMode: number | undefined;
  return {
    styleCascade() {
      const current = view.stylesRoot();
      const theme = view.documentThemeFonts();
      const currentSettings = view.settingsRoot();
      if (
        styles === undefined ||
        current !== stylesRoot ||
        currentSettings !== typographyRoot ||
        theme.major !== styleThemeMajor ||
        theme.minor !== styleThemeMinor ||
        theme.majorEastAsia !== styleThemeMajorEastAsia ||
        theme.minorEastAsia !== styleThemeMinorEastAsia ||
        theme.majorBidi !== styleThemeMajorBidi ||
        theme.minorBidi !== styleThemeMinorBidi ||
        theme.majorSupplemental !== majorSupplemental ||
        theme.minorSupplemental !== minorSupplemental
      ) {
        stylesRoot = current;
        styleThemeMajor = theme.major;
        styleThemeMinor = theme.minor;
        styleThemeMajorEastAsia = theme.majorEastAsia;
        styleThemeMinorEastAsia = theme.minorEastAsia;
        styleThemeMajorBidi = theme.majorBidi;
        styleThemeMinorBidi = theme.minorBidi;
        majorSupplemental = theme.majorSupplemental;
        minorSupplemental = theme.minorSupplemental;
        typographyRoot = currentSettings;
        styles = buildStyleCascadeTable(current, theme, currentSettings);
      }
      return withMeasuredEastAsianDefaults(styles, options.measurer?.());
    },
    defaultTabStopPt() {
      const current = view.settingsRoot();
      if (defaultTabStopPt === undefined || current !== settingsRoot) {
        settingsRoot = current;
        defaultTabStopPt = defaultTabIntervalFromSettings(current);
      }
      return defaultTabStopPt;
    },
    compatibilityMode() {
      const current = view.settingsRoot();
      if (current !== compatibilityRoot) {
        compatibilityRoot = current;
        compatibilityMode = compatibilityModeFromSettings(current);
      }
      return compatibilityMode;
    },
    numberingIndex() {
      const current = view.numberingRoot();
      if (numbering === undefined || current !== numberingRoot) {
        numberingRoot = current;
        numbering = buildNumberingIndex(current);
      }
      return numbering;
    },
  };
}
