import { findNode, type OoxmlPart, type TreeDocOp } from '@docx-editor.dev/core/store';
import {
  cascadeParagraphFormatting,
  readNumPr,
  type SemanticLayout,
  type StyleCascadeTable,
} from '@docx-editor.dev/core/layout';
import { fragmentHolding } from '../layout/line-segments.ts';
import { namedChild, paragraphPropertiesNodeOf } from '../store/store/tree-op-nodes.ts';

export interface ListNumberingDeps {
  storyPart(): OoxmlPart;
  styleCascade(): StyleCascadeTable | undefined;
  layout(): SemanticLayout;
}

/**
 * List writes for an item numbered through its paragraph style, which has no `w:numPr` of
 * its own for `setListLevel` to rewrite or for `setListNumbering(null)` to remove.
 *
 * A paragraph absorbed into another's fragment by a struck mark is drawn with that
 * paragraph's marker, so it keeps the plain ops: the style writes are for its own marker only.
 */
export function createListNumberingOps(deps: ListNumberingDeps) {
  const absorbed = (paragraphId: string) =>
    fragmentHolding(deps.layout(), paragraphId)?.paragraphId !== paragraphId;

  /** The numbering the paragraph's style chain gives it, its own `w:numPr` aside. */
  function styleNumbering(paragraphId: string): { numId: string; ilvl: number } | null {
    const styles = deps.styleCascade();
    const paragraph = findNode(deps.storyPart(), paragraphId);
    if (!styles || !paragraph) return null;
    const pPr = paragraphPropertiesNodeOf(paragraph);
    // The cascade's last tier is the paragraph's own `w:pPr`, which still names the style.
    const tiers = cascadeParagraphFormatting(styles, pPr).paragraphPropertyNodes;
    return readNumPr(tiers.filter((tier) => tier !== pPr));
  }

  return {
    /** `numId` is the list the level was declared on. */
    levelOp(paragraphId: string, numId: string, level: number): TreeDocOp {
      const paragraph = findNode(deps.storyPart(), paragraphId);
      const ownsNumPr = paragraph && namedChild(paragraphPropertiesNodeOf(paragraph), 'numPr');
      const styleNumbered =
        !ownsNumPr && !absorbed(paragraphId) && styleNumbering(paragraphId)?.numId === numId;
      return styleNumbered
        ? { op: 'setListNumbering', paragraphId, numId, level }
        : { op: 'setListLevel', paragraphId, level };
    },

    /** `w:numId="0"` switches off the style's numbering (§17.9.18); removal alone would not. */
    leaveOp(paragraphId: string): TreeDocOp {
      const styleNumbered = !absorbed(paragraphId) && styleNumbering(paragraphId) !== null;
      return { op: 'setListNumbering', paragraphId, numId: styleNumbered ? '0' : null };
    },
  };
}
