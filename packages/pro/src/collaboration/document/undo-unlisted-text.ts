/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Text that others typed in a paragraph an undo takes out of the document.
 *
 * An undo of a split, or of any edit that listed a new paragraph, removes the paragraph's
 * listing entry and keeps its record. Characters a peer typed there stay live in that record,
 * and follow a move only when they were typed beside a character whose copy shows elsewhere.
 * Typed after the undone author's own text, or in a paragraph that showed nothing, they
 * showed nowhere. So before the undo runs, the undoing replica records on each paragraph the
 * step listed where the undo joins its text back: the end of the paragraph listed right
 * before it, or, with none, the start of the paragraph listed right after it. That text then
 * shows there on every replica (`paragraph-text-follow.ts`), also when it arrives after the
 * undo. The stored form is the paragraph's ID, with a leading `^` for its start.
 */
import * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import { keyId } from './registry-node-reads.ts';
import { isNodeMap, NODE_CHILDREN_FIELD, nodeRecordTombstoned } from './schema.ts';
import { INLINE_FIELD } from './paragraph-text.ts';
import { textMarksOf } from './paragraph-text-marks.ts';
import { deleteSetRuns, fieldOf, firstItem, holderItem, structAt } from './yjs-items.ts';

/** The record field naming the paragraph that shows what others typed here after an undo. */
export const NODE_UNDONE_INTO_FIELD = 'undoneInto';

/** The longest logical ID the field holds; a longer value names no paragraph. */
const MAX_ID_LENGTH = 512;

/** Where an undo joins an unlisted paragraph's text: the end of a paragraph, or its start. */
export interface UndoneInto {
  readonly paragraph: LogicalId;
  readonly atStart: boolean;
}

function isParagraph(record: unknown): boolean {
  return isNodeMap(record) && record.get(INLINE_FIELD) instanceof Y.Text;
}

/**
 * Where what others typed in a paragraph an undo unlisted shows, or null when nowhere: no
 * undo recorded a place, or the paragraph is deleted.
 */
export function undoneIntoOf(record: unknown): UndoneInto | null {
  if (!isNodeMap(record) || nodeRecordTombstoned(record)) return null;
  const value = record.get(NODE_UNDONE_INTO_FIELD);
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH) return null;
  const atStart = value.startsWith('^');
  const id = atStart ? value.slice(1) : value;
  return id.length > 0 ? { paragraph: keyId(id), atStart } : null;
}

/** The listed paragraphs a history step's own listing entries name, by their child arrays. */
function listedBy(
  doc: Y.Doc,
  nodes: Y.Map<Y.Map<unknown>>,
  step: unknown
): Map<Y.Array<LogicalId>, Set<LogicalId>> {
  const listed = new Map<Y.Array<LogicalId>, Set<LogicalId>>();
  for (const run of deleteSetRuns((step as { insertions?: unknown } | undefined)?.insertions)) {
    for (let clock = run.clock; clock < run.clock + run.length; ) {
      const item = structAt(doc, { client: run.client, clock });
      if (!item) break;
      clock = item.id.clock + item.length;
      const array = item.parent;
      if (item.deleted || !(array instanceof Y.Array) || fieldOf(array) !== NODE_CHILDREN_FIELD) {
        continue;
      }
      const record = holderItem(array)?.parent;
      if (!(record instanceof Y.Map) || (holderItem(record)?.parent as unknown) !== nodes) continue;
      const ids = listed.get(array as Y.Array<LogicalId>) ?? new Set<LogicalId>();
      for (const id of item.content.getContent()) {
        if (typeof id === 'string' && isParagraph(nodes.get(id))) ids.add(keyId(id));
      }
      if (ids.size > 0) listed.set(array as Y.Array<LogicalId>, ids);
    }
  }
  return listed;
}

/**
 * Before an undo of `step` runs, record on each paragraph it listed where the undo joins its
 * text: the nearest paragraph before it that the step did not list, or after it when another
 * kind of block or nothing comes first. No undo stack tracks the write: `transact` runs it
 * under an origin the history does not capture.
 */
export function noteUndoneParagraphTargets(
  doc: Y.Doc,
  nodes: Y.Map<Y.Map<unknown>>,
  step: unknown,
  transact: (write: () => void) => void
): void {
  const writes: { record: Y.Map<unknown>; target: string | undefined }[] = [];
  for (const [array, ids] of listedBy(doc, nodes, step)) {
    const children = array.toArray();
    const paragraphAt = (index: number): LogicalId | null => {
      const id = children[index];
      const record = id === undefined ? undefined : nodes.get(id);
      return id !== undefined && isParagraph(record) && !nodeRecordTombstoned(record) ? id : null;
    };
    // The nearest block on each side that the step did not list, for every block it did.
    const before: (LogicalId | null)[] = [];
    let previous: LogicalId | null = null;
    children.forEach((id, index) => {
      before.push(previous);
      if (!ids.has(id)) previous = paragraphAt(index);
    });
    let next: LogicalId | null = null;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const id = children[index]!;
      if (!ids.has(id)) {
        next = paragraphAt(index);
        continue;
      }
      const record = nodes.get(id);
      const into = before[index] ?? (next === null ? undefined : `^${next}`);
      if (record && record.get(NODE_UNDONE_INTO_FIELD) !== into) {
        writes.push({ record, target: into });
      }
    }
  }
  if (writes.length === 0) return;
  transact(() => {
    for (const { record, target } of writes) {
      if (target === undefined) record.delete(NODE_UNDONE_INTO_FIELD);
      else record.set(NODE_UNDONE_INTO_FIELD, target);
    }
  });
}

/** The paragraph record whose shared text holds `item`, or null. */
function paragraphRecordOf(nodes: Y.Map<Y.Map<unknown>>, item: Y.Item): Y.Map<unknown> | null {
  const text = item.parent;
  if (!(text instanceof Y.Text) || fieldOf(text) !== INLINE_FIELD) return null;
  const record = holderItem(text)?.parent;
  return record instanceof Y.Map && (holderItem(record)?.parent as unknown) === nodes
    ? record
    : null;
}

/**
 * The items of `step` that its undo keeps, or null for none.
 *
 * An undo of a split joins the paragraph it listed back into the paragraph it split. When a
 * participant deleted that paragraph meanwhile, the join has nowhere to go: the moved text
 * would go back into a deleted paragraph and show nowhere. So when every paragraph the step
 * took text from is deleted, the undo keeps each paragraph the step listed that shows text it
 * moved: its listing entry, its record fields, and the copies it holds. Text the step typed
 * there still goes.
 */
export function undoKeeps(
  doc: Y.Doc,
  nodes: Y.Map<Y.Map<unknown>>,
  step: unknown
): ((item: Y.Item) => boolean) | null {
  const sources = new Set<Y.Map<unknown>>();
  for (const run of deleteSetRuns((step as { deletions?: unknown } | undefined)?.deletions)) {
    for (let clock = run.clock; clock < run.clock + run.length; ) {
      const item = structAt(doc, { client: run.client, clock });
      if (!item) break;
      clock = item.id.clock + item.length;
      const record = paragraphRecordOf(nodes, item);
      if (record) sources.add(record);
    }
  }
  if (sources.size === 0 || [...sources].some((record) => !nodeRecordTombstoned(record))) {
    return null;
  }
  const marks = textMarksOf(doc);
  const isCopy = (item: Y.Item): boolean =>
    marks.origin('move', item.id.client, item.id.clock) !== null;
  const keptIds = new Set<string>();
  const keptTexts = new Set<unknown>();
  for (const ids of listedBy(doc, nodes, step).values()) {
    for (const id of ids) {
      const text = nodes.get(id)?.get(INLINE_FIELD);
      if (!(text instanceof Y.Text)) continue;
      for (let item = firstItem(text); item; item = item.right) {
        if (item.deleted || !isCopy(item)) continue;
        keptIds.add(id);
        keptTexts.add(text);
        break;
      }
    }
  }
  if (keptIds.size === 0) return null;
  // A kept paragraph keeps its record fields too: its split points still place it.
  const keptRecords = new Set<unknown>([...keptIds].map((id) => nodes.get(id)));
  return (item) => {
    const parent = item.parent as unknown;
    if (keptTexts.has(parent)) return isCopy(item);
    if (keptRecords.has(parent)) return true;
    if (!(parent instanceof Y.Array) || fieldOf(parent) !== NODE_CHILDREN_FIELD) return false;
    const listed = item.content.getContent();
    return listed.length > 0 && listed.every((id) => keptIds.has(id as string));
  };
}
