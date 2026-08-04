// What each operation MEANS, as reads off a snapshot and `TreeDocOp`s for one transaction.
//
// INTERNAL, and the only place in the lane that decides anything. `host.ts` runs a batch;
// this file is what a batch is made of. Keeping it separate is not tidiness: the planner is
// pure with respect to the document — it reads a snapshot and produces ops — so every semantic
// question ("what does inserting a paragraph before another one do to identity", "what does
// deleting across a paragraph mark leave behind") is answered in one testable place instead of
// being distributed across two host adapters.
//
// THREE RULES HOLD EVERYTHING TOGETHER:
//
// 1. QUERIES ANSWER FROM THE START OF THE BATCH. A read is a read of the state the caller's
//    decisions were made against.
//
// 2. COMMANDS ARE PLANNED FROM THE START OF THE BATCH AND APPLIED IN ORDER. Offsets a caller
//    supplies are validated against the state it could see. Inside the transaction the ops run
//    in sequence, so two writes to one paragraph shift each other exactly as two sequential
//    edits would.
//
// 3. A PARAGRAPH THAT ONE COMMAND RESTRUCTURES BELONGS TO THAT COMMAND. Splitting, deleting, or
//    inserting beside a paragraph changes what its offsets mean; a second command addressing it
//    in the same batch would be planned against coordinates that no longer describe it. That is
//    `conflicting-operations` — refused, never guessed at. It costs nothing real: the common
//    shape, one structural edit per paragraph per sync, is untouched.
//
// STRUCTURAL COMMANDS ANSWER AFTER THE COMMIT, because the paragraph they name does not exist
// until then. Every such command leaves a SLOT in a symbolic picture of the story's order; when
// the transaction lands, the ids the engine actually created are matched to those slots in
// reading order. No index is ever handed back to a consumer and no DOM is consulted.

import type { TreeDocOp } from '../store/store/tree-ops.ts';
import {
  findOccurrences,
  isSearchableQuery,
  SEARCH_MATCH_LIMIT,
} from '../store/store/text-match.ts';
import type { AutomationHandleTable } from './handles.ts';
import type {
  AutomationOperation,
  AutomationSearchOptions,
  AutomationSelectionMode,
} from './operations.ts';
import { isAutomationCommand } from './operations.ts';
import type {
  AutomationCapabilities,
  AutomationError,
  AutomationErrorCode,
  AutomationSpan,
  AutomationValue,
} from './protocol.ts';
import { PARAGRAPH_MARK, type AutomationDocumentReads } from './reads.ts';
import {
  resolveParagraphHandle,
  resolveParagraphRef,
  resolvePoint,
  resolveSpanRef,
  spanParagraphIds,
  spanText,
  spanValue,
  type ResolvedPoint,
  type ResolvedRange,
} from './spans.ts';

/**
 * Characters that mean "a new paragraph" in a document but are merely characters in a run.
 *
 * Writing one into a `w:t` would produce a document whose text reads back with a break the
 * layout does not honour and the paragraph collection does not see. Word's own `insertText`
 * splits paragraphs on these; this slice does not implement that, so it refuses them rather
 * than writing something that means something else. `\u2028`/`\u2029` are here for the same
 * reason: they arrive from pasted HTML and mean line and paragraph separator.
 */
const PARAGRAPH_BREAKING = /[\r\n\v\f\u2028\u2029]/;

/** Most delimiters one split accepts, and the longest each may be. Both are host input. */
const MAX_DELIMITERS = 16;
const MAX_DELIMITER_LENGTH = 64;

/** Whitespace trimmed off the ENDS of an answered range when `trimSpacing` is asked for. */
const TRIMMABLE = /\s/;

export type PlannedOperation =
  | { readonly ok: true; readonly kind: 'query'; readonly value: AutomationValue }
  | {
      readonly ok: true;
      readonly kind: 'command';
      readonly ops: readonly TreeDocOp[];
      /** Computed after the commit, so a created paragraph can be named. */
      readonly answer: (post: AutomationDocumentReads) => AutomationValue;
    }
  | { readonly ok: false; readonly error: AutomationError };

/** A position in the symbolic story order. Bound to a real id after the commit. */
interface Slot {
  id: string | null;
}

export interface BatchPlannerHost {
  readonly handles: AutomationHandleTable;
  readonly reads: AutomationDocumentReads;
  readonly capabilities: AutomationCapabilities;
  /** Moves a reader's caret. Only called when `capabilities.selection` is true. */
  readonly select?: (range: ResolvedRange, mode: AutomationSelectionMode) => void;
}

export interface BatchPlanner {
  plan(operation: AutomationOperation): PlannedOperation;
  /** Whether any planned operation writes. */
  readonly hasCommands: boolean;
  /**
   * Bind created paragraphs and re-aim moved identities against the committed state.
   *
   * Runs before any command answers, and only when a transaction committed. A mismatch here
   * means the planner's picture of what the ops would do disagrees with what they did, which
   * is a bug in this file rather than in the caller's request — it is reported rather than
   * papered over, because binding a slot to the wrong paragraph would hand back a handle that
   * names the wrong thing forever.
   */
  settle(post: AutomationDocumentReads): { readonly ok: true } | { readonly ok: false; readonly detail: string };
}

function error(code: AutomationErrorCode, message: string, detail?: string): AutomationError {
  return Object.freeze(detail === undefined ? { code, message } : { code, message, detail });
}

function refuse(code: AutomationErrorCode, message: string, detail?: string): PlannedOperation {
  return { ok: false, error: error(code, message, detail) };
}

const APPLIED: AutomationValue = Object.freeze({ kind: 'applied' as const });

function query(value: AutomationValue): PlannedOperation {
  return { ok: true, kind: 'query', value };
}

/** Every occurrence of any delimiter in `text`, non-overlapping, in order. */
function delimiterOccurrences(
  text: string,
  delimiters: readonly string[],
): readonly { readonly start: number; readonly length: number }[] {
  const found: { start: number; length: number }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let best: { start: number; length: number } | null = null;
    for (const delimiter of delimiters) {
      const at = text.indexOf(delimiter, cursor);
      if (at < 0) continue;
      // Earliest wins; at the same position the LONGEST wins, so a two-character delimiter is
      // not shadowed by a one-character one that happens to be its prefix.
      if (!best || at < best.start || (at === best.start && delimiter.length > best.length))
        best = { start: at, length: delimiter.length };
    }
    if (!best) break;
    found.push(best);
    cursor = best.start + best.length;
  }
  return found;
}

/** `[start, end)` narrowed past leading and trailing whitespace. */
function trimmed(text: string, start: number, end: number): readonly [number, number] {
  let from = start;
  let to = end;
  while (from < to && TRIMMABLE.test(text[from] as string)) from += 1;
  while (to > from && TRIMMABLE.test(text[to - 1] as string)) to -= 1;
  return [from, to];
}

export function createBatchPlanner(host: BatchPlannerHost): BatchPlanner {
  const { handles, reads, capabilities } = host;

  // The symbolic story order. Known paragraphs start bound; a structural command inserts
  // unbound slots where it will create paragraphs, and `settle` fills them in.
  const slotById = new Map<string, Slot>();
  const order: Slot[] = reads.bodyParagraphIds.map((id) => {
    const slot: Slot = { id };
    slotById.set(id, slot);
    return slot;
  });
  const created: Slot[] = [];

  /** Paragraphs a command has restructured, and paragraphs any command has touched. */
  const restructured = new Set<string>();
  const touched = new Set<string>();
  /** Identity moves to apply after the commit: the caller's handle for `from` must name `to`. */
  const retargets: { readonly from: string; readonly slot: Slot }[] = [];
  const selections: { readonly range: ResolvedRange; readonly mode: AutomationSelectionMode }[] =
    [];
  let hasCommands = false;

  const positionOf = (slot: Slot): number => order.indexOf(slot);

  /** Claim a paragraph for a structural command, or say why it cannot be claimed. */
  const claim = (paragraphId: string): PlannedOperation | null => {
    if (restructured.has(paragraphId) || touched.has(paragraphId)) {
      return refuse(
        'conflicting-operations',
        'another operation in this batch already changes that paragraph',
        paragraphId,
      );
    }
    restructured.add(paragraphId);
    touched.add(paragraphId);
    return null;
  };

  /** Record a non-structural touch, or say why the paragraph is already spoken for. */
  const touch = (paragraphId: string): PlannedOperation | null => {
    if (restructured.has(paragraphId)) {
      return refuse(
        'conflicting-operations',
        'another operation in this batch restructures that paragraph',
        paragraphId,
      );
    }
    touched.add(paragraphId);
    return null;
  };

  /** A fresh unbound slot at `position`, remembered in creation-independent reading order. */
  const insertSlot = (position: number): Slot => {
    const slot: Slot = { id: null };
    order.splice(position, 0, slot);
    created.push(slot);
    return slot;
  };

  const spanOf = (range: ResolvedRange): AutomationSpan => spanValue(range, handles);

  const searchStory = (
    text: string,
    options: AutomationSearchOptions | undefined,
  ): PlannedOperation => {
    if (options?.matchWildcards === true)
      return refuse('unsupported-capability', 'wildcard search is not implemented', 'matchWildcards');
    if (options?.ignorePunct === true)
      return refuse('unsupported-capability', 'ignoring punctuation is not implemented', 'ignorePunct');
    if (options?.ignoreSpace === true)
      return refuse('unsupported-capability', 'ignoring whitespace is not implemented', 'ignoreSpace');
    if (!isSearchableQuery(text))
      return refuse('unsupported-content', 'that is not a query this host will scan for', 'text');

    const requested = options?.limit;
    if (requested !== undefined && (!Number.isInteger(requested) || requested < 0))
      return refuse('invalid-offset', 'limit must be a non-negative integer', String(requested));
    let budget = Math.min(requested ?? SEARCH_MATCH_LIMIT, SEARCH_MATCH_LIMIT);

    const spans: AutomationSpan[] = [];
    // Paragraph by paragraph, in reading order. A match never crosses a paragraph mark, which
    // is what Word's Find does too: a paragraph break is a boundary, not a character to match.
    for (const paragraphId of reads.bodyParagraphIds) {
      if (budget <= 0) break;
      const paragraphText = reads.paragraphText(paragraphId) ?? '';
      const found = findOccurrences(paragraphText, text, budget, {
        matchCase: options?.matchCase === true,
        wholeWord: options?.matchWholeWord === true,
      });
      for (const occurrence of found.matches) {
        const paragraph = handles.paragraph(paragraphId);
        spans.push({
          start: { paragraph, offset: occurrence.start },
          end: { paragraph, offset: occurrence.start + occurrence.length },
        });
      }
      budget -= found.matches.length;
    }
    return query({ kind: 'spans', spans });
  };

  const planInsertText = (at: ResolvedPoint, text: string): PlannedOperation => {
    if (typeof text !== 'string')
      return refuse('unsupported-content', 'insertText needs text', 'text');
    if (PARAGRAPH_BREAKING.test(text)) {
      return refuse(
        'unsupported-content',
        'text carrying a paragraph mark is not written by this host',
        'paragraph-mark-in-text',
      );
    }
    const conflict = touch(at.paragraphId);
    if (conflict) return conflict;
    const ops: TreeDocOp[] =
      text.length === 0
        ? []
        : [{ op: 'insertText', paragraphId: at.paragraphId, offset: at.offset, text }];
    const answer = (): AutomationValue => ({
      kind: 'span',
      span: spanOf({
        start: at,
        end: { ...at, offset: at.offset + text.length },
      }),
    });
    return { ok: true, kind: 'command', ops, answer };
  };

  const planReplaceSpan = (range: ResolvedRange, text: string): PlannedOperation => {
    if (typeof text !== 'string')
      return refuse('unsupported-content', 'replaceSpan needs text', 'text');
    if (PARAGRAPH_BREAKING.test(text)) {
      return refuse(
        'unsupported-content',
        'text carrying a paragraph mark is not written by this host',
        'paragraph-mark-in-text',
      );
    }

    const ids = spanParagraphIds(range, reads);
    const first = range.start.paragraphId;
    const ops: TreeDocOp[] = [];

    if (ids.length === 1) {
      const conflict = touch(first);
      if (conflict) return conflict;
      if (range.end.offset > range.start.offset) {
        ops.push({
          op: 'deleteText',
          paragraphId: first,
          start: range.start.offset,
          end: range.end.offset,
        });
      }
    } else {
      // Crossing a paragraph mark removes the paragraphs between the endpoints and joins what
      // is left of the two ends, because that is what deleting a stretch of a document means.
      // The join is the canonical `joinParagraphs`, so a span that spills across a table cell
      // is refused there and the whole batch with it.
      for (const paragraphId of ids) {
        const conflict = claim(paragraphId);
        if (conflict) return conflict;
      }
      const last = range.end.paragraphId;
      const headLength = (reads.paragraphText(first) ?? '').length;
      if (range.start.offset < headLength)
        ops.push({ op: 'deleteText', paragraphId: first, start: range.start.offset, end: headLength });
      if (range.end.offset > 0)
        ops.push({ op: 'deleteText', paragraphId: last, start: 0, end: range.end.offset });
      for (const middle of ids.slice(1, -1)) ops.push({ op: 'deleteBlock', blockId: middle });
      ops.push({ op: 'joinParagraphs', firstId: first, secondId: last });
      for (const gone of ids.slice(1)) {
        const slot = slotById.get(gone);
        if (slot) order.splice(positionOf(slot), 1);
      }
    }

    if (text.length > 0)
      ops.push({ op: 'insertText', paragraphId: first, offset: range.start.offset, text });

    const start: ResolvedPoint = { ...range.start, paragraphId: first };
    const answer = (): AutomationValue => ({
      kind: 'span',
      span: spanOf({ start, end: { ...start, offset: start.offset + text.length } }),
    });
    return { ok: true, kind: 'command', ops, answer };
  };

  const planInsertParagraph = (
    anchor: ResolvedPoint,
    where: 'before' | 'after',
    text: string,
  ): PlannedOperation => {
    if (typeof text !== 'string')
      return refuse('unsupported-content', 'insertParagraph needs text', 'text');
    if (PARAGRAPH_BREAKING.test(text)) {
      return refuse(
        'unsupported-content',
        'a paragraph mark inside a paragraph\u2019s text is not written by this host',
        'paragraph-mark-in-text',
      );
    }
    const conflict = claim(anchor.paragraphId);
    if (conflict) return conflict;

    const anchorSlot = slotById.get(anchor.paragraphId);
    if (!anchorSlot) return refuse('invalid-handle', 'that paragraph is not in the body');
    const anchorLength = (reads.paragraphText(anchor.paragraphId) ?? '').length;
    const ops: TreeDocOp[] = [];
    // One paragraph becomes two by splitting one: `splitParagraph` leaves the HEAD on the
    // original node and puts the TAIL on a new one. So "after" writes the new text at the end
    // and cuts it off, and "before" writes it at the start and cuts everything else off —
    // which moves the ANCHOR'S content to the new node, and its identity with it.
    if (where === 'after') {
      if (text.length > 0)
        ops.push({ op: 'insertText', paragraphId: anchor.paragraphId, offset: anchorLength, text });
      ops.push({ op: 'splitParagraph', paragraphId: anchor.paragraphId, offset: anchorLength });
    } else {
      if (text.length > 0)
        ops.push({ op: 'insertText', paragraphId: anchor.paragraphId, offset: 0, text });
      ops.push({ op: 'splitParagraph', paragraphId: anchor.paragraphId, offset: text.length });
    }
    const fresh = insertSlot(positionOf(anchorSlot) + 1);
    if (where === 'before') retargets.push({ from: anchor.paragraphId, slot: fresh });

    // "after" names the created node; "before" names the original one, which now holds the
    // inserted paragraph. Both are asked for AFTER the retarget, so the handle is a new ref.
    const answer = (): AutomationValue => {
      const id = where === 'after' ? fresh.id : anchor.paragraphId;
      if (id === null) return APPLIED;
      return { kind: 'handle', handle: handles.paragraph(id) };
    };
    return { ok: true, kind: 'command', ops, answer };
  };

  const planSplitParagraph = (
    paragraph: ResolvedPoint,
    delimiters: readonly string[],
    trimDelimiters: boolean,
    trimSpacing: boolean,
  ): PlannedOperation => {
    if (!Array.isArray(delimiters) || delimiters.length === 0)
      return refuse('unsupported-content', 'split needs at least one delimiter', 'delimiters');
    if (delimiters.length > MAX_DELIMITERS)
      return refuse('unsupported-content', 'too many delimiters', String(delimiters.length));
    for (const delimiter of delimiters) {
      if (typeof delimiter !== 'string' || delimiter.length === 0)
        return refuse('unsupported-content', 'a delimiter must be a non-empty string', 'delimiters');
      if (delimiter.length > MAX_DELIMITER_LENGTH)
        return refuse('unsupported-content', 'that delimiter is too long', 'delimiters');
    }
    const conflict = claim(paragraph.paragraphId);
    if (conflict) return conflict;

    const slot = slotById.get(paragraph.paragraphId);
    if (!slot) return refuse('invalid-handle', 'that paragraph is not in the body');
    const text = reads.paragraphText(paragraph.paragraphId) ?? '';
    const occurrences = delimiterOccurrences(text, delimiters);

    const ops: TreeDocOp[] = [];
    const offsets: number[] = [];
    /** The text each resulting paragraph will hold, for the answered ranges. */
    const pieces: string[] = [];

    if (occurrences.length === 0) {
      pieces.push(text);
    } else if (trimDelimiters) {
      // Cut the delimiters out from the LAST backwards, so every remaining op's offsets still
      // describe the paragraph the caller measured.
      for (const occurrence of [...occurrences].reverse()) {
        ops.push({
          op: 'deleteText',
          paragraphId: paragraph.paragraphId,
          start: occurrence.start,
          end: occurrence.start + occurrence.length,
        });
      }
      let removed = 0;
      let previous = 0;
      for (const occurrence of occurrences) {
        const at = occurrence.start - removed;
        offsets.push(at);
        pieces.push(text.slice(previous, occurrence.start));
        previous = occurrence.start + occurrence.length;
        removed += occurrence.length;
      }
      pieces.push(text.slice(previous));
    } else {
      let previous = 0;
      for (const occurrence of occurrences) {
        const at = occurrence.start + occurrence.length;
        offsets.push(at);
        pieces.push(text.slice(previous, at));
        previous = at;
      }
      pieces.push(text.slice(previous));
    }

    if (offsets.length > 0)
      ops.push({ op: 'splitParagraphMany', paragraphId: paragraph.paragraphId, offsets });

    const parts: Slot[] = [slot];
    for (let index = 0; index < offsets.length; index += 1)
      parts.push(insertSlot(positionOf(slot) + 1 + index));

    const answer = (post: AutomationDocumentReads): AutomationValue => {
      const spans: AutomationSpan[] = [];
      parts.forEach((part, index) => {
        const id = part.id;
        if (id === null) return;
        const piece = post.paragraphText(id) ?? (pieces[index] ?? '');
        const [from, to] = trimSpacing ? trimmed(piece, 0, piece.length) : [0, piece.length];
        const handle = handles.paragraph(id);
        spans.push({
          start: { paragraph: handle, offset: from },
          end: { paragraph: handle, offset: to },
        });
      });
      return { kind: 'spans', spans };
    };
    return { ok: true, kind: 'command', ops, answer };
  };

  const planDeleteParagraph = (paragraph: ResolvedPoint): PlannedOperation => {
    const conflict = claim(paragraph.paragraphId);
    if (conflict) return conflict;
    const slot = slotById.get(paragraph.paragraphId);
    if (slot) order.splice(positionOf(slot), 1);
    return {
      ok: true,
      kind: 'command',
      ops: [{ op: 'deleteBlock', blockId: paragraph.paragraphId }],
      answer: () => APPLIED,
    };
  };

  const planSelect = (
    range: ResolvedRange,
    mode: AutomationSelectionMode,
  ): PlannedOperation => {
    if (!capabilities.selection || !host.select)
      return refuse('unsupported-capability', 'this host has no reader to move', 'selection');
    if (mode !== 'select' && mode !== 'start' && mode !== 'end')
      return refuse('unknown-operation', 'that is not a selection mode', String(mode));
    // Selecting is applied after the transaction, so a batch that also EDITS one of the
    // paragraphs the selection covers would place a caret using coordinates the edit moved.
    for (const paragraphId of spanParagraphIds(range, reads)) {
      if (touched.has(paragraphId)) {
        return refuse(
          'conflicting-operations',
          'this batch edits a paragraph the selection covers',
          paragraphId,
        );
      }
    }
    selections.push({ range, mode });
    return { ok: true, kind: 'command', ops: [], answer: () => APPLIED };
  };

  const plan = (operation: AutomationOperation): PlannedOperation => {
    switch (operation.op) {
      case 'getDocument':
        return query({ kind: 'handle', handle: handles.document() });

      case 'getBody': {
        if (!handles.resolve(operation.document, 'document'))
          return refuse('invalid-handle', 'that handle does not name a document', 'document');
        return query({ kind: 'handle', handle: handles.body() });
      }

      case 'getParagraphs': {
        if (!handles.resolve(operation.body, 'body'))
          return refuse('invalid-handle', 'that handle does not name a body', 'body');
        return query({
          kind: 'handles',
          handles: reads.bodyParagraphIds.map((id) => handles.paragraph(id)),
        });
      }

      case 'getSpanParagraphs': {
        const resolved = resolveSpanRef(operation.span, handles, reads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        return query({
          kind: 'handles',
          handles: spanParagraphIds(resolved.value, reads).map((id) => handles.paragraph(id)),
        });
      }

      case 'getText': {
        if (handles.resolve(operation.target, 'body'))
          return query({ kind: 'text', text: reads.bodyText() });
        const paragraph = resolveParagraphHandle(operation.target, handles, reads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a body or a paragraph', paragraph.detail);
        return query({
          kind: 'text',
          text: reads.paragraphText(paragraph.value.paragraphId) ?? '',
        });
      }

      case 'getSpanText': {
        const resolved = resolveSpanRef(operation.span, handles, reads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        return query({ kind: 'text', text: spanText(resolved.value, reads, PARAGRAPH_MARK) });
      }

      case 'getParagraphId': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, reads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const read = reads.paragraph(paragraph.value.paragraphId);
        // A document Word never touched may carry no `w14:paraId`; empty text says "this
        // document does not write one" rather than inventing an identity the file lacks.
        return query({ kind: 'text', text: read?.paraId ?? '' });
      }

      case 'search': {
        if (!handles.resolve(operation.body, 'body'))
          return refuse('invalid-handle', 'that handle does not name a body', 'body');
        return searchStory(operation.text, operation.options);
      }

      case 'insertText': {
        const at = resolvePoint(operation.at, handles, reads);
        if (!at.ok) return refuse(at.code, 'that is not a place to insert at', at.detail);
        return planInsertText(at.value, operation.text);
      }

      case 'replaceSpan': {
        const resolved = resolveSpanRef(operation.span, handles, reads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse('invalid-offset', 'that story holds no paragraph to write into', 'empty-story');
        return planReplaceSpan(resolved.value, operation.text);
      }

      case 'insertParagraph': {
        const anchor = resolveParagraphRef(operation.anchor, handles, reads);
        if (!anchor.ok) return refuse(anchor.code, 'that is not a paragraph to insert beside', anchor.detail);
        if (operation.where !== 'before' && operation.where !== 'after')
          return refuse('unknown-operation', 'that is not a place to insert', String(operation.where));
        return planInsertParagraph(anchor.value, operation.where, operation.text);
      }

      case 'splitParagraph': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, reads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        return planSplitParagraph(
          paragraph.value,
          operation.delimiters,
          operation.trimDelimiters === true,
          operation.trimSpacing === true,
        );
      }

      case 'deleteParagraph': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, reads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        return planDeleteParagraph(paragraph.value);
      }

      case 'selectSpan': {
        const resolved = resolveSpanRef(operation.span, handles, reads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse('invalid-offset', 'that story holds no paragraph to select', 'empty-story');
        return planSelect(resolved.value, operation.mode);
      }

      default: {
        const unknown = operation as { readonly op?: unknown };
        return refuse(
          'unknown-operation',
          'this host does not implement that operation',
          String(unknown.op),
        );
      }
    }
  };

  return {
    plan(operation) {
      const planned = plan(operation);
      if (planned.ok && isAutomationCommand(operation)) hasCommands = true;
      return planned;
    },
    get hasCommands() {
      return hasCommands;
    },
    settle(post) {
      const before = new Set(reads.bodyParagraphIds);
      const fresh = post.bodyParagraphIds.filter((id) => !before.has(id));
      if (fresh.length !== created.length) {
        return {
          ok: false,
          detail: `planned ${String(created.length)} new paragraphs, the transaction made ${String(fresh.length)}`,
        };
      }
      // Reading order on both sides: `created` is ordered by the symbolic story position each
      // slot was inserted at, and `fresh` by where the paragraphs actually landed.
      const inOrder = order.filter((slot) => slot.id === null);
      inOrder.forEach((slot, index) => {
        slot.id = fresh[index] ?? null;
      });
      for (const retarget of retargets) {
        if (retarget.slot.id) handles.retarget(retarget.from, retarget.slot.id);
      }
      for (const selection of selections) host.select?.(selection.range, selection.mode);
      return { ok: true };
    },
  };
}
