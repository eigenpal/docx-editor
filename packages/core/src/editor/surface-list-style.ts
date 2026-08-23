// Word's List Paragraph style, and the `w:pStyle` writes the list gesture carries.
//
// Word's list buttons do not just add `w:numPr`: they put the paragraph in the built-in
// List Paragraph style, and THAT style is what states `w:contextualSpacing` — the property
// that closes the gap between consecutive items. So a list gesture is two writes, and the
// second one is a style decision with rules of its own about which paragraphs it may touch.
//
// Split out of `surface-structure.ts` because it is that: a style question, answered
// against `styles.xml` and the document's own default, rather than a structural edit at the
// selection.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { OoxmlElement, OoxmlPart, TreeDocOp } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable } from '@docx-editor.dev/core/layout';
import { directParagraphProperties, mergedProperties } from './surface-formatting.ts';

/** What this lane borrows: the session it reads styles from, and the story it writes to. */
export interface ListStyleDeps {
  readonly session: TreeDocxSessionView;
  /** The part holding the paragraphs a write will name. */
  storyPart(): OoxmlPart;
}

/** The `w:name` Word gives the built-in, case-folded for comparison. */
const LIST_PARAGRAPH_NAME = 'list paragraph';
/** The styleId Word gives the built-in. */
const LIST_PARAGRAPH_STYLE_ID = 'ListParagraph';

/** The `w:pStyle` a paragraph itself authors, or undefined. */
function authoredStyleId(
  properties: ReturnType<typeof directParagraphProperties>
): string | undefined {
  return properties.find((property) => property.localName === 'pStyle')?.attributes?.val;
}

/** The two writes a list gesture may need, resolved against one document's styles. */
export interface ListStyleWrites {
  /**
   * The `w:pStyle` writes that turning a list ON carries, the way Word's own gesture does.
   *
   * A paragraph in a NON-DEFAULT style keeps it: bulleting a Heading 1 in Word leaves it a
   * heading. A paragraph in the default style does not, and that is not the same as
   * authoring no style at all — a converter stamps `<w:pStyle w:val="Normal"/>` on every
   * paragraph it writes, and reading that as "has a style of its own" left the whole class
   * of converted files with 8pt between their list items.
   *
   * These ops must go BEFORE the numbering ops, because `setParagraphProperties` replaces
   * the authorable set it is handed and `setListNumbering` is surgical on `w:numPr` — the
   * other order would drop the numbering the same transaction had just written.
   */
  applyOps(touched: readonly string[]): TreeDocOp[];
  /**
   * The write that takes a paragraph OUT of List Paragraph, or null when it is not in it.
   *
   * Enter on an empty item is Word's "I am done with this list", and Word returns the text
   * to the LEFT MARGIN. Dropping only `w:numPr` leaves the style's own `w:ind w:left="720"`
   * standing, so the paragraph would keep sitting half an inch in with no marker to explain
   * it. The toolbar toggle deliberately does NOT do this: clicking Bullets off in Word
   * leaves the paragraph styled, and indented.
   */
  clearOp(paragraphId: string): TreeDocOp | null;
}

export function createListStyleWrites(deps: ListStyleDeps): ListStyleWrites {
  const { session } = deps;

  /**
   * The document's List Paragraph style, or null when it defines none.
   *
   * Matched on the built-in NAME first, then on the built-in styleId. Word identifies its
   * built-ins by `w:name`, and a converter commonly spells the id its own way
   * (`ListParagraph1`, `a3`) while keeping the name — while the reverse also happens, an
   * unrelated style handed the `ListParagraph` id. Name-first lands on the right one in
   * both files. A document that defines neither gets no `w:pStyle` write at all: writing a
   * dangling one would render as Normal here and as a missing style everywhere else.
   */
  function listParagraphStyleId(): string | null {
    let byId: string | null = null;
    for (const style of session.documentStyles()) {
      if (style.type !== 'paragraph') continue;
      if (style.name.trim().toLowerCase() === LIST_PARAGRAPH_NAME) return style.styleId;
      if (byId === null && style.styleId === LIST_PARAGRAPH_STYLE_ID) byId = style.styleId;
    }
    return byId;
  }

  /**
   * The document's `w:default="1"` paragraph style, memoized on the styles root.
   *
   * Read through the layout cascade's own resolver rather than by matching the attribute:
   * `w:default` is `ST_OnOff`, so `on` and `true` are legal spellings of `1`, and defaults
   * are last-wins. The styles part is immutable for the session, so this builds once.
   */
  let defaultStyleMemo:
    | { readonly root: OoxmlElement | null; readonly styleId: string | null }
    | undefined;
  function defaultParagraphStyleId(): string | null {
    const root = session.stylesRoot();
    if (defaultStyleMemo === undefined || defaultStyleMemo.root !== root) {
      defaultStyleMemo = {
        root,
        styleId: buildStyleCascadeTable(root, session.documentThemeFonts()).defaultParagraphStyleId,
      };
    }
    return defaultStyleMemo.styleId;
  }

  return {
    applyOps(touched) {
      const styleId = listParagraphStyleId();
      if (styleId === null) return [];
      const defaultStyleId = defaultParagraphStyleId();
      const part = deps.storyPart();
      const ops: TreeDocOp[] = [];
      for (const paragraphId of touched) {
        const properties = directParagraphProperties(part, paragraphId);
        const authored = authoredStyleId(properties);
        if (authored !== undefined && authored !== defaultStyleId) continue;
        ops.push({
          op: 'setParagraphProperties',
          paragraphId,
          properties: mergedProperties(properties, {
            localName: 'pStyle',
            attributes: { val: styleId },
          }),
        });
      }
      return ops;
    },

    clearOp(paragraphId) {
      const styleId = listParagraphStyleId();
      if (styleId === null) return null;
      const properties = directParagraphProperties(deps.storyPart(), paragraphId);
      if (authoredStyleId(properties) !== styleId) return null;
      return {
        op: 'setParagraphProperties',
        paragraphId,
        properties: properties.filter((property) => property.localName !== 'pStyle'),
      };
    },
  };
}
