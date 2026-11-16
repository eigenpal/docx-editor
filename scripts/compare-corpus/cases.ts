/** Every corpus case, in a stable order. */
import {
  listsFamily,
  paragraphFormattingFamily,
  paragraphsFamily,
  runFormattingFamily,
  scriptsFamily,
  tokensFamily,
  wordsFamily,
  type CompareCase,
} from './families-text.ts';
import {
  controlsFamily,
  drawingsFamily,
  fieldsFamily,
  headersFootersFamily,
  notesFamily,
  reviewStateFamily,
  sectionsFamily,
  tablesFamily,
  wholeDocumentFamily,
} from './families-structure.ts';

import { resetRevisionIds } from './xml.ts';

export type { CompareCase } from './families-text.ts';

export function allCases(): CompareCase[] {
  resetRevisionIds();
  const out: CompareCase[] = [];
  for (const family of [
    wordsFamily,
    tokensFamily,
    scriptsFamily,
    paragraphsFamily,
    runFormattingFamily,
    paragraphFormattingFamily,
    listsFamily,
    tablesFamily,
    sectionsFamily,
    headersFootersFamily,
    notesFamily,
    fieldsFamily,
    drawingsFamily,
    controlsFamily,
    reviewStateFamily,
    wholeDocumentFamily,
  ]) {
    family(out);
  }
  const seen = new Set<string>();
  for (const item of out) {
    const key = `${item.family}/${item.name}`;
    if (seen.has(key)) throw new Error(`duplicate case ${key}`);
    seen.add(key);
  }
  return out;
}
