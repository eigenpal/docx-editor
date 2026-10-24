// The run direction of typed text: letters typed in a right-to-left script start a `w:rtl`
// run. Other text keeps the direction of the run it joins.
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import { runDirectionFormattingContext } from '../layout/complex-script-formatting.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from '../layout/revision-projection.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import { complexScriptAt } from '../store/store/direct-properties.ts';
import { partOfNodeId } from './surface-scope.ts';

/** Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic, and their presentation forms. */
const RTL_LETTER = /[֐-׿؀-ٟٮ-ۯۺ-ࣿיִ-﷿ﹰ-﻿]/u;
const LETTER = /\p{L}/u;

/**
 * The direction the first letter of `text` asks for, or null when it has no letter. Digits,
 * spaces, and punctuation decide nothing: they take the direction of the run they join.
 */
export function typedTextDirection(text: string): 'rtl' | 'ltr' | null {
  for (const char of text) {
    if (!LETTER.test(char)) continue;
    return RTL_LETTER.test(char) ? 'rtl' : 'ltr';
  }
  return null;
}

/**
 * The run-direction write for right-to-left letters typed at a caret, or none when the run
 * the text joins is already right-to-left. Latin letters typed into a right-to-left run keep
 * that run's direction.
 *
 * A keyboard in a right-to-left language marks what it types as right-to-left text
 * (`w:rtl`). The browser does not report the keyboard, so the first letter of the typed text
 * stands for it. The write rides the insert's own transaction: one undo step, and refused
 * together with the other caret formats.
 */
export function createTypedDirectionOps(
  session: Pick<TreeDocxSessionView, 'currentPackage' | 'part' | 'stylesRoot' | 'settingsRoot'>,
  displayMode: () => RevisionDisplayMode,
  authorFilter: () => RevisionAuthorFilter | undefined
) {
  /** `target` is the caret before the insert; `landing` is the caret after the typed text. */
  return (
    target: { readonly paragraphId: string; readonly offset: number },
    landing: number,
    text: string
  ): TreeDocOp[] => {
    const { paragraphId, offset: caretOffset } = target;
    const landingStart = landing - text.length;
    if (typedTextDirection(text) !== 'rtl') return [];
    const mode = displayMode();
    const filter = authorFilter();
    const rtl = complexScriptAt(
      partOfNodeId(session, paragraphId) ?? session.part(),
      paragraphId,
      caretOffset,
      runDirectionFormattingContext(session.stylesRoot(), session.settingsRoot(), mode, filter),
      mode,
      filter
    );
    if (rtl) return [];
    return [
      {
        op: 'setRunProperties',
        paragraphId,
        start: landingStart,
        end: landingStart + text.length,
        properties: [{ localName: 'rtl' }],
      },
    ];
  };
}
