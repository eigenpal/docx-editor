// Shared style/numbering assembly for browser layout and headless exporters.

import type { HeadlessDocumentView, OoxmlElement } from '@docx-editor.dev/core/store';
import { buildNumberingIndex, type NumberingIndex } from './numbering-index.ts';
import { defaultTabIntervalFromSettings } from './paragraph-tabs.ts';
import { buildStyleCascadeTable, type StyleCascadeTable } from './style-cascade.ts';

/** Memoized style inputs shared by every story in one document view. @public */
export interface DocumentStyleDependencies {
  readonly styleCascade: () => StyleCascadeTable | undefined;
  readonly defaultTabStopPt: number;
  readonly numberingIndex: () => NumberingIndex;
}

/** Build the cascade and numbering projections layout consumes. @public */
export function createDocumentStyleDependencies(
  view: HeadlessDocumentView
): DocumentStyleDependencies {
  let numberingRoot: OoxmlElement | null | undefined;
  let numbering: NumberingIndex | undefined;
  let stylesRoot: OoxmlElement | null | undefined;
  let styles: StyleCascadeTable | undefined;
  return {
    styleCascade() {
      const current = view.stylesRoot();
      if (styles === undefined || current !== stylesRoot) {
        stylesRoot = current;
        styles = buildStyleCascadeTable(current, view.documentThemeFonts());
      }
      return styles;
    },
    defaultTabStopPt: defaultTabIntervalFromSettings(view.settingsRoot()),
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
