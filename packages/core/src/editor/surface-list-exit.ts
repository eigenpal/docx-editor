// Leaving a list from the keyboard: Enter on an empty item, Backspace at an item's start.
//
// Both keys say "this paragraph is done being a list item", and both answer whether they
// handled the key, so the caller falls through to its ordinary split or join when they did
// not.

import type { TreeApplyResult } from '@docx-editor.dev/core/binding';
import type {
  ListMarkerRecord,
  SemanticLayout,
  SemanticPosition,
} from '@docx-editor.dev/core/layout';
import type { OoxmlPart, TreeDocOp } from '@docx-editor.dev/core/store';
import type { createListNumberingOps } from './list-numbering-ops.ts';
import type { createListStyleWrites } from './surface-list-style.ts';
import { directParagraphProperties, paragraphPropertiesOf } from './surface-formatting.ts';
import { leftIndentTwipsOf } from './surface-indent-step.ts';

export interface ListExitDeps {
  orderedRange(): { from: SemanticPosition; to: SemanticPosition };
  layout(): SemanticLayout;
  storyPart(): OoxmlPart;
  markerOf(paragraphId: string): ListMarkerRecord | null;
  listLevelExists(marker: ListMarkerRecord, level: number): boolean;
  paragraphTextOf(paragraphId: string): string;
  listNumbering: ReturnType<typeof createListNumberingOps>;
  listStyle: ReturnType<typeof createListStyleWrites>;
  /** Apply ops in one commit; answers whether they committed. */
  commitOps(ops: readonly TreeDocOp[]): boolean;
}

/** The `w:ind` attributes that state a first-line or hanging indent, in both units. */
const FIRST_LINE_ATTRIBUTES = ['firstLine', 'hanging', 'firstLineChars', 'hangingChars'];

export function createListExit(deps: ListExitDeps) {
  /** The list item a collapsed caret is in, or null for a range or an ordinary paragraph. */
  function caretItem(): { position: SemanticPosition; marker: ListMarkerRecord } | null {
    const { from, to } = deps.orderedRange();
    if (from.paragraphId !== to.paragraphId || from.offset !== to.offset) return null;
    const marker = deps.markerOf(from.paragraphId);
    return marker ? { position: from, marker } : null;
  }

  /**
   * The paragraph's own `w:ind` after its marker goes, holding the text where it was.
   *
   * Word writes the left indent the list gave the text as the paragraph's own, and drops the
   * hanging indent that made room for the marker. A style that numbers the paragraph always
   * gets the left indent written. Otherwise Word writes it only when the style alone would
   * put the text elsewhere, and cancels a first-line or hanging indent the style carries with
   * `w:firstLine="0"`. List Paragraph at the first level needs neither, so nothing is written.
   */
  function heldIndentOp(paragraphId: string): TreeDocOp | null {
    const textLeft = leftIndentTwipsOf(paragraphPropertiesOf(deps.layout(), paragraphId));
    const direct = directParagraphProperties(deps.storyPart(), paragraphId);
    const authored = direct.find((property) => property.localName === 'ind')?.attributes;
    const fromStyle = deps.listNumbering.styleNumbered(paragraphId);
    const style = deps.listNumbering.styleIndent(paragraphId);
    const writeLeft = fromStyle || authored !== undefined || style.left !== textLeft;
    const cancelFirstLine = !fromStyle && (style.firstLine !== 0 || style.inChars);
    if (!writeLeft && !cancelFirstLine) return null;
    const attributes: Record<string, string> = { ...(authored ?? {}) };
    for (const name of FIRST_LINE_ATTRIBUTES) delete attributes[name];
    if (cancelFirstLine) attributes.firstLine = '0';
    // A style's character-unit first line supersedes the twips, so it is cancelled too.
    if (cancelFirstLine && style.inChars) attributes.firstLineChars = '0';
    if (writeLeft) {
      // The character-unit twin supersedes the twips (§17.3.1.12), so it goes with the write.
      delete attributes.leftChars;
      delete attributes.startChars;
      const value = String(textLeft);
      if (authored?.start !== undefined) attributes.start = value;
      if (authored?.start === undefined || authored.left !== undefined) attributes.left = value;
    }
    return {
      op: 'setParagraphProperties',
      paragraphId,
      properties: [
        ...direct.filter((property) => property.localName !== 'ind'),
        { localName: 'ind', attributes },
      ],
    };
  }

  return {
    /**
     * Enter on an EMPTY list item leaves the list, the way Word does.
     *
     * Pressing Enter at the end of a list makes another item; pressing it again on that
     * still-empty item is how a user says "I am done with this list". Word outdents one
     * level per press and drops the numbering at level 0.
     */
    exitListOnEmptyItem(): boolean {
      const item = caretItem();
      if (!item) return false;
      const { position, marker } = item;
      // Only an EMPTY item: Enter inside text still splits the paragraph.
      if (deps.paragraphTextOf(position.paragraphId).length > 0) return false;

      const outdented = marker.level > 0 && deps.listLevelExists(marker, marker.level - 1);
      // Outdenting stays in the list, so it keeps the style. Leaving the list sheds it, or
      // the paragraph keeps List Paragraph's half-inch indent with no marker beside it —
      // see `clearListParagraphStyleOp`. The style write goes first for the same reason it
      // does in `toggleList`: it carries the authored `w:numPr` forward, so running it
      // after the numbering op would put back what that op had just removed.
      const ops: TreeDocOp[] = [];
      if (outdented) {
        ops.push(deps.listNumbering.levelOp(position.paragraphId, marker.numId, marker.level - 1));
      } else {
        const cleared = deps.listStyle.clearOp(position.paragraphId);
        if (cleared) ops.push(cleared);
        ops.push(deps.listNumbering.leaveOp(position.paragraphId));
      }
      return deps.commitOps(ops);
    },

    /**
     * Backspace at the START of a list item removes its number or bullet, the way Word does.
     *
     * The text stays on its own line, where the list put it, and the paragraph keeps its
     * style. Only a later Backspace reaches the previous paragraph. The caller has already
     * found the caret at the paragraph's visible start. The indent write goes first: it
     * restates the paragraph's own properties, `w:numPr` included, so the numbering op has to
     * run after it.
     */
    removeListNumber(paragraphId: string): boolean {
      // The tree decides, not the painted marker: see `numbered`. A paragraph with nothing
      // left to remove falls through to the join instead of committing a no-op forever.
      if (!deps.markerOf(paragraphId) || !deps.listNumbering.numbered(paragraphId)) return false;
      const held = heldIndentOp(paragraphId);
      // A refused write still answers true: the key is spent on the refusal the commit
      // published, rather than joining the paragraph the user asked to keep.
      deps.commitOps([...(held ? [held] : []), deps.listNumbering.leaveOp(paragraphId)]);
      return true;
    },
  };
}

export type ListExitMethods = ReturnType<typeof createListExit>;

/** Commit `ops` through a lane's commit, reporting whether the transaction landed. */
export function commitListOps(
  commit: (run: () => TreeApplyResult | boolean) => void,
  apply: (ops: TreeDocOp[]) => TreeApplyResult,
  ops: readonly TreeDocOp[]
): boolean {
  let committed = false;
  commit(() => {
    const result = apply([...ops]);
    committed = result.committed;
    return result;
  });
  return committed;
}
