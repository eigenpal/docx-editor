/**
 * Stored Marks Sync Plugin
 *
 * Ensures empty paragraphs with defaultTextFormatting restore stored marks
 * when the cursor re-enters the paragraph.
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Mark } from 'prosemirror-model';
import type { TextFormatting } from '../../types/document';
import { textFormattingToMarks } from '../extensions/marks/markUtils';

export const storedMarksSyncKey = new PluginKey('storedMarksSync');

const FORMATTING_MARKS = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'textColor',
  'highlight',
  'fontSize',
  'fontFamily',
  'superscript',
  'subscript',
]);

function marksEqual(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((mark) => b.some((other) => other.eq(mark)));
}

function getFormattingMarks(dtf: TextFormatting | null | undefined, state: EditorState): Mark[] {
  if (!dtf) return [];
  return textFormattingToMarks(dtf, state.schema);
}

function buildNextMarks(current: readonly Mark[], formatting: readonly Mark[]): Mark[] {
  const preserved = current.filter((mark) => !FORMATTING_MARKS.has(mark.type.name));
  return [...preserved, ...formatting];
}

function syncStoredMarks(view: EditorView): void {
  const { state } = view;
  const { selection } = state;

  if (!selection.empty) return;

  const $from = selection.$from;
  const paragraph = $from.parent;

  if (paragraph.type.name !== 'paragraph') return;
  if (paragraph.textContent.length > 0) return;

  const dtf = paragraph.attrs.defaultTextFormatting as TextFormatting | null | undefined;
  const formattingMarks = getFormattingMarks(dtf, state);
  const currentMarks = state.storedMarks ?? $from.marks();
  const nextMarks = buildNextMarks(currentMarks, formattingMarks);

  if (marksEqual(currentMarks, nextMarks)) return;

  view.dispatch(state.tr.setStoredMarks(nextMarks));
}

export function createStoredMarksSyncPlugin(): Plugin {
  return new Plugin({
    key: storedMarksSyncKey,
    view() {
      return {
        update(view, prevState) {
          if (
            view.state.selection.eq(prevState.selection) &&
            view.state.doc.eq(prevState.doc) &&
            view.state.storedMarks === prevState.storedMarks
          ) {
            return;
          }
          syncStoredMarks(view);
        },
      };
    },
  });
}
