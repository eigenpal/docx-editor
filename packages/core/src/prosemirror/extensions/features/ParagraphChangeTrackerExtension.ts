/**
 * Paragraph Change Tracker Extension
 *
 * Watches ProseMirror transactions and records which paragraph IDs (paraId)
 * were modified. Also detects structural changes (paragraphs added/deleted).
 * Used by the selective save system to patch only changed paragraphs in document.xml.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { createExtension } from '../create';
import type { ExtensionRuntime } from '../types';

export const paragraphChangeTrackerKey = new PluginKey<ParagraphChangeTrackerState>(
  'paragraphChangeTracker'
);

export interface ParagraphChangeTrackerState {
  /** Set of paraIds that were modified since last clear */
  changedParaIds: Set<string>;
  /** Whether paragraphs were added or deleted (structural change) */
  structuralChange: boolean;
  /** Whether any edited paragraph lacked a paraId */
  hasUntrackedChanges: boolean;
}

function createInitialState(): ParagraphChangeTrackerState {
  return {
    changedParaIds: new Set(),
    structuralChange: false,
    hasUntrackedChanges: false,
  };
}

/**
 * Count paragraph nodes in a ProseMirror document
 */
function countParagraphs(doc: EditorState['doc']): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === 'paragraph') {
      count++;
    }
  });
  return count;
}

/**
 * Collect paraIds of all paragraphs that overlap with the given range
 */
function collectAffectedParaIds(
  doc: EditorState['doc'],
  from: number,
  to: number
): { ids: Set<string>; hasUntracked: boolean } {
  const ids = new Set<string>();
  let hasUntracked = false;

  doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'paragraph') {
      const paraId = node.attrs.paraId as string | undefined | null;
      if (paraId) {
        ids.add(paraId);
      } else {
        hasUntracked = true;
      }
    }
  });

  return { ids, hasUntracked };
}

function createParagraphChangeTrackerPlugin(): Plugin<ParagraphChangeTrackerState> {
  return new Plugin<ParagraphChangeTrackerState>({
    key: paragraphChangeTrackerKey,
    state: {
      init: createInitialState,
      apply(tr: Transaction, prevState: ParagraphChangeTrackerState): ParagraphChangeTrackerState {
        // Check for explicit clear meta
        if (tr.getMeta(paragraphChangeTrackerKey) === 'clear') {
          return createInitialState();
        }

        // If no doc changes, keep previous state
        if (!tr.docChanged) {
          return prevState;
        }

        // Clone previous state
        const newState: ParagraphChangeTrackerState = {
          changedParaIds: new Set(prevState.changedParaIds),
          structuralChange: prevState.structuralChange,
          hasUntrackedChanges: prevState.hasUntrackedChanges,
        };

        // Check for structural changes (paragraph count changed)
        const oldCount = countParagraphs(tr.before);
        const newCount = countParagraphs(tr.doc);
        if (oldCount !== newCount) {
          newState.structuralChange = true;
        }

        // Track which paragraphs were affected by each step
        for (const step of tr.steps) {
          const stepMap = step.getMap();
          stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            // Collect paraIds from the NEW document in the affected range
            const { ids, hasUntracked } = collectAffectedParaIds(tr.doc, newStart, newEnd);
            for (const id of ids) {
              newState.changedParaIds.add(id);
            }
            if (hasUntracked) {
              newState.hasUntrackedChanges = true;
            }
          });
        }

        return newState;
      },
    },
  });
}

/**
 * Get the change tracker state from an EditorState
 */
export function getChangeTrackerState(state: EditorState): ParagraphChangeTrackerState | undefined {
  return paragraphChangeTrackerKey.getState(state);
}

/**
 * Get the set of changed paragraph IDs from an EditorState
 */
export function getChangedParagraphIds(state: EditorState): Set<string> {
  return getChangeTrackerState(state)?.changedParaIds ?? new Set();
}

/**
 * Check if structural changes (paragraph add/delete) occurred
 */
export function hasStructuralChanges(state: EditorState): boolean {
  const trackerState = getChangeTrackerState(state);
  return trackerState?.structuralChange ?? false;
}

/**
 * Check if any changes affected paragraphs without paraId
 */
export function hasUntrackedChanges(state: EditorState): boolean {
  const trackerState = getChangeTrackerState(state);
  return trackerState?.hasUntrackedChanges ?? false;
}

/**
 * Create a transaction that clears the change tracker
 */
export function clearTrackedChanges(state: EditorState): Transaction {
  return state.tr.setMeta(paragraphChangeTrackerKey, 'clear');
}

export const ParagraphChangeTrackerExtension = createExtension({
  name: 'paragraphChangeTracker',
  defaultOptions: {},
  onSchemaReady(): ExtensionRuntime {
    return {
      plugins: [createParagraphChangeTrackerPlugin()],
    };
  },
});
