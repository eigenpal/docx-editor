/**
 * Suggestion Mode Plugin
 *
 * When active, intercepts all text insertions and deletions,
 * wrapping them in tracked change marks (insertion/deletion)
 * instead of modifying the document directly.
 *
 * - Typed text is marked as insertion (green underline)
 * - Deleted text is NOT removed — it's marked as deletion (red strikethrough)
 * - Text already marked as insertion by the current author is deleted normally
 *   (retracting your own suggestion)
 */

import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

export const suggestionModeKey = new PluginKey<SuggestionModeState>('suggestionMode');

interface SuggestionModeState {
  active: boolean;
  author: string;
}

interface MarkAttrs {
  revisionId: number;
  author: string;
  date: string;
}

function makeMarkAttrs(pluginState: SuggestionModeState): MarkAttrs {
  return {
    revisionId: Date.now(),
    author: pluginState.author,
    date: new Date().toISOString(),
  };
}

/**
 * Find an adjacent mark of the same type by the same author.
 * Reuses its revisionId so consecutive edits group into one change.
 */
function findAdjacentRevision(
  doc: PMNode,
  pos: number,
  markTypeName: string,
  author: string
): MarkAttrs | null {
  if (pos > 0) {
    const $pos = doc.resolve(pos);
    const before = $pos.nodeBefore;
    if (before?.isText) {
      const mark = before.marks.find(
        (m) => m.type.name === markTypeName && m.attrs.author === author
      );
      if (mark) return mark.attrs as MarkAttrs;
    }
  }
  if (pos < doc.content.size) {
    const $pos = doc.resolve(pos);
    const after = $pos.nodeAfter;
    if (after?.isText) {
      const mark = after.marks.find(
        (m) => m.type.name === markTypeName && m.attrs.author === author
      );
      if (mark) return mark.attrs as MarkAttrs;
    }
  }
  return null;
}

/**
 * Handle delete (forward or backward) in suggestion mode.
 * Instead of deleting text, mark it as a deletion.
 * Exception: if the text is our own insertion, actually delete it (retract).
 */
function handleSuggestionDelete(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  direction: 'backward' | 'forward'
): boolean {
  const pluginState = suggestionModeKey.getState(state);
  if (!pluginState?.active) return false;

  const { $from, $to, empty } = state.selection;
  const insertionType = state.schema.marks.insertion;
  const deletionType = state.schema.marks.deletion;
  if (!insertionType || !deletionType) return false;

  // Selection delete: mark the whole selection as deletion (or retract own insertions)
  if (!empty) {
    if (!dispatch) return true;

    const tr = state.tr;
    tr.setMeta('suggestionModeApplied', true);

    // Walk through selected text and handle each node
    const ranges: { from: number; to: number; isOwnInsert: boolean }[] = [];
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (!node.isText) return;
      const start = Math.max(pos, $from.pos);
      const end = Math.min(pos + node.nodeSize, $to.pos);
      const hasOwnInsertion = node.marks.some(
        (m) => m.type === insertionType && m.attrs.author === pluginState.author
      );
      ranges.push({ from: start, to: end, isOwnInsert: hasOwnInsertion });
    });

    // Reuse adjacent deletion revisionId so consecutive deletes group together
    const delAttrs =
      findAdjacentRevision(state.doc, $from.pos, 'deletion', pluginState.author) ||
      makeMarkAttrs(pluginState);

    // Process in reverse to preserve positions
    for (let i = ranges.length - 1; i >= 0; i--) {
      const range = ranges[i];
      if (range.isOwnInsert) {
        // Retract own insertion — actually delete
        tr.delete(range.from, range.to);
      } else {
        // Mark as deletion
        tr.addMark(range.from, range.to, deletionType.create(delAttrs));
      }
    }

    // Place cursor at the start of the range
    dispatch(tr.scrollIntoView());
    return true;
  }

  // Single character delete (cursor, no selection)
  if (!dispatch) return true;

  const isBackward = direction === 'backward';
  const deletePos = isBackward ? $from.pos - 1 : $from.pos;
  const deleteEnd = isBackward ? $from.pos : $from.pos + 1;

  // Bounds check
  if (deletePos < 0 || deleteEnd > state.doc.content.size) return true;

  // Check what's at the position we'd delete
  const $deletePos = state.doc.resolve(deletePos);
  const nodeAfter = $deletePos.nodeAfter;

  // If at a block boundary, let default behavior handle (join paragraphs)
  if (!nodeAfter?.isText) return false;

  const tr = state.tr;
  tr.setMeta('suggestionModeApplied', true);

  // Check if this text is our own insertion — retract it
  const hasOwnInsertion = nodeAfter.marks.some(
    (m) => m.type === insertionType && m.attrs.author === pluginState.author
  );

  // Check if already marked as deletion — skip over it
  const hasDeletion = nodeAfter.marks.some((m) => m.type === deletionType);

  if (hasDeletion) {
    // Already deleted — just move cursor past it
    const newPos = isBackward ? deletePos : deleteEnd;
    tr.setSelection(TextSelection.near(tr.doc.resolve(newPos)));
    dispatch(tr.scrollIntoView());
    return true;
  }

  if (hasOwnInsertion) {
    // Retract own insertion — actually delete the character
    tr.delete(deletePos, deleteEnd);
  } else {
    // Mark as deletion instead of removing — reuse adjacent deletion's revisionId
    const singleDelAttrs =
      findAdjacentRevision(state.doc, deletePos, 'deletion', pluginState.author) ||
      makeMarkAttrs(pluginState);
    tr.addMark(deletePos, deleteEnd, deletionType.create(singleDelAttrs));
    // Move cursor past the deletion mark
    if (isBackward) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(deletePos)));
    } else {
      tr.setSelection(TextSelection.near(tr.doc.resolve(deleteEnd)));
    }
  }

  dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Create the suggestion mode plugin.
 * When active, text edits become tracked changes.
 */
export function createSuggestionModePlugin(initialActive = false, author = 'User'): Plugin {
  return new Plugin({
    key: suggestionModeKey,

    state: {
      init(): SuggestionModeState {
        return { active: initialActive, author };
      },
      apply(tr, state): SuggestionModeState {
        const meta = tr.getMeta(suggestionModeKey);
        if (meta) {
          return { ...state, ...meta };
        }
        return state;
      },
    },

    props: {
      // Intercept Backspace and Delete to mark as deletion
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        const pluginState = suggestionModeKey.getState(view.state);
        if (!pluginState?.active) return false;

        if (event.key === 'Backspace') {
          return handleSuggestionDelete(view.state, view.dispatch, 'backward');
        }
        if (event.key === 'Delete') {
          return handleSuggestionDelete(view.state, view.dispatch, 'forward');
        }
        return false;
      },

      // Intercept text input to add insertion marks
      handleTextInput(view: EditorView, from: number, to: number, text: string): boolean {
        const pluginState = suggestionModeKey.getState(view.state);
        if (!pluginState?.active) return false;

        const insertionType = view.state.schema.marks.insertion;
        if (!insertionType) return false;

        const tr = view.state.tr;
        tr.setMeta('suggestionModeApplied', true);

        // Reuse adjacent insertion's revisionId so consecutive typing groups together
        const markAttrs =
          findAdjacentRevision(view.state.doc, from, 'insertion', pluginState.author) ||
          makeMarkAttrs(pluginState);

        // If replacing a selection, mark the replaced content as deletion first
        if (from !== to) {
          const deletionType = view.state.schema.marks.deletion;
          if (deletionType) {
            // Walk through selected text — retract own insertions, mark others as deleted
            const ranges: { from: number; to: number; isOwnInsert: boolean }[] = [];
            view.state.doc.nodesBetween(from, to, (node, pos) => {
              if (!node.isText) return;
              const start = Math.max(pos, from);
              const end = Math.min(pos + node.nodeSize, to);
              const hasOwnInsertion = node.marks.some(
                (m) => m.type === insertionType && m.attrs.author === pluginState.author
              );
              ranges.push({ from: start, to: end, isOwnInsert: hasOwnInsertion });
            });

            const delAttrs =
              findAdjacentRevision(view.state.doc, from, 'deletion', pluginState.author) ||
              makeMarkAttrs(pluginState);

            // Process own insertions — delete them; others — mark as deleted
            for (let i = ranges.length - 1; i >= 0; i--) {
              const range = ranges[i];
              if (range.isOwnInsert) {
                tr.delete(range.from, range.to);
              } else {
                tr.addMark(range.from, range.to, deletionType.create(delAttrs));
              }
            }
          }
        }

        // Insert the new text after the deletion-marked content
        const insertPos = tr.mapping.map(to);
        tr.insertText(text, from === to ? insertPos : tr.mapping.map(from), insertPos);

        // Mark the inserted text with insertion mark
        const insertedFrom = tr.mapping.map(from === to ? from : from);
        const insertedTo = insertedFrom + text.length;
        tr.addMark(insertedFrom, insertedTo, insertionType.create(markAttrs));

        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },

    appendTransaction(transactions, _oldState, newState) {
      const pluginState = suggestionModeKey.getState(newState);
      if (!pluginState?.active) return null;

      // Only process user-initiated transactions that we didn't already handle
      const userTr = transactions.find(
        (tr) => tr.docChanged && !tr.getMeta('suggestionModeApplied')
      );
      if (!userTr) return null;

      const insertionType = newState.schema.marks.insertion;
      if (!insertionType) return null;

      const markAttrs = makeMarkAttrs(pluginState);

      // Mark any new content (e.g. from paste) as insertion
      const tr = newState.tr;
      tr.setMeta('suggestionModeApplied', true);

      userTr.steps.forEach((step) => {
        const stepMap = step.getMap();
        stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
          if (newTo > newFrom) {
            tr.addMark(newFrom, newTo, insertionType.create(markAttrs));
          }
        });
      });

      return tr.steps.length > 0 ? tr : null;
    },
  });
}

/**
 * Toggle suggestion mode on/off.
 */
export function toggleSuggestionMode(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const current = suggestionModeKey.getState(state);
  if (!current) return false;

  if (dispatch) {
    const tr = state.tr.setMeta(suggestionModeKey, {
      active: !current.active,
    });
    dispatch(tr);
  }
  return true;
}

/**
 * Set suggestion mode active state and author.
 */
export function setSuggestionMode(
  active: boolean,
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  author?: string
): boolean {
  if (dispatch) {
    const meta: Partial<SuggestionModeState> = { active };
    if (author !== undefined) meta.author = author;
    const tr = state.tr.setMeta(suggestionModeKey, meta);
    dispatch(tr);
  }
  return true;
}

/**
 * Check if suggestion mode is currently active.
 */
export function isSuggestionModeActive(state: EditorState): boolean {
  return suggestionModeKey.getState(state)?.active ?? false;
}
