// Review reads narrowed to a stretch of a story, and review-queue keys resolved to a stretch.
//
// A RANGE ASKS BY POSITION. `getRevisions` with a span answers the listed decisions of that
// span's story whose characters the span overlaps, in the same order and with the same handles
// as the story-wide listing, so a revision reached through a range IS the one the body lists.
// Positions are model offsets: the runtime's text view changes what a range's text reads, never
// which decisions sit inside it.
//
// A REVIEW KEY IS THE QUEUE'S NAME FOR A DECISION. The editor's review queue keys every card as
// `${kind}-${id}`, and a paired replacement as `revision-replace:${deletion}+${insertion}`. This
// file finds the item a key names by asking every story for its own items, the same membership
// the listings use, and answers the stretch that covers all of the item's ranges. A key naming
// nothing answers no stretch rather than a refusal, so a caller can choose a null object.

import { planRevisionBatch } from '../store/store/revision-batch.ts';
import { reviewItemKey, type ReviewRange } from '../store/store/review-items.ts';
import { commentReads, revisionItemsInStory, revisionReads } from './review.ts';
import {
  resolveSpanRef,
  spanValue,
  storyOfHandle,
  storyOfSpanRef,
  type ResolvedRange,
} from './spans.ts';
import { sharesItsPart, type AutomationShapeOwnerStory } from './stories.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationErrorCode, AutomationSpan, AutomationValue } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';

const PAIR_PREFIX = 'replace:';
/** A reply chain is walked to its anchored head; the file already broke any cycle. */
const MAX_THREAD_DEPTH = 64;

function refuse(code: AutomationErrorCode, message: string, detail?: string): PlannedOperation {
  return {
    ok: false,
    error: Object.freeze(detail === undefined ? { code, message } : { code, message, detail }),
  };
}

function query(value: AutomationValue): PlannedOperation {
  return { ok: true, kind: 'query', value };
}

interface Position {
  readonly index: number;
  readonly offset: number;
}

function compare(a: Position, b: Position): number {
  return a.index === b.index ? a.offset - b.offset : a.index - b.index;
}

/**
 * Whether a review range shares characters with a span of the same story.
 *
 * A collapsed span or a collapsed change counts when it touches the other, so a caret inside a
 * change finds it and a span ending where a paragraph-mark change sits includes that change.
 */
function overlaps(reads: AutomationStoryReads, scope: ResolvedRange, range: ReviewRange): boolean {
  const from = reads.indexOf(range.start.paragraphId);
  const to = reads.indexOf(range.end.paragraphId);
  if (from < 0 || to < 0) return false;
  const start = { index: from, offset: range.start.offset };
  const end = { index: to, offset: range.end.offset };
  const low = { index: reads.indexOf(scope.start.paragraphId), offset: scope.start.offset };
  const high = { index: reads.indexOf(scope.end.paragraphId), offset: scope.end.offset };
  const collapsed = compare(start, end) === 0 || compare(low, high) === 0;
  return collapsed
    ? compare(start, high) <= 0 && compare(end, low) >= 0
    : compare(start, high) < 0 && compare(end, low) > 0;
}

/** The listed decisions of a span's story that the span overlaps, in document order. */
function revisionsInScope(reads: AutomationStoryReads, scope: ResolvedRange | null) {
  if (scope === null) return [];
  return revisionReads(reads).filter((revision) =>
    revision.item.ranges.some((range) => overlaps(reads, scope, range))
  );
}

type ScopedListing = Extract<AutomationOperation, { readonly op: 'getRevisions' }>;

/** Plan `getRevisions`: a whole story by its body handle, or the decisions a span overlaps. */
export function planRevisionListing(
  operation: ScopedListing,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads
): PlannedOperation {
  if ('body' in operation) {
    const story = storyOfHandle(operation.body, 'body', handles, packageReads);
    if (!story.ok) return refuse(story.code, 'that handle does not name a body', story.detail);
    const reads = story.value;
    return query({
      kind: 'handles',
      handles: revisionReads(reads).map((item) => handles.revision(item.id, reads.story)),
    });
  }
  const scope = resolveSpanRef(operation.scope, handles, packageReads);
  if (!scope.ok) return refuse(scope.code, 'that span is not a place', scope.detail);
  const story = storyOfSpanRef(operation.scope, handles, packageReads);
  if (!story.ok) return refuse(story.code, 'that span names no story', story.detail);
  const reads = story.value;
  return query({
    kind: 'handles',
    handles: revisionsInScope(reads, scope.value).map((item) =>
      handles.revision(item.id, reads.story)
    ),
  });
}

type ScopedDecision = Extract<
  AutomationOperation,
  { readonly op: 'acceptAllRevisions' | 'rejectAllRevisions'; readonly scope: unknown }
>;

/**
 * Accept or reject exactly the decisions a span's listing holds, as one transaction.
 *
 * Refuses the whole decision when any member cannot be resolved, as the story-wide form does,
 * rather than resolving part of what the caller asked for.
 */
export function planScopedRevisionDecision(
  operation: ScopedDecision,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads,
  pin: (story: AutomationStoryReads) => PlannedOperation | null
): PlannedOperation {
  const scope = resolveSpanRef(operation.scope, handles, packageReads);
  if (!scope.ok) return refuse(scope.code, 'that span is not a place', scope.detail);
  const story = storyOfSpanRef(operation.scope, handles, packageReads);
  if (!story.ok) return refuse(story.code, 'that span names no story', story.detail);
  const reads = story.value;
  const keys = revisionsInScope(reads, scope.value).map((revision) => reviewItemKey(revision.item));
  const conflict = pin(reads);
  if (conflict) return conflict;
  if (keys.length === 0)
    return { ok: true, kind: 'command', story: reads.story, ops: [], answer: () => APPLIED };
  const decision = planRevisionBatch(
    reads.part,
    operation.op === 'acceptAllRevisions' ? 'accept' : 'reject',
    keys,
    sharesItsPart(reads.story) ? reads.root : undefined
  );
  if (decision.result.skipped.length > 0)
    return refuse(
      'unsupported-revision',
      'a tracked change in that span cannot be resolved',
      decision.result.skipped[0]?.reason
    );
  return {
    ok: true,
    kind: 'command',
    story: reads.story,
    ops: decision.ops,
    answer: () => APPLIED,
  };
}

const APPLIED: AutomationValue = Object.freeze({ kind: 'applied' as const });

/** Every story the document holds: body, declared furniture, notes, then text boxes. */
function* everyStory(packageReads: AutomationPackageReads): Generator<AutomationStoryReads> {
  const owners: AutomationShapeOwnerStory[] = [];
  if (packageReads.body) {
    yield packageReads.body;
    owners.push({ kind: 'body' });
  }
  const sections = packageReads.sections().length;
  for (let sectionIndex = 0; sectionIndex < sections; sectionIndex += 1) {
    for (const slot of packageReads.furniture(sectionIndex)) {
      // An inherited slot is an earlier section's part, already asked.
      if (!slot.declared) continue;
      const id: AutomationShapeOwnerStory = {
        kind: slot.kind,
        sectionIndex,
        variant: slot.variant,
      };
      const reads = packageReads.story(id);
      if (!reads) continue;
      yield reads;
      owners.push(id);
    }
  }
  for (const noteKind of ['footnote', 'endnote'] as const) {
    const listing = packageReads.noteIds(noteKind);
    if (!listing.ok) continue;
    for (const noteId of listing.ids) {
      const reads = packageReads.story({ kind: 'note', noteKind, noteId });
      if (reads) yield reads;
    }
  }
  for (const owner of owners) {
    const listing = packageReads.shapes(owner);
    if (!listing.ok) continue;
    for (const shape of listing.shapes) {
      if (!shape.textboxRoot) continue;
      const reads = packageReads.story({ kind: 'textbox', owner, shapeId: shape.id });
      if (reads) yield reads;
    }
  }
}

/** The ranges a revision key names in one story, or null when the story holds no such item. */
function revisionRangesIn(reads: AutomationStoryReads, id: string): readonly ReviewRange[] | null {
  const items = revisionItemsInStory(reads);
  if (!id.startsWith(PAIR_PREFIX)) return items.find((item) => item.id === id)?.ranges ?? null;
  const halves = id.slice(PAIR_PREFIX.length);
  for (const deletion of items) {
    if (deletion.revisionKind !== 'delete' || !halves.startsWith(`${deletion.id}+`)) continue;
    const insertionId = halves.slice(deletion.id.length + 1);
    const insertion = items.find(
      (item) => item.revisionKind === 'insert' && item.id === insertionId
    );
    if (insertion) return [...deletion.ranges, ...insertion.ranges];
  }
  return null;
}

/** The anchored range of a comment, or of the thread head a reply answers. */
function commentRangeIn(
  pkg: NonNullable<AutomationPackageReads['package']>,
  reads: AutomationStoryReads,
  id: string
): readonly ReviewRange[] | null {
  const comments = commentReads(pkg, reads);
  let item = comments.byId(id);
  for (let depth = 0; item && depth <= MAX_THREAD_DEPTH; depth += 1) {
    if (item.range) return item.orphaned ? [] : [item.range];
    item = item.parentId === undefined ? null : comments.byId(item.parentId);
  }
  return null;
}

/** One stretch from the earliest start to the latest end of `ranges`, clamped to the story. */
function coveringSpan(
  reads: AutomationStoryReads,
  ranges: readonly ReviewRange[],
  handles: AutomationHandleTable
): AutomationSpan | null {
  let low: (Position & { readonly paragraphId: string }) | null = null;
  let high: (Position & { readonly paragraphId: string }) | null = null;
  for (const range of ranges) {
    for (const point of [range.start, range.end]) {
      const text = reads.rawText(point.paragraphId);
      if (text === null) return null;
      const at = {
        paragraphId: point.paragraphId,
        index: reads.indexOf(point.paragraphId),
        offset: Math.min(point.offset, text.length),
      };
      if (!low || compare(at, low) < 0) low = at;
      if (!high || compare(at, high) > 0) high = at;
    }
  }
  if (!low || !high) return null;
  const story = reads.story;
  return spanValue({ start: { ...low, story }, end: { ...high, story } }, handles);
}

/**
 * Plan `getReviewItemRange`: the stretch a review-queue key names, as zero or one spans.
 *
 * Revision and comment keys resolve. A key naming nothing, an item with no place in a story, or
 * an orphaned comment answers no span.
 */
export function planReviewItemRange(
  key: unknown,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads
): PlannedOperation {
  if (typeof key !== 'string' || key.length === 0)
    return refuse('unsupported-content', 'a review item key is nonempty text');
  const pkg = packageReads.package;
  if (pkg === null) return refuse('document-unavailable', 'this host holds no document');
  const kind = key.startsWith('revision-')
    ? 'revision'
    : key.startsWith('comment-')
      ? 'comment'
      : null;
  if (kind === null) return query({ kind: 'spans', spans: [] });
  const id = key.slice(kind.length + 1);
  for (const reads of everyStory(packageReads)) {
    const ranges =
      kind === 'revision' ? revisionRangesIn(reads, id) : commentRangeIn(pkg, reads, id);
    if (ranges === null) continue;
    const span = ranges.length === 0 ? null : coveringSpan(reads, ranges, handles);
    return query({ kind: 'spans', spans: span ? [span] : [] });
  }
  return query({ kind: 'spans', spans: [] });
}
