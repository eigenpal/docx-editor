// The paragraph style of a row end mark (ECMA-376 Part 1, 17.4.78 `w:tr`).
//
// A row ends with a mark that holds no content and states no style. `w:contextualSpacing`
// (17.3.1.9) still compares with it: the mark is the neighbour after the last paragraph of a
// row, and before the paragraph that follows a table. The mark is in the paragraph style
// whose `w:name` is "Normal" (17.7.4.9 `w:name`), under any `w:styleId`. That style is the
// default paragraph style (17.7.4.17 `w:default`) of most documents. Where another style
// carries the flag, a paragraph in the default style does not match the mark. Where no style
// has that name and none carries the flag, a paragraph that names no style is in the same
// implicit style as the mark.

import { isNormalStyleName } from '../store/package/default-paragraph-style.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

/** What the rule reads from one style definition. */
interface RowEndMarkStyleCandidate {
  readonly styleId: string;
  readonly type: string;
  readonly name?: string | null;
}

/**
 * The id of the paragraph style named "Normal", or null where there is none. Where more than
 * one style has the name, the default paragraph style wins, then the last one.
 */
export function rowEndMarkStyleIdOf(
  styles: Iterable<RowEndMarkStyleCandidate>,
  defaultParagraphStyleId: string | null
): string | null {
  let id: string | null = null;
  for (const style of styles) {
    if (style.type !== 'paragraph' || !isNormalStyleName(style.name)) continue;
    if (style.styleId === defaultParagraphStyleId) return style.styleId;
    id = style.styleId;
  }
  return id;
}

/**
 * The part of a style table's cache token that names the mark's style. Empty where that is
 * the default paragraph style, which the token already names.
 */
export function rowEndMarkToken(
  styles: Iterable<RowEndMarkStyleCandidate>,
  defaultParagraphStyleId: string | null
): { readonly rowMark?: string | null } {
  const rowMark = rowEndMarkStyleIdOf(styles, defaultParagraphStyleId);
  return rowMark === defaultParagraphStyleId ? {} : { rowMark };
}

const memo = new WeakMap<StyleCascadeTable, string | null>();

/**
 * The style that a paragraph compares with at a row end mark. `undefined` never matches.
 * `null` is the implicit style of a paragraph that names no style where the style table has
 * no default paragraph style, or where there is no style table.
 */
export function rowEndMarkStyle(styles: StyleCascadeTable | undefined): string | null | undefined {
  if (!styles) return null;
  let id = memo.get(styles);
  if (id === undefined) {
    id = rowEndMarkStyleIdOf(styles.styles.values(), styles.defaultParagraphStyleId);
    memo.set(styles, id);
  }
  if (id !== null) return id;
  return styles.defaultParagraphStyleId === null ? null : undefined;
}
