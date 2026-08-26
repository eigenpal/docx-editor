// Word's "style for following paragraph" (`w:next`), and the one gesture that reads it.
//
// Pressing Enter at the END of a paragraph starts a new one, and Word gives that new
// paragraph the style's `w:next` rather than the style the caret was in. That is why a
// heading is followed by body text: `Heading 1` declares `<w:next w:val="Normal"/>`.
// Without it, Enter after a heading produced a second heading, and every following
// paragraph inherited the heading's size, colour and outline level until the user reset
// the style by hand.
//
// The rule is about the CARET, not about the split: a split in the MIDDLE of a paragraph
// divides one paragraph into two of the same kind, so `w:next` does not apply there. Word
// draws the line the same way, which is why Enter at the start of a heading leaves an
// empty heading above rather than an empty body paragraph.
//
// Split out of `surface-structure.ts` for the reason `surface-list-style.ts` was: it is a
// style question, answered against `styles.xml` and the document's own default, rather
// than a structural edit at the selection.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable, type StyleCascadeTable } from '@docx-editor.dev/core/layout';
import { directParagraphProperties } from './surface-formatting.ts';

/** What this lane borrows: the session it reads styles from, and the story it writes to. */
export interface NextStyleDeps {
  readonly session: TreeDocxSessionView;
  /** The part holding the paragraph an Enter is splitting. */
  storyPart(): OoxmlPart;
}

export interface NextStyleWrites {
  /**
   * The `w:pStyle` the paragraph an Enter mints takes, as `splitParagraph.tailStyleId`.
   *
   * `undefined` means "clone the head's own style", which is the answer whenever the rule
   * does not apply: a split inside the text, a style that names no `w:next`, a `w:next`
   * that points back at the same style, or one that names a style the document never
   * defines. `null` means "author no `w:pStyle`" and is how the document's DEFAULT style
   * is spelled — writing `<w:pStyle w:val="Normal"/>` on every new body paragraph would be
   * legal but is not what Word emits.
   */
  tailStyleId(paragraphId: string, atParagraphEnd: boolean): string | null | undefined;
}

export function createNextStyleWrites(deps: NextStyleDeps): NextStyleWrites {
  const { session } = deps;

  /**
   * The styles part, indexed, memoized on the root's identity.
   *
   * Read through the layout cascade rather than by walking `w:style` here: `w:default` is
   * `ST_OnOff` and last-wins, and style ids are bounded and control-character checked. One
   * reader of `styles.xml` means one answer to what a style id means.
   */
  let tableMemo: { readonly root: OoxmlElement | null; readonly table: StyleCascadeTable } | null =
    null;
  function styleTable(): StyleCascadeTable {
    const root = session.stylesRoot();
    if (tableMemo === null || tableMemo.root !== root) {
      tableMemo = { root, table: buildStyleCascadeTable(root, session.documentThemeFonts()) };
    }
    return tableMemo.table;
  }

  return {
    tailStyleId(paragraphId, atParagraphEnd) {
      if (!atParagraphEnd) return undefined;
      const table = styleTable();
      const authored = directParagraphProperties(deps.storyPart(), paragraphId).find(
        (property) => property.localName === 'pStyle'
      )?.attributes?.val;
      // A paragraph with no `w:pStyle` of its own is in the document's default style, and
      // that style has a `w:next` like any other. Word's own blank template points Normal
      // back at Normal, so this usually resolves to "no change" rather than to nothing.
      const current = authored ?? table.defaultParagraphStyleId;
      if (current === null || current === undefined) return undefined;
      const next = table.styles.get(current)?.next;
      if (!next || next === current) return undefined;
      // A `w:next` nobody defined would render as the default here and as a missing style
      // everywhere else. Leaving the head's style alone is the smaller wrong answer.
      const target = table.styles.get(next);
      if (!target || target.type !== 'paragraph') return undefined;
      return next === table.defaultParagraphStyleId ? null : next;
    },
  };
}
