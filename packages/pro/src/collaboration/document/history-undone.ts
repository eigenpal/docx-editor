/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Comments and notes an undo takes out of their part stay out on every replica.
 *
 * An undo of an insert removes the record's listing and keeps the record, so a redo can list
 * it again. A comment or note no parent lists looks, to every replica, like one a concurrent
 * edit lost, and the materializer gives it an edge back into its part, which brings an undone
 * comment back. Only the replica that undid knows the difference, so it marks the records
 * the undo unlisted, keeps their IDs on the step it pushes to the redo stack, and the redo of
 * that step clears exactly those marks.
 */
import * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import { RESTORE_ORIGIN } from './paragraph-text-restore.ts';
import { isElementRecord, isNodeMap, NODE_UNDONE_FIELD } from './schema.ts';
import { textDeletionsOf, type DeletedRun } from './paragraph-text-deletions.ts';
import { deleteSetRuns, structAt } from './yjs-items.ts';

/**
 * The part members a part always lists. Numbering definitions are not among them: concurrent
 * list edits leave them loose by design, and the repair is how they show.
 */
const LISTED_MEMBERS = new Set(['comment', 'footnote', 'endnote']);

/** The meta key under which a history step keeps the records its undo marked. */
const MARKED = 'docx-undone-records';

interface StackItemShape {
  readonly meta: Map<unknown, unknown>;
}

export function markUndoneRecords(
  registry: DocumentRegistry,
  direction: 'undo' | 'redo',
  item: unknown,
  unlisted: readonly LogicalId[]
): void {
  const meta = (item as StackItemShape | undefined)?.meta;
  const marked =
    direction === 'undo'
      ? unlisted.filter((id) => {
          const record = registry.record(id);
          return (
            isNodeMap(registry.schema.nodes.get(id)) &&
            !registry.isTombstoned(id) &&
            !!record &&
            isElementRecord(record) &&
            LISTED_MEMBERS.has(record.localName)
          );
        })
      : [];
  const cleared =
    direction === 'redo' ? ((meta?.get(MARKED) as readonly LogicalId[] | undefined) ?? []) : [];
  if (direction === 'undo') meta?.set(MARKED, marked);
  if (marked.length === 0 && cleared.length === 0) return;
  // The marks follow the history step; no undo stack tracks them.
  registry.doc.transact(() => {
    for (const id of marked) registry.schema.nodes.get(id)?.set(NODE_UNDONE_FIELD, true);
    for (const id of cleared) {
      const record = registry.schema.nodes.get(id);
      if (isNodeMap(record) && record.has(NODE_UNDONE_FIELD)) record.delete(NODE_UNDONE_FIELD);
    }
  }, RESTORE_ORIGIN);
}

/** The most characters one undo checks for copies; a larger step keeps its copies. */
const MAX_UNDONE_CHARACTERS = 1 << 16;

/** The deleted runs whose copies the undo of a step hides. */
const COPY_RUNS = 'docx-copy-runs';
/** The deletion records the undo that pushed this redo step wrote. */
const HIDDEN_KEYS = 'docx-hidden-copies';
/** A step with nothing for Yjs to reverse: only copies to hide or show again. */
const COPIES_ONLY = 'docx-copies-only';

interface HistoryStack {
  readonly undoStack: StackItemShape[];
  readonly redoStack: StackItemShape[];
  undo(): unknown;
  redo(): unknown;
}

/**
 * Undo or redo one step, with what only the stepping replica knows.
 *
 * A peer's Enter or join before typed text moves it: the moved paragraph shows copies of the
 * typed characters and deletes the originals. Yjs then has nothing left to reverse for the
 * typing: it skipped the step and undid an older one, while the copies stayed. So an undo
 * first finds the copies of the characters its step typed. It records those characters as
 * deleted, as a deletion does, and every replica hides their copies. A step with nothing
 * else to reverse is popped here, not by Yjs. The redo step keeps the records, and its redo
 * withdraws them, so the text shows again; the undo step that redo pushes keeps the
 * characters, so the next undo hides them again.
 */
export function stepHistory(
  registry: DocumentRegistry,
  history: HistoryStack,
  direction: 'undo' | 'redo',
  afterStep: () => void
): void {
  const stack = direction === 'undo' ? history.undoStack : history.redoStack;
  const opposite = direction === 'undo' ? history.redoStack : history.undoStack;
  const popped = stack[stack.length - 1];
  const runs =
    direction === 'undo'
      ? copiesOf(registry, popped)
      : (runsOf<DeletedRun>(popped, COPY_RUNS) ?? []);
  const before = opposite.length;
  if (
    popped?.meta.get(COPIES_ONLY) === true ||
    (runs.length > 0 && nothingElse(registry, popped))
  ) {
    stack.pop();
  } else if (direction === 'undo') {
    history.undo();
  } else {
    history.redo();
  }
  afterStep();
  let pushed = opposite.length > before ? opposite[opposite.length - 1] : undefined;
  if (direction === 'redo') {
    const keys = runsOf<string>(popped, HIDDEN_KEYS);
    if (keys && keys.length > 0) {
      registry.doc.transact(() => textDeletionsOf(registry.doc).withdraw(keys));
    }
  }
  if (runs.length > 0) {
    pushed ??= pushCopiesOnly(opposite);
    pushed.meta.set(COPY_RUNS, runs);
    if (direction === 'undo') {
      // As the marks above, the record follows the history step; no undo stack tracks it.
      let keys: string[] = [];
      registry.doc.transact(() => {
        keys = textDeletionsOf(registry.doc).record(runs);
      });
      pushed.meta.set(HIDDEN_KEYS, keys);
    }
  }
  markUndoneRecords(
    registry,
    direction,
    direction === 'redo' ? popped : pushed,
    registry.takeUnlisted()
  );
}

/** The characters a step typed whose copies show, and those an earlier undo of it hid. */
function copiesOf(registry: DocumentRegistry, step: StackItemShape | undefined): DeletedRun[] {
  const follow = registry.inline.follow;
  const copied: DeletedRun[] = [...((runsOf(step, COPY_RUNS) as DeletedRun[] | undefined) ?? [])];
  let checked = 0;
  for (const run of deleteSetRuns((step as { insertions?: unknown } | undefined)?.insertions)) {
    for (let clock = run.clock; clock < run.clock + run.length; clock += 1) {
      if ((checked += 1) > MAX_UNDONE_CHARACTERS) return copied;
      if (follow.shownCopy(`${run.client}:${clock}`) === null) continue;
      const last = copied[copied.length - 1];
      if (last && last.client === run.client && last.to === clock) {
        copied[copied.length - 1] = { ...last, to: clock + 1 };
      } else {
        copied.push({ client: run.client, from: clock, to: clock + 1 });
      }
    }
  }
  return copied;
}

/** Whether Yjs has nothing to reverse for a step: it deleted nothing, and what it wrote is gone. */
function nothingElse(registry: DocumentRegistry, step: StackItemShape | undefined): boolean {
  if (!step) return false;
  if (deleteSetRuns((step as { deletions?: unknown }).deletions).length > 0) return false;
  for (const run of deleteSetRuns((step as { insertions?: unknown }).insertions)) {
    for (let clock = run.clock; clock < run.clock + run.length; ) {
      const item = structAt(registry.doc, { client: run.client, clock });
      if (!item || !item.deleted) return false;
      clock = item.id.clock + item.length;
    }
  }
  return true;
}

function runsOf<Value>(step: StackItemShape | undefined, key: string): Value[] | undefined {
  return step?.meta.get(key) as Value[] | undefined;
}

/** A step for copies alone, which this module pops, never Yjs. */
function pushCopiesOnly(stack: StackItemShape[]): StackItemShape {
  const step: StackItemShape = {
    meta: new Map<unknown, unknown>([[COPIES_ONLY, true]]),
  };
  Object.assign(step, { insertions: Y.createDeleteSet(), deletions: Y.createDeleteSet() });
  stack.push(step);
  return step;
}
