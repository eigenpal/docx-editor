/**
 * Page Break Commands
 */

import type { Command } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';

/**
 * Insert a page break at the current cursor position.
 * Always ensures a paragraph follows the page break and places the cursor there.
 */
export const insertPageBreak: Command = (state, dispatch) => {
  const { schema } = state;
  const pageBreakType = schema.nodes.pageBreak;
  const paragraphType = schema.nodes.paragraph;
  if (!pageBreakType || !paragraphType) return false;

  if (dispatch) {
    const { $from } = state.selection;
    const tr = state.tr;
    const pbNode = pageBreakType.create();
    const pbSize = pbNode.nodeSize;
    let cursorPos: number;

    if ($from.parent.isTextblock) {
      if ($from.parentOffset > 0 && $from.parentOffset < $from.parent.content.size) {
        // Mid-text: split paragraph, then insert pageBreak + empty paragraph between them
        tr.split($from.pos);
        const mappedPos = tr.mapping.map($from.pos);
        tr.insert(mappedPos, Fragment.from([pbNode, paragraphType.create()]));
        cursorPos = mappedPos + pbSize + 1;
      } else if ($from.parentOffset === $from.parent.content.size) {
        // End of text block: insert pageBreak + empty paragraph after this block
        const after = $from.after();
        tr.insert(after, Fragment.from([pbNode, paragraphType.create()]));
        cursorPos = after + pbSize + 1;
      } else {
        // Start of text block: insert pageBreak before, current block remains after
        const before = $from.before();
        tr.insert(before, pbNode);
        cursorPos = before + pbSize + 1;
      }
    } else {
      // Not in a textblock — insert pageBreak + empty paragraph at current position
      const pos = $from.pos;
      tr.insert(pos, Fragment.from([pbNode, paragraphType.create()]));
      cursorPos = pos + pbSize + 1;
    }

    tr.setSelection(TextSelection.create(tr.doc, cursorPos));
    dispatch(tr.scrollIntoView());
  }

  return true;
};
