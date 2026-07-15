/**
 * Merge live ProseMirror selection marks into toolbar `selectionFormatting`.
 * Empty-paragraph mark toggles bump `pmState` without a caret move; deriving
 * here keeps aria-pressed in sync without a fragile useEffect.
 *
 * List level / indent must also come from live PM: indent/outdent change
 * `numPr.ilvl` without moving the selection, and a transient null-view
 * selection callback must not leave Decrease Indent stuck disabled.
 */

import type { EditorState } from 'prosemirror-state';
import { extractSelectionState } from '@eigenpal/docx-editor-core/prosemirror';
import { resolveColorToHex } from '@eigenpal/docx-editor-core/utils';
import type { Theme } from '@eigenpal/docx-editor-core/types/document';
import type { SelectionFormatting } from '../../Toolbar';
import type { ListState } from '@eigenpal/docx-editor-core/utils/listState';

function listStateFromNumPr(
  numPr: { numId?: number; ilvl?: number } | null | undefined
): ListState | undefined {
  if (!numPr?.numId) return undefined;
  return {
    type: numPr.numId === 1 ? 'bullet' : 'numbered',
    level: numPr.ilvl ?? 0,
    isInList: true,
    numId: numPr.numId,
  };
}

export function deriveToolbarSelectionFormatting(
  pmState: EditorState | null,
  base: SelectionFormatting,
  theme: Theme | null | undefined
): SelectionFormatting {
  if (!pmState) return base;
  const sel = extractSelectionState(pmState);
  if (!sel) return base;
  const tf = sel.textFormatting;
  const fontFamily = tf.fontFamily?.ascii || tf.fontFamily?.hAnsi || base.fontFamily;
  const textColorHex = resolveColorToHex(tf.color, theme ?? undefined);
  return {
    ...base,
    bold: tf.bold === true,
    italic: tf.italic === true,
    underline: !!tf.underline,
    strike: tf.strike === true,
    superscript: tf.vertAlign === 'superscript',
    subscript: tf.vertAlign === 'subscript',
    fontFamily,
    fontSize: tf.fontSize ?? base.fontSize,
    color: textColorHex ? `#${textColorHex}` : base.color,
    highlight: tf.highlight ?? base.highlight,
    alignment: sel.paragraphFormatting.alignment ?? base.alignment,
    lineSpacing: sel.paragraphFormatting.lineSpacing ?? base.lineSpacing,
    styleId: sel.styleId ?? base.styleId,
    indentLeft: sel.paragraphFormatting.indentLeft ?? base.indentLeft,
    // Prefer live PM list attrs over cached selectionFormatting — indent does
    // not move the caret, and a stale/wiped cache would disable outdent.
    listState: listStateFromNumPr(sel.paragraphFormatting.numPr),
    bidi: !!sel.paragraphFormatting.bidi,
  };
}
