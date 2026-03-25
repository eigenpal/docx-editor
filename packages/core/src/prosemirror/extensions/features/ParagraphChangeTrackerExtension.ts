/**
 * Paragraph Change Tracker Extension
 *
 * Watches ProseMirror transactions and records which paragraph IDs (paraId)
 * were modified. Also detects structural changes (paragraphs added/deleted).
 * Used by the selective save system to patch only changed paragraphs in document.xml.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import {
  AddMarkStep,
  AddNodeMarkStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
} from 'prosemirror-transform';
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
  /** Cached paragraph count to avoid full doc traversal on every transaction */
  paragraphCount: number;
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

/**
 * AddMarkStep / RemoveMarkStep inherit Step.getMap() → StepMap.empty, so we use
 * their from/to to find affected paragraphs.
 * Node mark steps use a single position before the target node.
 */
function collectAffectedParaIdsFromMarkLikeStep(
  doc: EditorState['doc'],
  from: number,
  to: number
): { ids: Set<string>; hasUntracked: boolean } {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const end = hi > lo ? hi : lo + 1;
  const primary = collectAffectedParaIds(doc, lo, end);
  if (primary.ids.size > 0 || primary.hasUntracked) {
    return primary;
  }
  // Collapsed range (e.g. empty paragraph): walk up to enclosing paragraph
  try {
    const $p = doc.resolve(lo);
    for (let d = $p.depth; d >= 0; d--) {
      const n = $p.node(d);
      if (n.type.name === 'paragraph') {
        const paraId = n.attrs.paraId as string | undefined | null;
        if (paraId) {
          return { ids: new Set([paraId]), hasUntracked: false };
        }
        return { ids: new Set(), hasUntracked: true };
      }
    }
  } catch {
    // ignore
  }
  return { ids: new Set(), hasUntracked: false };
}

function createParagraphChangeTrackerPlugin(): Plugin<ParagraphChangeTrackerState> {
  return new Plugin<ParagraphChangeTrackerState>({
    key: paragraphChangeTrackerKey,
    state: {
      init(_config, state): ParagraphChangeTrackerState {
        return {
          changedParaIds: new Set(),
          structuralChange: false,
          hasUntrackedChanges: false,
          paragraphCount: countParagraphs(state.doc),
        };
      },
      apply(tr: Transaction, prevState: ParagraphChangeTrackerState): ParagraphChangeTrackerState {
        // Check for explicit clear meta
        if (tr.getMeta(paragraphChangeTrackerKey) === 'clear') {
          return {
            changedParaIds: new Set(),
            structuralChange: false,
            hasUntrackedChanges: false,
            paragraphCount: prevState.paragraphCount,
          };
        }

        // If no doc changes, keep previous state
        if (!tr.docChanged) {
          return prevState;
        }

        // Count paragraphs in new doc only (use cached count for old doc)
        const newCount = countParagraphs(tr.doc);

        // Clone previous state
        const newState: ParagraphChangeTrackerState = {
          changedParaIds: new Set(prevState.changedParaIds),
          structuralChange: prevState.structuralChange,
          hasUntrackedChanges: prevState.hasUntrackedChanges,
          paragraphCount: newCount,
        };

        // Check for structural changes (paragraph count changed)
        if (prevState.paragraphCount !== newCount) {
          newState.structuralChange = true;
        }

        // Track which paragraphs were affected by each step
        for (const step of tr.steps) {
          if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
            const { ids, hasUntracked } = collectAffectedParaIdsFromMarkLikeStep(
              tr.doc,
              step.from,
              step.to
            );
            for (const id of ids) {
              newState.changedParaIds.add(id);
            }
            if (hasUntracked) {
              newState.hasUntrackedChanges = true;
            }
            continue;
          }

          if (step instanceof AddNodeMarkStep || step instanceof RemoveNodeMarkStep) {
            const pos = step.pos;
            const node = tr.doc.nodeAt(pos);
            const end = node ? pos + node.nodeSize : pos + 1;
            const { ids, hasUntracked } = collectAffectedParaIds(tr.doc, pos, end);
            for (const id of ids) {
              newState.changedParaIds.add(id);
            }
            if (hasUntracked) {
              newState.hasUntrackedChanges = true;
            }
            continue;
          }

          const stepMap = step.getMap();
          stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
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
