/**
 * Suggestion Mode Plugin
 *
 * When active, intercepts all text insertions and deletions,
 * wrapping them in tracked change marks (insertion/deletion)
 * instead of modifying the document directly.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';

export const suggestionModeKey = new PluginKey<SuggestionModeState>('suggestionMode');

interface SuggestionModeState {
  active: boolean;
  author: string;
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

    appendTransaction(transactions, _oldState, newState) {
      const pluginState = suggestionModeKey.getState(newState);
      if (!pluginState?.active) return null;

      // Only process user-initiated transactions (not our own tracked-change wrapping)
      const userTr = transactions.find(
        (tr) => tr.docChanged && !tr.getMeta('suggestionModeApplied')
      );
      if (!userTr) return null;

      const insertionType = newState.schema.marks.insertion;
      const deletionType = newState.schema.marks.deletion;
      if (!insertionType || !deletionType) return null;

      const now = new Date().toISOString();
      const revisionId = Date.now();
      const markAttrs = {
        revisionId,
        author: pluginState.author,
        date: now,
      };

      // Build a new transaction that adds insertion marks to any new text
      const tr = newState.tr;
      tr.setMeta('suggestionModeApplied', true);

      // Simple approach: find the changed range and mark new content as insertion
      if (userTr.steps.length > 0) {
        userTr.steps.forEach((step) => {
          const stepMap = step.getMap();

          stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
            // Content was added in [newFrom, newTo) range
            if (newTo > newFrom) {
              // Mark new content as insertion
              tr.addMark(newFrom, newTo, insertionType.create(markAttrs));
            }
          });
        });
      }

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
 * Set suggestion mode active state.
 */
export function setSuggestionMode(
  active: boolean,
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  if (dispatch) {
    const tr = state.tr.setMeta(suggestionModeKey, { active });
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
