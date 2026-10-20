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
import { textMarksOf } from './paragraph-text-marks.ts';

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

/** The deleted runs whose copies the undo of a step hides. */
const COPY_RUNS = 'docx-copy-runs';
/** The deletion records the undo that pushed this redo step wrote. */
const HIDDEN_KEYS = 'docx-hidden-copies';
/** A step with nothing for Yjs to reverse: only copies to hide or show again. */
const COPIES_ONLY = 'docx-copies-only';
/** A step that a host undo group collected: one undo reverts it and nothing older. */
const GROUP_STEP = 'docx-undo-group';

/** Mark `item` as the step of a host undo group. */
export function markGroupStep(item: { readonly meta: Map<unknown, unknown> }): void {
  item.meta.set(GROUP_STEP, true);
}

interface HistoryStack {
  readonly undoStack: StackItemShape[];
  readonly redoStack: StackItemShape[];
  undo(): unknown;
  redo(): unknown;
  stopCapturing(): void;
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
  // A step for copies alone that Yjs later merged an edit into has that edit to reverse too.
  const copiesOnly = popped?.meta.get(COPIES_ONLY) === true && changesOf(popped) === 0;
  // Yjs pops steps until one changes something. When other participants already removed
  // everything a step wrote, that would revert older steps too. A group's step must never
  // be reverted that way: a group step is stepped alone, and with nothing left to reverse
  // it is popped and changes nothing. An ungrouped step may still pass over ungrouped
  // steps below it that changed nothing, as without groups, but stops above a group step.
  const grouped = popped?.meta.get(GROUP_STEP) === true;
  if (copiesOnly || (runs.length > 0 && nothingElse(registry, popped))) {
    stack.pop();
  } else {
    const below = stack.splice(0, grouped ? stack.length - 1 : aboveLastGroupStep(stack));
    try {
      if (direction === 'undo') history.undo();
      else history.redo();
    } finally {
      if (below.length > 0) {
        const restored = below.concat(stack);
        stack.length = 0;
        for (const step of restored) stack.push(step);
      }
    }
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
  if (grouped) {
    // The step that undoes this undo is the group's step too, even when it changes nothing.
    pushed ??= pushCopiesOnly(opposite);
    markGroupStep(pushed);
  }
  markUndoneRecords(
    registry,
    direction,
    direction === 'redo' ? popped : pushed,
    registry.takeUnlisted()
  );
  // The next edit is a step of its own. Yjs merges an edit made within its capture window into
  // the step on top, and a step this module pushed would take an edit it then never reverses.
  history.stopCapturing();
}

/**
 * The identities of one author's characters `[from, to)` of `client`, as spans.
 *
 * A redo writes this author's characters again under new IDs, with a restore mark naming the
 * identity they had, and a copy of them carries that identity. Only that mark is followed: a
 * step's other inserts, such as copies its own split wrote of another author's text, keep
 * their own IDs, so a record never hides that text.
 */
function identitySpans(
  marks: ReturnType<typeof textMarksOf>,
  client: number,
  from: number,
  to: number
): { client: number; from: number; to: number }[] {
  const spans: { client: number; from: number; to: number }[] = [];
  for (let at = from; at < to; ) {
    const restored = marks.origin('restore', client, at);
    if (restored === null || restored.client !== client) {
      // Without a mark here, the rest of the insert has none either: a mark covers whole
      // inserts.
      const end = restored === null ? to : Math.min(to, restored.firstClock + restored.length);
      spans.push({ client, from: at, to: end });
      at = end;
      continue;
    }
    const end = Math.min(to, restored.firstClock + restored.length);
    const start = restored.clock + (at - restored.firstClock);
    spans.push({ client: restored.client, from: start, to: start + (end - at) });
    at = end;
  }
  return spans;
}

/** Whether a paragraph shows a copy of any character of `client` in `[from, to)`. */
function hasShownCopy(
  follow: { shownCopy(identity: string): unknown },
  client: number,
  from: number,
  to: number
): boolean {
  for (let at = from; at < to; at += 1) if (follow.shownCopy(`${client}:${at}`)) return true;
  return false;
}

/** How many steps lie at or below the topmost group step under the top one, or 0. */
function aboveLastGroupStep(stack: readonly StackItemShape[]): number {
  for (let index = stack.length - 2; index >= 0; index -= 1) {
    if (stack[index]!.meta.get(GROUP_STEP) === true) return index + 1;
  }
  return 0;
}

/** How many runs of items a step reverses: what it inserted and what it deleted. */
function changesOf(step: StackItemShape): number {
  const shape = step as { insertions?: unknown; deletions?: unknown };
  return deleteSetRuns(shape.insertions).length + deleteSetRuns(shape.deletions).length;
}

/**
 * The characters a step typed whose copies show, and those an earlier undo of it hid.
 *
 * Walked by item, not by character: a move deletes whole spans of a step's characters at
 * once. A span already deleted, with a copy of any of its characters, is recorded whole; its
 * other characters are deleted too, so the record hides nothing else. Every span of the step
 * is read: a step that undoes only in part is worse than one that does not undo.
 */
function copiesOf(registry: DocumentRegistry, step: StackItemShape | undefined): DeletedRun[] {
  const follow = registry.inline.follow;
  const marks = textMarksOf(registry.doc);
  const copied: { client: number; from: number; to: number }[] = (
    (runsOf(step, COPY_RUNS) as DeletedRun[] | undefined) ?? []
  ).map((run) => ({ ...run }));
  const add = (client: number, from: number, to: number): void => {
    const last = copied[copied.length - 1];
    if (last && last.client === client && last.to === from) last.to = to;
    else copied.push({ client, from, to });
  };
  for (const run of deleteSetRuns((step as { insertions?: unknown } | undefined)?.insertions)) {
    const runEnd = run.clock + run.length;
    for (let clock = run.clock; clock < runEnd; ) {
      const item = structAt(registry.doc, { client: run.client, clock });
      const end = item ? Math.min(item.id.clock + item.length, runEnd) : clock + 1;
      // A peer that edits the paragraph a move took typed text to writes a copy of it there,
      // and the original, still live, no longer shows. Removing the original alone would
      // leave that copy in view, so typed text counts live too. Text a redo wrote again
      // counts only once deleted.
      if (item?.deleted || (item && !marks.origin('restore', run.client, clock))) {
        const spans = identitySpans(marks, run.client, clock, end);
        // Spans first, characters only where an index run holds a copy: an undo of a long
        // paste reads its marks once per insert, not once per character.
        const shown = spans.some(
          (span) =>
            follow.holdsCopyIn(span.client, span.from, span.to) &&
            hasShownCopy(follow, span.client, span.from, span.to)
        );
        if (shown) for (const span of spans) add(span.client, span.from, span.to);
      }
      clock = end;
    }
  }
  return copied;
}

/**
 * Whether Yjs has nothing to reverse for a step: it deleted nothing, and what it wrote is gone.
 *
 * Only the undo manager's own types count. A step also records the items its transaction
 * wrote elsewhere, such as the mark that says where typed text follows a moved character.
 * Yjs never reverses those, so a live one does not mean there is something to undo.
 */
function nothingElse(registry: DocumentRegistry, step: StackItemShape | undefined): boolean {
  if (!step) return false;
  const scope = new Set<unknown>(registry.trackedTypes());
  const shape = step as { deletions?: unknown; insertions?: unknown };
  for (const [runs, deletion] of [
    [deleteSetRuns(shape.deletions), true],
    [deleteSetRuns(shape.insertions), false],
  ] as const) {
    for (const run of runs) {
      for (let clock = run.clock; clock < run.clock + run.length; ) {
        const item = structAt(registry.doc, { client: run.client, clock });
        if (!item) return false;
        if (inScope(item, scope) && (deletion || !item.deleted)) return false;
        clock = item.id.clock + item.length;
      }
    }
  }
  return true;
}

/** Whether `item` lives under one of the undo manager's root types. */
function inScope(item: Y.Item, scope: ReadonlySet<unknown>): boolean {
  let type: Y.AbstractType<unknown> | null = item.parent as Y.AbstractType<unknown> | null;
  while (type !== null) {
    if (scope.has(type)) return true;
    const parent: unknown = type._item?.parent;
    type = parent instanceof Y.AbstractType ? parent : null;
  }
  return false;
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
