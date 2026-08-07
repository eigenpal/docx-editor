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
import type { OoxmlProperty, TreeDocOp } from '../store/store/tree-ops.ts';
import {
  findOccurrences,
  isSearchableQuery,
  SEARCH_MATCH_LIMIT,
} from '../store/store/text-match.ts';
import {
  directParagraphMarkProperties,
  directParagraphProperties,
  mergedProperties,
  runPropertyEdits,
} from '../store/store/direct-properties.ts';
import {
  fontProperties,
  fontRead,
  paragraphFormatProperties,
  paragraphFormatRead,
  type AutomationFontWrite,
  type AutomationParagraphFormatWrite,
} from './formatting.ts';
import type { AutomationHandleTable } from './handles.ts';
import type {
  AutomationOperation,
  AutomationSearchOptions,
  AutomationSelectionMode,
} from './operations.ts';
import { createBatchCommandPolicy } from './batch-command-policy.ts';
import type {
  AutomationCapabilities,
  AutomationError,
  AutomationErrorCode,
  AutomationHandle,
  AutomationSpan,
  AutomationValue,
} from './protocol.ts';
import { PARAGRAPH_MARK, type AutomationPackageReads, type AutomationStoryReads } from './reads.ts';
import {
  resolveParagraphHandle,
  resolveParagraphRef,
  resolvePoint,
  resolveSpanRef,
  spanOffsets,
  spanParagraphIds,
  spanText,
  spanValue,
  storyOfHandle,
  storyOfSpanRef,
  type ResolvedPoint,
  type ResolvedRange,
  type ResolvedSpan,
} from './spans.ts';
import { BODY_STORY, storyKey, type AutomationStoryId } from './stories.ts';
import { isStoryId } from './stories.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { authorableHyperlinkTarget } from '../store/package/hyperlink-part.ts';
import {
  bookmarkIn,
  bookmarkReads,
  linkTarget,
  linksInParagraph,
  type AutomationLinkRead,
} from './links.ts';
import { listReads, membershipIn, MAX_LIST_LEVEL, type AutomationListRead } from './lists.ts';
import { pageSetupProperties, type AutomationSectionRead } from './sections.ts';
import type { NoteKind } from '../store/package/note-nodes.ts';
import { paragraphStyleName, styleIdFor } from './styles.ts';
import type { StoryScope } from '../store/store/tree-package-store.ts';
import type { AutomationCommentWrite } from './document-port.ts';
import { commentReads, revisionReads, type AutomationRevisionRead } from './review.ts';
import { revisionCollectionOps, revisionDecisionTarget } from './revision-operations.ts';
import type { ReviewCommentItem } from '../store/store/review-reads.ts';
import {
  planDeleteComment,
  planInsertComment,
  stagedCommentDate,
  validatePlannedCommentFields,
} from './comment-create-plan.ts';
import {
  contentControlNodeOf,
  contentControlReadOf,
  contentControlReads,
  contentControlSpan,
  contentControlText,
  type AutomationContentControlRead,
} from './content-controls.ts';
import {
  contentControlContentNodeOf,
  contentControlPropertiesOf,
  contentControlsIn,
} from '../store/package/content-control-nodes.ts';
import type { ContentControlValueInput } from '../store/store/tree-op-content-controls.ts';
import type { InsertCustomNodeWrite } from '../store/store/custom-node-writes.ts';
import {
  customNodePayloadOf,
  customNodePlacement,
  customNodeRequestRefusal,
  customNodeWriteOf,
} from './custom-node-plan.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';

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
      /** Which story the ops address. A batch commits into one story; see `pinWrite`. */
      readonly story: AutomationStoryId;
      /**
       * The op commits as a PACKAGE transaction rather than inside a story's.
       *
       * A note's lifecycle rewrites the notes part, the references in every story that cited it,
       * a relationship and a content-type override, and the store publishes that as its own undo
       * unit. The host routes it through the port's lifecycle path, and the planner has already
       * refused it any company — one commit per batch, or the batch is not one transaction.
       */
      readonly lifecycle?: boolean;
      /**
       * A relationship these ops need, and the ops once the package declares it.
       *
       * Present only for an external hyperlink target, and then `ops` is EMPTY: a relationship is a
       * package fact that outlives a refusal — it lives beside the trees, outside the undo stack —
       * so minting one while planning left a `Relationship` in `.rels` for a link a later refusal
       * meant the document never got, on a document that may not even have been writable. Planning
       * validates the target (see `authorableHyperlinkTarget`, the same gate the mint applies) and
       * schedules it; the application path mints it after the mode gate has passed and builds the
       * ops from the id it got back.
       */
      readonly relate?: {
        readonly url: string;
        readonly ops: (relationshipId: string) => readonly TreeDocOp[];
      };
      /** Computed after the commit, so a created paragraph can be named. */
      readonly answer: (post: AutomationPackageReads) => AutomationValue;
    }
  | {
      readonly ok: true;
      /**
       * A comment write, which is a package transaction of its own rather than a tree op.
       *
       * See `AutomationDocumentPort.applyCommentWrite`: a reply is markers plus `comments.xml`
       * plus `commentsExtended.xml` plus a relationship plus a content type, and the engine
       * already commits that as one thing. Solitary like a lifecycle op, for the same reason.
       */
      readonly kind: 'commentWrite';
      readonly write: AutomationCommentWrite;
      readonly story: AutomationStoryId;
      /**
       * The answer, given the committed state and the id the write minted.
       *
       * The id is carried separately because it does not exist until the package transaction runs:
       * a reply's `w:id` is chosen while writing `comments.xml`, and nothing in the post-commit
       * reads says which of the part's comments the caller just added.
       */
      readonly answer: (
        post: AutomationPackageReads,
        commentId: string | undefined
      ) => AutomationValue;
    }
  | {
      readonly ok: true;
      /**
       * A custom-node write: the data part, the node inside it, and the bound control.
       *
       * See `AutomationDocumentPort.applyCustomNodeWrite`. Its own kind rather than a command
       * with ops, because the store the binding quotes does not exist until the write runs — a
       * `TreeDocOp` carrying the `w:storeItemID` would have to be built from an id nothing has
       * minted yet. Solitary, like a comment write.
       */
      readonly kind: 'customNodeWrite';
      readonly write: InsertCustomNodeWrite;
      readonly story: AutomationStoryId;
      readonly answer: (post: AutomationPackageReads) => AutomationValue;
    }
  | { readonly ok: false; readonly error: AutomationError };

/** A position in the symbolic story order. Bound to a real id after the commit. */
interface Slot {
  id: string | null;
}

export interface BatchPlannerHost {
  readonly handles: AutomationHandleTable;
  readonly reads: AutomationPackageReads;
  readonly capabilities: AutomationCapabilities;
  /** Moves a reader's caret. Only called when `capabilities.selection` is true. */
  readonly select?: (range: ResolvedRange, mode: AutomationSelectionMode) => void;
}

export interface BatchPlanner {
  plan(operation: AutomationOperation): PlannedOperation;
  /** Whether any planned operation writes. */
  readonly hasCommands: boolean;
  /**
   * The transaction scope this batch's commands commit through, or null for a read-only batch.
   *
   * ONE scope, because one batch is one transaction and a transaction belongs to one story. A
   * batch mixing two stories' writes is refused while planning rather than split into two
   * commits: two commits are two revisions, two undo units and a window where half the caller's
   * request is published — which is the partial application the batch rule exists to prevent.
   */
  readonly writeScope: StoryScope | null;
  /**
   * Bind created paragraphs and re-aim moved identities against the committed state.
   *
   * Runs before any command answers, and only when a transaction committed. A mismatch here
   * means the planner's picture of what the ops would do disagrees with what they did, which
   * is a bug in this file rather than in the caller's request — it is reported rather than
   * papered over, because binding a slot to the wrong paragraph would hand back a handle that
   * names the wrong thing forever.
   */
  settle(
    post: AutomationPackageReads
  ): { readonly ok: true } | { readonly ok: false; readonly detail: string };
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

/**
 * Every control under a scope, nested ones included, in document order.
 *
 * For the lookups that search what the FILE wrote — an id, a tag, a title. Word's own numbering
 * is not scoped to a nesting level, so a lookup restricted to a scope's direct children would
 * report a control that plainly exists as absent.
 */
function allControlsUnder(scope: OoxmlNode): readonly OoxmlNode[] {
  const root = scope.kind === 'contentControl' ? contentControlContentNodeOf(scope) : scope;
  if (!root) return [];
  return contentControlsIn(root).map((entry) => entry.node);
}

const CONTENT_CONTROL_LOCKS: ReadonlySet<string> = new Set([
  'unlocked',
  'sdtLocked',
  'contentLocked',
  'sdtContentLocked',
]);

const CONTENT_CONTROL_RANGE_LOCATIONS: ReadonlySet<string> = new Set([
  'whole',
  'content',
  'start',
  'end',
  'before',
  'after',
]);

const CONTENT_CONTROL_SUBTYPES: ReadonlySet<string> = new Set([
  'richText',
  'plainText',
  'dropDownList',
  'comboBox',
  'date',
]);

/** Longest tag/title/value a caller may author, so a script cannot ask for an unbounded write. */
const MAX_CONTROL_STRING = 4_096;

/**
 * The typed value a caller offered, or why it is not one.
 *
 * Validated HERE and not only in the store, because a caller-supplied object is untrusted input
 * arriving over a transport: a `value` that is a number, or a `kind` nobody declares, must be a
 * named refusal rather than something the tree lane has to defend against.
 */
function contentControlValueOf(value: unknown):
  | { readonly ok: true; readonly value: ContentControlValueInput }
  | {
      readonly ok: false;
      readonly code: AutomationErrorCode;
      readonly message: string;
      readonly detail?: string;
    } {
  const bad = (message: string, detail?: string) => ({
    ok: false as const,
    code: 'unsupported-content' as AutomationErrorCode,
    message,
    detail,
  });
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return bad('a control value states its kind', 'value');
  }
  const offered = value as Record<string, unknown>;
  const kind = offered.kind;
  if (kind === 'text' || kind === 'listItem') {
    const raw = kind === 'text' ? offered.text : offered.value;
    if (typeof raw !== 'string') return bad('that value is not a string', String(kind));
    if (raw.length > MAX_CONTROL_STRING) return bad('that value is too long', String(raw.length));
    return {
      ok: true,
      value: kind === 'text' ? { kind: 'text', text: raw } : { kind: 'listItem', value: raw },
    };
  }
  if (kind === 'checkbox') {
    const checked = offered.checked;
    if (typeof checked !== 'boolean') return bad('a checkbox is checked or not', 'checked');
    return { ok: true, value: { kind: 'checkbox', checked } };
  }
  if (kind === 'date') {
    const iso = offered.iso;
    if (typeof iso !== 'string') return bad('a date is an ISO-8601 string', 'iso');
    if (iso.length > 64) return bad('that is not a date', String(iso.length));
    return { ok: true, value: { kind: 'date', iso } };
  }
  return bad('that is not a value any control accepts', String(kind));
}

/** Every occurrence of any delimiter in `text`, non-overlapping, in order. */
function delimiterOccurrences(
  text: string,
  delimiters: readonly string[]
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

/**
 * The paragraph `setSectionProperties` should resolve a section from.
 *
 * A section is ended by the paragraph whose mark carries its `w:sectPr`, so that paragraph names
 * it exactly. The FINAL section is the exception: no mark closes it — the body-level `w:sectPr`
 * governs whatever is left — so the story's last paragraph names it, provided that paragraph is
 * not itself a section mark. When it is, the trailing blocks are not paragraphs and there is
 * nothing to anchor to; the caller is told rather than having another section written.
 */
function anchorForSection(
  body: AutomationStoryReads,
  sections: readonly AutomationSectionRead[],
  index: number
): string | null {
  const own = sections[index]?.markParagraphId ?? null;
  if (own !== null) return own;
  const ids = body.paragraphIds;
  const last = ids[ids.length - 1];
  if (last === undefined) return null;
  const marks = new Set(
    sections.map((section) => section.markParagraphId).filter((id): id is string => id !== null)
  );
  return marks.has(last) ? null : last;
}

/** Whether both ends of a range still name a paragraph and an offset inside it. */
function placeable(range: ResolvedRange, reads: AutomationStoryReads): boolean {
  for (const point of [range.start, range.end]) {
    const text = reads.paragraphText(point.paragraphId);
    if (text === null || point.offset > text.length) return false;
  }
  return true;
}

/** `[start, end)` narrowed past leading and trailing whitespace. */
function trimmed(text: string, start: number, end: number): readonly [number, number] {
  let from = start;
  let to = end;
  while (from < to && TRIMMABLE.test(text[from] as string)) from += 1;
  while (to > from && TRIMMABLE.test(text[to - 1] as string)) to -= 1;
  return [from, to];
}

/**
 * One story's planning state.
 *
 * PER STORY rather than per batch, because everything in it is addressed in one story's
 * coordinates: a symbolic paragraph order, the claims that keep two commands from planning
 * against the same paragraph, and the slots a structural command leaves for `settle` to bind. A
 * single shared set of those would have a header's paragraph conflicting with a body paragraph
 * that shares nothing but a position, and would settle created paragraphs against the wrong
 * story's reads.
 */
interface StoryPlan {
  readonly reads: AutomationStoryReads;
  /** The symbolic story order: bound slots for paragraphs that exist, unbound for created ones. */
  readonly order: Slot[];
  readonly slotById: Map<string, Slot>;
  readonly created: Slot[];
  /** Paragraphs a command has restructured, and paragraphs any command has touched. */
  readonly restructured: Set<string>;
  readonly touched: Set<string>;
  /** Property containers a command has written, as `container:paragraphId` (`claimFormatting`). */
  readonly formatted: Set<string>;
  /**
   * Paragraphs a queued selection covers.
   *
   * Tracked because a selection is applied AFTER the transaction while its coordinates were
   * resolved BEFORE it, so a batch that both selects a paragraph and changes it would move the
   * reader's caret to a position the change invalidated — or into a paragraph the change removed.
   * Which of the two the caller wrote first cannot matter, and this is the half that makes it not:
   * `planSelect` looks at what has been edited, and every edit looks at this.
   */
  readonly selected: Set<string>;
  /** Identity moves to apply after the commit: the caller's handle for `from` must name `to`. */
  readonly retargets: { readonly from: string; readonly slot: Slot }[];
}

export function createBatchPlanner(host: BatchPlannerHost): BatchPlanner {
  const { handles, capabilities } = host;
  const packageReads = host.reads;

  const plans = new Map<string, StoryPlan>();
  const planFor = (reads: AutomationStoryReads): StoryPlan => {
    const key = storyKey(reads.story);
    const existing = plans.get(key);
    if (existing) return existing;
    const slotById = new Map<string, Slot>();
    const order: Slot[] = reads.paragraphIds.map((id) => {
      const slot: Slot = { id };
      slotById.set(id, slot);
      return slot;
    });
    const fresh: StoryPlan = {
      reads,
      order,
      slotById,
      created: [],
      restructured: new Set<string>(),
      touched: new Set<string>(),
      formatted: new Set<string>(),
      selected: new Set<string>(),
      retargets: [],
    };
    plans.set(key, fresh);
    return fresh;
  };

  const selections: { readonly range: ResolvedRange; readonly mode: AutomationSelectionMode }[] =
    [];
  const commandPolicy = createBatchCommandPolicy();
  /** The one story this batch writes into, pinned by its first command. */
  let writeStory: StoryPlan | null = null;

  /**
   * Claim the batch's single write story, or refuse a second one. `TreePackageStore` commits per
   * story, so crossing stories would create two revisions, two undo units, and partial publication.
   */
  const pinWrite = (plan: StoryPlan): PlannedOperation | null => {
    if (writeStory === null) {
      writeStory = plan;
      return null;
    }
    if (writeStory === plan) return null;
    return refuse(
      'conflicting-operations',
      'one batch writes into one story',
      `${storyKey(writeStory.reads.story)} then ${storyKey(plan.reads.story)}`
    );
  };
  const pinCommentStory = (reads: AutomationStoryReads): PlannedOperation | null =>
    pinWrite(planFor(reads));

  /**
   * The comments of one story, or null when the document is gone.
   *
   * Read through the package rather than cached per batch: a reply commits and the next
   * operation must see it, and a batch that answered a stale thread would report a reply it
   * had just written as absent.
   */
  const commentsOf = (reads: AutomationStoryReads): ReturnType<typeof commentReads> | null => {
    const pkg = packageReads.package;
    return pkg === null ? null : commentReads(pkg, reads);
  };

  /** One comment's item, with the story it lives in, or a refusal naming which half failed. */
  const commentAt = (
    handle: unknown
  ):
    | { readonly ok: true; readonly reads: AutomationStoryReads; readonly item: ReviewCommentItem }
    | { readonly ok: false; readonly planned: PlannedOperation } => {
    const target = handles.resolve(handle, 'comment');
    if (!target || target.kind !== 'comment') {
      return {
        ok: false,
        planned: refuse('invalid-handle', 'that handle does not name a comment', 'comment'),
      };
    }
    const reads = packageReads.story(target.story);
    if (!reads) {
      return {
        ok: false,
        planned: refuse('invalid-handle', 'that story is not in this document'),
      };
    }
    const comments = commentsOf(reads);
    const item = comments?.byId(target.commentId) ?? null;
    if (!item) {
      return {
        ok: false,
        planned: refuse(
          'invalid-handle',
          'this document no longer holds that comment',
          target.commentId
        ),
      };
    }
    return { ok: true, reads, item };
  };

  /** One decision, with its story. A change the engine cannot resolve is not one of these. */
  const revisionAt = (
    handle: unknown
  ):
    | {
        readonly ok: true;
        readonly reads: AutomationStoryReads;
        readonly item: AutomationRevisionRead;
      }
    | { readonly ok: false; readonly planned: PlannedOperation } => {
    const target = handles.resolve(handle, 'revision');
    if (!target || target.kind !== 'revision') {
      return {
        ok: false,
        planned: refuse('invalid-handle', 'that handle does not name a tracked change', 'revision'),
      };
    }
    const reads = packageReads.story(target.story);
    if (!reads) {
      return { ok: false, planned: refuse('invalid-handle', 'that story is not in this document') };
    }
    const item = revisionReads(reads).find((each) => each.id === target.revisionId) ?? null;
    // RESOLVED MEANS GONE. A decision already made is not re-applied to whatever now occupies
    // its offsets — that would edit text the caller never named.
    if (!item) {
      return {
        ok: false,
        planned: refuse(
          'invalid-handle',
          'this document no longer holds that tracked change',
          target.revisionId
        ),
      };
    }
    return { ok: true, reads, item };
  };

  /** A review range as a protocol span, clamped to what the story still holds. */
  const spanOfReviewRange = (
    reads: AutomationStoryReads,
    range: {
      readonly start: { paragraphId: string; offset: number };
      readonly end: { paragraphId: string; offset: number };
    }
  ): AutomationSpan | null => {
    const startText = reads.paragraphText(range.start.paragraphId);
    const endText = reads.paragraphText(range.end.paragraphId);
    if (startText === null || endText === null) return null;
    const start: ResolvedPoint = {
      story: reads.story,
      paragraphId: range.start.paragraphId,
      index: reads.indexOf(range.start.paragraphId),
      offset: Math.min(range.start.offset, startText.length),
    };
    const end: ResolvedPoint = {
      story: reads.story,
      paragraphId: range.end.paragraphId,
      index: reads.indexOf(range.end.paragraphId),
      offset: Math.min(range.end.offset, endText.length),
    };
    return spanOf({ start, end });
  };

  const positionOf = (plan: StoryPlan, slot: Slot): number => plan.order.indexOf(slot);

  /** Refuse when a paragraph a queued selection covers is about to be changed. */
  const selectionConflict = (plan: StoryPlan, paragraphId: string): PlannedOperation | null =>
    plan.selected.has(paragraphId)
      ? refuse(
          'conflicting-operations',
          'this batch selects a paragraph it also edits',
          paragraphId
        )
      : null;

  /** Claim a paragraph for a structural command, or say why it cannot be claimed. */
  const claim = (plan: StoryPlan, paragraphId: string): PlannedOperation | null => {
    const selection = selectionConflict(plan, paragraphId);
    if (selection) return selection;
    if (plan.restructured.has(paragraphId) || plan.touched.has(paragraphId)) {
      return refuse(
        'conflicting-operations',
        'another operation in this batch already changes that paragraph',
        paragraphId
      );
    }
    plan.restructured.add(paragraphId);
    plan.touched.add(paragraphId);
    return null;
  };

  /** Record a non-structural touch, or say why the paragraph is already spoken for. */
  const touch = (plan: StoryPlan, paragraphId: string): PlannedOperation | null => {
    const selection = selectionConflict(plan, paragraphId);
    if (selection) return selection;
    if (plan.restructured.has(paragraphId)) {
      return refuse(
        'conflicting-operations',
        'another operation in this batch restructures that paragraph',
        paragraphId
      );
    }
    plan.touched.add(paragraphId);
    return null;
  };

  /**
   * Claim one of a paragraph's property CONTAINERS for a formatting write.
   *
   * Per container rather than per paragraph, and the distinction is the difference between the
   * ordinary shape of a formatting script working and not. A property write replaces the container
   * it names, so each op carries that container's existing children forward — read from the tree
   * as it was BEFORE the batch. Two writes to the SAME container are therefore refused: the second
   * carries children the first has already superseded, so the caller would have asked for two
   * things and silently got one. Two writes to DIFFERENT containers are independent — the run and
   * mark properties a font write touches are exactly the children a paragraph-property write keeps
   * as authored, and the other way round — so `font.bold = true` and `alignment = 'Right'` on one
   * paragraph in one sync are one batch and both land.
   */
  const claimFormatting = (
    plan: StoryPlan,
    paragraphId: string,
    container: 'runs' | 'paragraph'
  ): PlannedOperation | null => {
    const claimed = `${container}:${paragraphId}`;
    if (plan.formatted.has(claimed)) {
      return refuse(
        'conflicting-operations',
        'another operation in this batch already writes that formatting',
        paragraphId
      );
    }
    const conflict = touch(plan, paragraphId);
    if (conflict) return conflict;
    plan.formatted.add(claimed);
    return null;
  };

  /** A fresh unbound slot at `position`, remembered in creation-independent reading order. */
  const insertSlot = (plan: StoryPlan, position: number): Slot => {
    const slot: Slot = { id: null };
    plan.order.splice(position, 0, slot);
    plan.created.push(slot);
    return slot;
  };

  const spanOf = (range: ResolvedRange): AutomationSpan => spanValue(range, handles);

  /** The story a resolved range lives in, or null when the document went away. */
  const storyReadsOf = (span: ResolvedSpan): AutomationStoryReads | null =>
    span === null ? null : packageReads.story(span.start.story);

  const searchScope = (
    reads: AutomationStoryReads,
    scope: ResolvedSpan,
    text: string,
    options: AutomationSearchOptions | undefined
  ): PlannedOperation => {
    if (options?.matchWildcards === true)
      return refuse(
        'unsupported-capability',
        'wildcard search is not implemented',
        'matchWildcards'
      );
    if (options?.ignorePunct === true)
      return refuse(
        'unsupported-capability',
        'ignoring punctuation is not implemented',
        'ignorePunct'
      );
    if (options?.ignoreSpace === true)
      return refuse(
        'unsupported-capability',
        'ignoring whitespace is not implemented',
        'ignoreSpace'
      );
    if (!isSearchableQuery(text))
      return refuse('unsupported-content', 'that is not a query this host will scan for', 'text');

    const requested = options?.limit;
    if (requested !== undefined && (!Number.isInteger(requested) || requested < 0))
      return refuse('invalid-offset', 'limit must be a non-negative integer', String(requested));
    let budget = Math.min(requested ?? SEARCH_MATCH_LIMIT, SEARCH_MATCH_LIMIT);

    const spans: AutomationSpan[] = [];
    // An empty story has nothing to scan. Answering no matches is the truth about it, and it is
    // not the same answer as a refusal — there is no error in searching a document with no text.
    const ids = spanParagraphIds(scope, reads);
    const last = ids.length - 1;
    // Paragraph by paragraph, in reading order. A match never crosses a paragraph mark, which
    // is what Word's Find does too: a paragraph break is a boundary, not a character to match.
    for (const [position, paragraphId] of ids.entries()) {
      if (budget <= 0) break;
      const paragraphText = reads.paragraphText(paragraphId) ?? '';
      const found = findOccurrences(paragraphText, text, budget, {
        matchCase: options?.matchCase === true,
        wholeWord: options?.matchWholeWord === true,
        // The scope clips only its own two ends; everything between them is whole.
        ...(position === 0 && scope ? { from: scope.start.offset } : {}),
        ...(position === last && scope ? { to: scope.end.offset } : {}),
      });
      for (const occurrence of found.matches) {
        const paragraph = handles.paragraph(paragraphId, reads.story);
        spans.push({
          start: { paragraph, offset: occurrence.start },
          end: { paragraph, offset: occurrence.start + occurrence.length },
        });
      }
      budget -= found.matches.length;
    }
    return query({ kind: 'spans', spans });
  };

  const planInsertText = (plan: StoryPlan, at: ResolvedPoint, text: string): PlannedOperation => {
    if (typeof text !== 'string')
      return refuse('unsupported-content', 'insertText needs text', 'text');
    if (PARAGRAPH_BREAKING.test(text)) {
      return refuse(
        'unsupported-content',
        'text carrying a paragraph mark is not written by this host',
        'paragraph-mark-in-text'
      );
    }
    const pin = pinWrite(plan);
    if (pin) return pin;
    const conflict = touch(plan, at.paragraphId);
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
    return { ok: true, kind: 'command', ops, story: plan.reads.story, answer };
  };

  const planReplaceSpan = (
    plan: StoryPlan,
    range: ResolvedRange,
    text: string
  ): PlannedOperation => {
    const reads = plan.reads;
    if (typeof text !== 'string')
      return refuse('unsupported-content', 'replaceSpan needs text', 'text');
    if (PARAGRAPH_BREAKING.test(text)) {
      return refuse(
        'unsupported-content',
        'text carrying a paragraph mark is not written by this host',
        'paragraph-mark-in-text'
      );
    }

    const ids = spanParagraphIds(range, reads);
    const first = range.start.paragraphId;
    const ops: TreeDocOp[] = [];

    const pin = pinWrite(plan);
    if (pin) return pin;

    if (ids.length === 1) {
      const conflict = touch(plan, first);
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
        const conflict = claim(plan, paragraphId);
        if (conflict) return conflict;
      }
      const last = range.end.paragraphId;
      const headLength = (reads.paragraphText(first) ?? '').length;
      if (range.start.offset < headLength)
        ops.push({
          op: 'deleteText',
          paragraphId: first,
          start: range.start.offset,
          end: headLength,
        });
      if (range.end.offset > 0)
        ops.push({ op: 'deleteText', paragraphId: last, start: 0, end: range.end.offset });
      for (const middle of ids.slice(1, -1)) ops.push({ op: 'deleteBlock', blockId: middle });
      ops.push({ op: 'joinParagraphs', firstId: first, secondId: last });
      for (const gone of ids.slice(1)) {
        const slot = plan.slotById.get(gone);
        if (slot) plan.order.splice(positionOf(plan, slot), 1);
      }
    }

    if (text.length > 0)
      ops.push({ op: 'insertText', paragraphId: first, offset: range.start.offset, text });

    const start: ResolvedPoint = { ...range.start, paragraphId: first };
    const answer = (): AutomationValue => ({
      kind: 'span',
      span: spanOf({ start, end: { ...start, offset: start.offset + text.length } }),
    });
    return { ok: true, kind: 'command', ops, story: plan.reads.story, answer };
  };

  /**
   * Empty the WHOLE story and write `text` into what is left of it.
   *
   * Not the same plan as replacing a stretch of a story, and the difference is structural. A
   * stretch is deleted by removing text and joining what remains of the two ends; a story that
   * holds a table has no such join — `joinParagraphs` refuses across a cell boundary, because two
   * cells' paragraphs are not adjacent siblings — so "empty this story" takes the BLOCKS out
   * instead and keeps one paragraph to write into. That is also what Word leaves behind: a body
   * with no paragraph at all is not a document, it is a document with nowhere to put the caret.
   *
   * WHAT SURVIVES IS DELIBERATE. A paragraph whose mark ends a section stays and is emptied rather
   * than removed, because removing it would merge its section into the next one and take that
   * section's page size, orientation and headers over every page this one governed. A paragraph
   * inside a block-level content control stays for a plainer reason: `deleteBlock` does not name a
   * `w:sdt`, so the control is not a block this plan can remove, and emptying its paragraphs is the
   * honest half of the job. Everything else — paragraphs, tables — goes.
   */
  const planReplaceStory = (plan: StoryPlan, text: string): PlannedOperation => {
    const reads = plan.reads;
    if (typeof text !== 'string')
      return refuse('unsupported-content', 'replaceSpan needs text', 'text');
    if (PARAGRAPH_BREAKING.test(text)) {
      return refuse(
        'unsupported-content',
        'text carrying a paragraph mark is not written by this host',
        'paragraph-mark-in-text'
      );
    }

    const blocks = reads.blocks;
    const removed = blocks.filter((block) => block.removable);
    const survivors = blocks
      .filter((block) => !block.removable)
      .flatMap((block) => block.paragraphIds);

    // One paragraph has to remain to hold the text. When something already has to stay — a section
    // mark, a content control's contents — that IS the remainder and nothing is kept on its
    // account; otherwise the story's first paragraph is kept, so a caller's handle for it goes on
    // naming a paragraph and a script can clear a story and keep writing to it.
    const keeper =
      survivors.length === 0 ? removed.find((block) => block.kind === 'paragraph') : undefined;
    if (!keeper && survivors.length === 0) {
      // Every block is a table (or the story is empty). Emptying this story would need a paragraph
      // CREATED at the top level, which is not an op this slice has — and inventing one here would
      // mean guessing at its properties. Refused whole; the document is untouched.
      return refuse(
        'invalid-offset',
        'that story holds no paragraph this host can write into',
        'no-top-level-paragraph'
      );
    }

    // Every paragraph in the story belongs to this one command: it either goes away or is emptied,
    // so a second operation addressing any of them in this batch is planned against text that will
    // not be there.
    const pin = pinWrite(plan);
    if (pin) return pin;
    for (const paragraphId of reads.paragraphIds) {
      const conflict = claim(plan, paragraphId);
      if (conflict) return conflict;
    }

    const ops: TreeDocOp[] = [];
    // Reading order, so the text lands in the first paragraph the story still has.
    const kept: string[] = (keeper ? [keeper.id] : [...survivors]).sort(
      (a, b) => reads.indexOf(a) - reads.indexOf(b)
    );
    const target = kept[0] as string;

    for (const paragraphId of kept) {
      const length = (reads.paragraphText(paragraphId) ?? '').length;
      if (length > 0) ops.push({ op: 'deleteText', paragraphId, start: 0, end: length });
    }
    for (const block of removed) {
      if (block.id === keeper?.id) continue;
      ops.push({ op: 'deleteBlock', blockId: block.id });
    }
    if (text.length > 0) ops.push({ op: 'insertText', paragraphId: target, offset: 0, text });

    for (const block of removed) {
      if (block.id === keeper?.id) continue;
      for (const paragraphId of block.paragraphIds) {
        const slot = plan.slotById.get(paragraphId);
        if (slot) plan.order.splice(positionOf(plan, slot), 1);
      }
    }

    const start: ResolvedPoint = {
      story: reads.story,
      paragraphId: target,
      index: reads.indexOf(target),
      offset: 0,
    };
    const answer = (): AutomationValue => ({
      kind: 'span',
      span: spanOf({ start, end: { ...start, offset: text.length } }),
    });
    return { ok: true, kind: 'command', ops, story: reads.story, answer };
  };

  const planInsertParagraph = (
    plan: StoryPlan,
    anchor: ResolvedPoint,
    where: 'before' | 'after',
    text: string
  ): PlannedOperation => {
    const reads = plan.reads;
    if (typeof text !== 'string')
      return refuse('unsupported-content', 'insertParagraph needs text', 'text');
    if (PARAGRAPH_BREAKING.test(text)) {
      return refuse(
        'unsupported-content',
        'a paragraph mark inside a paragraph\u2019s text is not written by this host',
        'paragraph-mark-in-text'
      );
    }
    const pin = pinWrite(plan);
    if (pin) return pin;
    const conflict = claim(plan, anchor.paragraphId);
    if (conflict) return conflict;

    const anchorSlot = plan.slotById.get(anchor.paragraphId);
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
    const fresh = insertSlot(plan, positionOf(plan, anchorSlot) + 1);
    if (where === 'before') plan.retargets.push({ from: anchor.paragraphId, slot: fresh });

    // "after" names the created node; "before" names the original one, which now holds the
    // inserted paragraph. Both are asked for AFTER the retarget, so the handle is a new ref.
    const answer = (): AutomationValue => {
      const id = where === 'after' ? fresh.id : anchor.paragraphId;
      if (id === null) return APPLIED;
      return { kind: 'handle', handle: handles.paragraph(id, reads.story) };
    };
    return { ok: true, kind: 'command', ops, story: reads.story, answer };
  };

  const planSplitParagraph = (
    plan: StoryPlan,
    paragraph: ResolvedPoint,
    delimiters: readonly string[],
    trimDelimiters: boolean,
    trimSpacing: boolean
  ): PlannedOperation => {
    const reads = plan.reads;
    if (!Array.isArray(delimiters) || delimiters.length === 0)
      return refuse('unsupported-content', 'split needs at least one delimiter', 'delimiters');
    if (delimiters.length > MAX_DELIMITERS)
      return refuse('unsupported-content', 'too many delimiters', String(delimiters.length));
    for (const delimiter of delimiters) {
      if (typeof delimiter !== 'string' || delimiter.length === 0)
        return refuse(
          'unsupported-content',
          'a delimiter must be a non-empty string',
          'delimiters'
        );
      if (delimiter.length > MAX_DELIMITER_LENGTH)
        return refuse('unsupported-content', 'that delimiter is too long', 'delimiters');
    }
    const pin = pinWrite(plan);
    if (pin) return pin;
    const conflict = claim(plan, paragraph.paragraphId);
    if (conflict) return conflict;

    const slot = plan.slotById.get(paragraph.paragraphId);
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
      parts.push(insertSlot(plan, positionOf(plan, slot) + 1 + index));

    const answer = (post: AutomationPackageReads): AutomationValue => {
      const after = post.story(reads.story);
      const spans: AutomationSpan[] = [];
      parts.forEach((part, index) => {
        const id = part.id;
        if (id === null) return;
        const piece = after?.paragraphText(id) ?? pieces[index] ?? '';
        const [from, to] = trimSpacing ? trimmed(piece, 0, piece.length) : [0, piece.length];
        const handle = handles.paragraph(id, reads.story);
        spans.push({
          start: { paragraph: handle, offset: from },
          end: { paragraph: handle, offset: to },
        });
      });
      return { kind: 'spans', spans };
    };
    return { ok: true, kind: 'command', ops, story: reads.story, answer };
  };

  const planDeleteParagraph = (plan: StoryPlan, paragraph: ResolvedPoint): PlannedOperation => {
    const pin = pinWrite(plan);
    if (pin) return pin;
    const conflict = claim(plan, paragraph.paragraphId);
    if (conflict) return conflict;
    const slot = plan.slotById.get(paragraph.paragraphId);
    if (slot) plan.order.splice(positionOf(plan, slot), 1);
    return {
      ok: true,
      kind: 'command',
      ops: [{ op: 'deleteBlock', blockId: paragraph.paragraphId }],
      story: plan.reads.story,
      answer: () => APPLIED,
    };
  };

  /**
   * Author run properties over a span.
   *
   * One `setRunProperties` op per RUN the span covers — not per paragraph — each carrying that
   * run's own authored properties with the request merged over them. Both halves of that are
   * load-bearing, and `runPropertyEdits` is the one implementation of them: the op replaces the
   * container it writes, so a per-paragraph op would homogenise a mixed selection onto one run's
   * font, and an op that did not carry the run's bag forward would delete the colour of every run
   * it resized.
   *
   * The paragraph MARK's own `w:rPr` is written for every paragraph the span covers WHOLE, which
   * is what Word does and is not cosmetic: a list marker takes its face from the pilcrow, so a
   * whole-paragraph size change that skipped it leaves the bullet at the old size.
   *
   * A span covering no characters is refused: there is nothing to format, and writing the mark
   * alone would format a paragraph the caller addressed as a caret.
   */
  const planSetFont = (
    plan: StoryPlan,
    range: ResolvedRange,
    request: AutomationFontWrite
  ): PlannedOperation => {
    const reads = plan.reads;
    const part = reads.part;
    const pin = pinWrite(plan);
    if (pin) return pin;
    const properties = fontProperties(request ?? {});
    if (!properties.ok)
      return refuse(
        'unsupported-content',
        'that is not formatting this host writes',
        properties.detail
      );
    const ops: TreeDocOp[] = [];
    for (const share of spanOffsets(range, reads)) {
      if (share.end <= share.start && !share.whole) continue;
      const conflict = claimFormatting(plan, share.paragraphId, 'runs');
      if (conflict) return conflict;
      for (const edit of runPropertyEdits(
        part,
        share.paragraphId,
        share.start,
        share.end,
        properties.value
      )) {
        ops.push({
          op: 'setRunProperties',
          paragraphId: share.paragraphId,
          start: edit.start,
          end: edit.end,
          properties: edit.properties,
          ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
        });
      }
      if (share.whole) {
        ops.push({
          op: 'setParagraphMarkProperties',
          paragraphId: share.paragraphId,
          properties: mergedProperties(
            directParagraphMarkProperties(part, share.paragraphId),
            properties.value
          ),
        });
      }
    }
    if (ops.length === 0)
      return refuse(
        'invalid-offset',
        'that range covers no characters to format',
        'collapsed-range'
      );
    return { ok: true, kind: 'command', ops, story: reads.story, answer: () => APPLIED };
  };

  /**
   * Apply a paragraph style to every paragraph a span covers.
   *
   * One `setParagraphProperties` op per paragraph, each carrying that paragraph's own authored
   * properties with `w:pStyle` merged over them — the same rule every property write follows, and
   * the reason a style change does not delete a paragraph's indents and numbering. The style is
   * resolved ONCE for the whole span: it is a property of the document, not of a paragraph.
   */
  const planSetStyle = (plan: StoryPlan, range: ResolvedRange, name: string): PlannedOperation => {
    const reads = plan.reads;
    const part = reads.part;
    const pin = pinWrite(plan);
    if (pin) return pin;
    const resolved = styleIdFor(name, reads.styles());
    if (!resolved.ok)
      return refuse(
        'unsupported-content',
        'that is not a style this document has',
        resolved.detail
      );
    const style: OoxmlProperty = {
      localName: 'pStyle',
      attributes: { val: resolved.styleId },
    };
    const ops: TreeDocOp[] = [];
    for (const paragraphId of spanParagraphIds(range, reads)) {
      const conflict = claimFormatting(plan, paragraphId, 'paragraph');
      if (conflict) return conflict;
      ops.push({
        op: 'setParagraphProperties',
        paragraphId,
        properties: mergedProperties(directParagraphProperties(part, paragraphId), style),
      });
    }
    if (ops.length === 0)
      return refuse('invalid-offset', 'that story holds no paragraph to style', 'empty-story');
    return { ok: true, kind: 'command', ops, story: reads.story, answer: () => APPLIED };
  };

  const planSetParagraphFormat = (
    plan: StoryPlan,
    paragraph: ResolvedPoint,
    request: AutomationParagraphFormatWrite
  ): PlannedOperation => {
    const reads = plan.reads;
    const part = reads.part;
    const pin = pinWrite(plan);
    if (pin) return pin;
    const properties = paragraphFormatProperties(
      part,
      paragraph.paragraphId,
      request ?? {},
      reads.styles()
    );
    if (!properties.ok)
      return refuse(
        'unsupported-content',
        'that is not paragraph formatting this host writes',
        properties.detail
      );
    const conflict = claimFormatting(plan, paragraph.paragraphId, 'paragraph');
    if (conflict) return conflict;
    return {
      ok: true,
      kind: 'command',
      ops: [
        {
          op: 'setParagraphProperties',
          paragraphId: paragraph.paragraphId,
          properties: properties.value,
        },
      ],
      story: reads.story,
      answer: () => APPLIED,
    };
  };

  /**
   * Author page geometry on one section.
   *
   * ANCHORED, never applied document-wide: the op's own default is every section, and a caller
   * that asked about section two and got section one changed as well would have no way to notice.
   * The anchor is the paragraph whose mark ends the section — which is what `setSectionProperties`
   * resolves "the section governing this paragraph" from — or, for the final section that no mark
   * closes, the story's last paragraph.
   */
  const planSetPageSetup = (index: number, request: unknown): PlannedOperation => {
    const body = packageReads.body;
    if (!body) return refuse('document-unavailable', 'this host holds no document right now');
    const sections = packageReads.sections();
    const section = sections[index];
    if (!section) return refuse('invalid-handle', 'that section is not in this document');

    const fields = pageSetupProperties(request);
    if (!fields.ok) return refuse('unsupported-content', fields.reason, fields.detail);

    const anchorParagraphId = anchorForSection(body, sections, index);
    if (anchorParagraphId === null) {
      return refuse(
        'unsupported-content',
        'that section holds no paragraph to address it by',
        'no-anchor'
      );
    }

    const plan = planFor(body);
    const pin = pinWrite(plan);
    if (pin) return pin;
    // A SECTION IS NOT A PARAGRAPH, so nothing is claimed on the anchor: it is only how the op
    // names which `w:sectPr` to write, and the paragraph itself is untouched.
    return {
      ok: true,
      kind: 'command',
      ops: [{ op: 'setSectionProperties', ...fields.value, anchorParagraphId }],
      story: BODY_STORY,
      answer: () => APPLIED,
    };
  };

  /** Delete a note: package-level, so it travels alone. */
  const planDeleteNote = (noteKind: NoteKind, noteId: number): PlannedOperation => ({
    ok: true,
    kind: 'command',
    ops: [{ op: 'deleteNote', noteKind, noteId }],
    story: BODY_STORY,
    lifecycle: true,
    answer: () => APPLIED,
  });

  /**
   * The list a `list` handle names, in the story it names.
   *
   * Re-derived per operation rather than remembered from when the handle was minted: paragraphs
   * join and leave lists, so a list's membership is a fact about the document NOW. A number the
   * story no longer uses is a refusal — the list is gone, and answering an empty one would let a
   * caller believe a list survived the paragraph that was in it.
   */
  const listOf = (
    handle: unknown
  ): { ok: true; plan: StoryPlan; list: AutomationListRead } | PlannedOperation => {
    const target = handles.resolve(handle, 'list');
    if (!target || target.kind !== 'list')
      return refuse('invalid-handle', 'that handle does not name a list', 'list');
    const reads = packageReads.story(target.story);
    if (!reads) return refuse('invalid-handle', 'that story is not in this document');
    const found = listReads(reads).find((list) => list.numId === target.numId);
    if (!found)
      return refuse('invalid-handle', 'this story numbers nothing with that list', target.numId);
    return { ok: true, plan: planFor(reads), list: found };
  };

  /**
   * The scope a control query looks in: a story root, or one control's own content.
   *
   * Both answer the story their controls live in, because a nested control is in the same story
   * as the control holding it — a handle carries its story so the walk never has to guess.
   */
  const controlScope = (
    scope: unknown
  ): { reads: AutomationStoryReads; node: OoxmlNode } | PlannedOperation => {
    if (typeof scope !== 'object' || scope === null) {
      return refuse('invalid-handle', 'that is not a scope a control lives in', 'scope');
    }
    const named = scope as Record<string, AutomationHandle>;
    if ('body' in scope) {
      const story = storyOfHandle(named.body as AutomationHandle, 'body', handles, packageReads);
      if (!story.ok) return refuse(story.code, 'that handle does not name a body', story.detail);
      return { reads: story.value, node: story.value.root };
    }
    if ('contentControl' in scope) {
      const found = controlOf(named.contentControl);
      if (!('control' in found)) return found;
      return { reads: found.reads, node: found.node };
    }
    return refuse('invalid-handle', 'that is not a scope a control lives in', 'scope');
  };

  /**
   * The control a handle names, re-derived from the current package.
   *
   * A handle to a control the document no longer holds is `invalid-handle` rather than a read of
   * whatever moved into its place: a script that deleted a control and then asked its old
   * reference for text must not be answered with a neighbour's.
   */
  const controlOf = (
    handle: unknown
  ):
    | { reads: AutomationStoryReads; control: AutomationContentControlRead; node: OoxmlNode }
    | PlannedOperation => {
    const target = handles.resolve(handle, 'contentControl');
    if (!target || target.kind !== 'contentControl') {
      return refuse(
        'invalid-handle',
        'that handle does not name a content control',
        'contentControl'
      );
    }
    const reads = packageReads.story(target.story);
    if (!reads) return refuse('invalid-handle', 'that story is not in this document');
    const control = contentControlReadOf(reads, target.nodeId);
    const node = contentControlNodeOf(reads, target.nodeId);
    if (!control || !node) {
      return refuse('invalid-handle', 'this document no longer holds that content control');
    }
    return { reads, control, node };
  };

  const planSetListLevel = (
    plan: StoryPlan,
    paragraphId: string,
    level: number
  ): PlannedOperation => {
    if (!Number.isInteger(level) || level < 0 || level > MAX_LIST_LEVEL) {
      return refuse(
        'invalid-offset',
        `a list level is 0 to ${String(MAX_LIST_LEVEL)}`,
        String(level)
      );
    }
    // REFUSED FOR PROSE, not silently numbered: `setListLevel` writes `w:ilvl` inside an existing
    // `w:numPr`, and a paragraph with none is not a list item. Numbering it here would need a
    // `w:numId` this operation was never given.
    if (!membershipIn(plan.reads, paragraphId))
      return refuse('unsupported-content', 'that paragraph is not in a list', paragraphId);
    const pin = pinWrite(plan);
    if (pin) return pin;
    // The paragraph's PROPERTIES container, the same one a paragraph-format write claims: both
    // rewrite `w:pPr`, so two of them in one batch would carry each other's children away.
    const conflict = claimFormatting(plan, paragraphId, 'paragraph');
    if (conflict) return conflict;
    return {
      ok: true,
      kind: 'command',
      ops: [{ op: 'setListLevel', paragraphId, level }],
      story: plan.reads.story,
      answer: () => APPLIED,
    };
  };

  /**
   * Add an item at one edge of a list.
   *
   * ONE transaction and no numbering op of its own: a paragraph created beside a list item is
   * created BY SPLITTING it, and a split copies the paragraph's `w:pPr` — its `w:numPr` with it —
   * to both halves. So the new paragraph is in the list at the same level because it is the same
   * paragraph properties, which is also why Enter at the end of a list item continues the list in
   * Word. Stating the numbering again would mean naming a node the transaction has not made yet,
   * and that is a second commit.
   */
  const planInsertListParagraph = (
    plan: StoryPlan,
    list: AutomationListRead,
    where: 'start' | 'end',
    text: string
  ): PlannedOperation => {
    if (where !== 'start' && where !== 'end') {
      return refuse(
        'unknown-operation',
        'a list takes an item at its start or its end',
        String(where)
      );
    }
    const reads = plan.reads;
    const edgeId =
      where === 'start' ? list.paragraphIds[0] : list.paragraphIds[list.paragraphIds.length - 1];
    if (edgeId === undefined) return refuse('invalid-handle', 'that list holds no paragraph');
    const anchor: ResolvedPoint = {
      story: reads.story,
      paragraphId: edgeId,
      index: reads.indexOf(edgeId),
      offset: 0,
    };
    return planInsertParagraph(plan, anchor, where === 'start' ? 'before' : 'after', text);
  };

  /**
   * The one link that covers a whole span, or null.
   *
   * "Covers" is strict: a span reaching outside the link is not the link's span. A span crossing a
   * paragraph mark is never one link's either — a `w:hyperlink` lives inside one `w:p`.
   */
  const linkCovering = (
    reads: AutomationStoryReads,
    range: ResolvedRange
  ): AutomationLinkRead | null => {
    if (range.start.paragraphId !== range.end.paragraphId) return null;
    for (const link of linksInParagraph(reads, range.start.paragraphId)) {
      if (link.start <= range.start.offset && link.end >= range.end.offset) return link;
    }
    return null;
  };

  const planSetHyperlink = (
    plan: StoryPlan,
    range: ResolvedRange,
    target: string
  ): PlannedOperation => {
    if (typeof target !== 'string')
      return refuse('unsupported-content', 'a hyperlink target is a string', 'target');
    const reads = plan.reads;
    const existing = linkCovering(reads, range);
    const collapsed =
      range.start.paragraphId === range.end.paragraphId && range.start.offset === range.end.offset;

    // UNLINK. The element goes, the runs stay: their text, their formatting and their order are
    // not the link's, it only wrapped them.
    if (target.length === 0) {
      if (!existing) return refuse('unsupported-content', 'that text is not a link', 'no-link');
      const pin = pinWrite(plan);
      if (pin) return pin;
      const conflict = touch(plan, existing.paragraphId);
      if (conflict) return conflict;
      return {
        ok: true,
        kind: 'command',
        ops: [{ op: 'removeHyperlink', linkId: existing.id }],
        story: reads.story,
        answer: () => APPLIED,
      };
    }

    // An anchor names a bookmark in THIS document, so it is resolved against the story rather
    // than trusted: a jump to a name nothing declares lands nowhere, and writing it would put
    // that dead end in the file.
    let aimed: { readonly anchor?: string } = {};
    /** The external target to mint for, once the batch is allowed to write. */
    let external: string | null = null;
    if (target.startsWith('#')) {
      const name = target.slice(1);
      if (name.length === 0 || !bookmarkIn(reads, name))
        return refuse('unsupported-content', 'this document declares no such bookmark', target);
      aimed = { anchor: name };
    } else {
      // NULL IS THE SECURITY ANSWER as much as the validity one: a refused scheme, a target that
      // is not an absolute URI, a string too long to be one. Refused here, while planning, so no op
      // is staged and — because this only READS the rules — nothing about the package moves either.
      if (authorableHyperlinkTarget(target) === null)
        return refuse('unsupported-content', 'this engine will not author that target', 'target');
      external = target;
    }

    const pin = pinWrite(plan);
    if (pin) return pin;

    /** A command whose ops are ready, or scheduled behind the relationship they name. */
    const staged = (
      build: (aim: { readonly relationshipId?: string; readonly anchor?: string }) => TreeDocOp
    ): PlannedOperation =>
      external === null
        ? {
            ok: true,
            kind: 'command',
            ops: [build(aimed)],
            story: reads.story,
            answer: () => APPLIED,
          }
        : {
            ok: true,
            kind: 'command',
            ops: [],
            relate: {
              url: external,
              ops: (relationshipId: string) => [build({ relationshipId })],
            },
            story: reads.story,
            answer: () => APPLIED,
          };

    // RETARGET rather than wrap, when the span is already inside a link: replacing the element
    // would throw away its authored `w:history` and `w:tgtFrame` and its identity, and wrapping
    // it again would nest one link inside another — markup Word does not write.
    if (existing) {
      const conflict = touch(plan, existing.paragraphId);
      if (conflict) return conflict;
      return staged((aim) => ({ op: 'setHyperlinkTarget', linkId: existing.id, ...aim }));
    }

    if (collapsed)
      return refuse('unsupported-content', 'a link with no text has nothing to click', 'collapsed');
    if (range.start.paragraphId !== range.end.paragraphId) {
      return refuse(
        'unsupported-content',
        'a link lives inside one paragraph',
        'crosses-paragraph-mark'
      );
    }
    const conflict = touch(plan, range.start.paragraphId);
    if (conflict) return conflict;
    // `Hyperlink` is marked on the runs only when the document DEFINES it: a `w:rStyle` naming a
    // style that is not there paints nothing and reads back as a style the document lacks.
    const styleId = reads.styles().idOf('hyperlink');
    return staged((aim) => ({
      op: 'insertHyperlink',
      paragraphId: range.start.paragraphId,
      start: range.start.offset,
      end: range.end.offset,
      ...aim,
      ...(styleId === null ? {} : { styleId }),
    }));
  };

  const planSelect = (
    plan: StoryPlan,
    range: ResolvedRange,
    mode: AutomationSelectionMode
  ): PlannedOperation => {
    const reads = plan.reads;
    if (!capabilities.selection || !host.select)
      return refuse('unsupported-capability', 'this host has no reader to move', 'selection');
    if (mode !== 'select' && mode !== 'start' && mode !== 'end')
      return refuse('unknown-operation', 'that is not a selection mode', String(mode));
    // Selecting is applied after the transaction, so a batch that also EDITS one of the
    // paragraphs the selection covers would place a caret using coordinates the edit moved.
    const covered = spanParagraphIds(range, reads);
    for (const paragraphId of covered) {
      if (plan.touched.has(paragraphId)) {
        return refuse(
          'conflicting-operations',
          'this batch edits a paragraph the selection covers',
          paragraphId
        );
      }
    }
    for (const paragraphId of covered) plan.selected.add(paragraphId);
    selections.push({ range, mode });
    // NO SCOPE PINNED. Moving a reader's caret writes nothing, so it does not claim the batch's
    // one write story — a script may select in a header while it edits the body.
    return { ok: true, kind: 'command', ops: [], story: reads.story, answer: () => APPLIED };
  };

  const resolveBookmarkRange = (handle: AutomationHandle) => {
    const target = handles.resolve(handle, 'bookmark');
    if (!target || target.kind !== 'bookmark')
      return refuse('invalid-handle', 'that handle does not name a bookmark', 'bookmark');
    const reads = packageReads.story(target.story);
    if (!reads) return refuse('invalid-handle', 'that story is not in this document');
    const bookmark = bookmarkIn(reads, target.name);
    if (!bookmark)
      return refuse(
        'invalid-handle',
        'this document no longer declares that bookmark',
        target.name
      );
    const point = (marker: { readonly paragraphId: string; readonly offset: number }) => ({
      story: reads.story,
      paragraphId: marker.paragraphId,
      index: reads.indexOf(marker.paragraphId),
      offset: marker.offset,
    });
    return { reads, range: { start: point(bookmark.start), end: point(bookmark.end) } };
  };

  const plan = (operation: AutomationOperation): PlannedOperation => {
    switch (operation.op) {
      case 'getDocument':
        return query({ kind: 'handle', handle: handles.document() });

      case 'getBody': {
        if (!handles.resolve(operation.document, 'document'))
          return refuse('invalid-handle', 'that handle does not name a document', 'document');
        // A DOCUMENT'S BODY IS THE MAIN STORY, always. Headers, footers and notes are reached
        // through the section or the note that declares them, because that is where a document
        // says they exist — asking a document for "the header" has no answer.
        if (!packageReads.body)
          return refuse('document-unavailable', 'this host holds no document right now');
        return query({ kind: 'handle', handle: handles.body(BODY_STORY) });
      }

      case 'getParagraphs': {
        const story = storyOfHandle(operation.body, 'body', handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that handle does not name a body', story.detail);
        return query({
          kind: 'handles',
          handles: story.value.paragraphIds.map((id) => handles.paragraph(id, story.value.story)),
        });
      }

      case 'getSpanParagraphs': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        const story = storyOfSpanRef(operation.span, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
        return query({
          kind: 'handles',
          handles: spanParagraphIds(resolved.value, story.value).map((id) =>
            handles.paragraph(id, story.value.story)
          ),
        });
      }

      case 'getText': {
        const body = handles.resolve(operation.target, 'body');
        if (body) {
          const story = storyOfHandle(operation.target, 'body', handles, packageReads);
          if (!story.ok)
            return refuse(story.code, 'that handle does not name a body', story.detail);
          return query({ kind: 'text', text: story.value.text() });
        }
        const paragraph = resolveParagraphHandle(operation.target, handles, packageReads);
        if (!paragraph.ok)
          return refuse(
            paragraph.code,
            'that handle does not name a body or a paragraph',
            paragraph.detail
          );
        const story = packageReads.story(paragraph.value.story);
        return query({
          kind: 'text',
          text: story?.paragraphText(paragraph.value.paragraphId) ?? '',
        });
      }

      case 'getSpanText': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        const story = storyOfSpanRef(operation.span, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
        return query({
          kind: 'text',
          text: spanText(resolved.value, story.value, PARAGRAPH_MARK),
        });
      }

      case 'getParagraphId': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const story = packageReads.story(paragraph.value.story);
        const read = story?.paragraph(paragraph.value.paragraphId);
        // A document Word never touched may carry no `w14:paraId`; empty text says "this
        // document does not write one" rather than inventing an identity the file lacks.
        return query({ kind: 'text', text: read?.paraId ?? '' });
      }

      case 'search': {
        const scope = resolveSpanRef(operation.scope, handles, packageReads);
        if (!scope.ok) return refuse(scope.code, 'that is not a scope to search', scope.detail);
        const story = storyOfSpanRef(operation.scope, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that is not a scope to search', story.detail);
        return searchScope(story.value, scope.value, operation.text, operation.options);
      }

      case 'insertText': {
        const at = resolvePoint(operation.at, handles, packageReads);
        if (!at.ok) return refuse(at.code, 'that is not a place to insert at', at.detail);
        const story = packageReads.story(at.value.story);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planInsertText(planFor(story), at.value, operation.text);
      }

      case 'replaceSpan': {
        // A SPAN OVER A WHOLE STORY IS A DIFFERENT OPERATION, and it is told apart by what the
        // caller NAMED rather than by comparing endpoints: `{ body }` means "all of it" — what
        // `Body.clear()` and `Body.insertText(…, 'Replace')` mean — and only that request may take
        // blocks out of the story. Two explicit endpoints that happen to reach both ends stay a
        // text edit, because a caller who addressed text asked for a text edit.
        if ('body' in operation.span) {
          const story = storyOfHandle(operation.span.body, 'body', handles, packageReads);
          if (!story.ok)
            return refuse(story.code, 'that handle does not name a body', story.detail);
          return planReplaceStory(planFor(story.value), operation.text);
        }
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse(
            'invalid-offset',
            'that story holds no paragraph to write into',
            'empty-story'
          );
        const story = storyReadsOf(resolved.value);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planReplaceSpan(planFor(story), resolved.value, operation.text);
      }

      case 'insertParagraph': {
        const anchor = resolveParagraphRef(operation.anchor, handles, packageReads);
        if (!anchor.ok)
          return refuse(anchor.code, 'that is not a paragraph to insert beside', anchor.detail);
        if (operation.where !== 'before' && operation.where !== 'after')
          return refuse(
            'unknown-operation',
            'that is not a place to insert',
            String(operation.where)
          );
        const story = packageReads.story(anchor.value.story);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planInsertParagraph(planFor(story), anchor.value, operation.where, operation.text);
      }

      case 'splitParagraph': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const story = packageReads.story(paragraph.value.story);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planSplitParagraph(
          planFor(story),
          paragraph.value,
          operation.delimiters,
          operation.trimDelimiters === true,
          operation.trimSpacing === true
        );
      }

      case 'getFont': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        const story = storyOfSpanRef(operation.span, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
        return query({
          kind: 'font',
          font: fontRead(story.value.part, spanOffsets(resolved.value, story.value)),
        });
      }

      case 'setFont': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse('invalid-offset', 'that story holds no paragraph to format', 'empty-story');
        const story = storyReadsOf(resolved.value);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planSetFont(planFor(story), resolved.value, operation.font);
      }

      case 'getStyle': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        const story = storyOfSpanRef(operation.span, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
        const part = story.value.part;
        const styles = story.value.styles();
        const names = spanParagraphIds(resolved.value, story.value).map((paragraphId) =>
          paragraphStyleName(part, paragraphId, styles)
        );
        // Agreement, same as a formatting read: one name if every paragraph the span covers states
        // it, and no answer where they differ or where the document names none.
        const agreed =
          names.length > 0 && names.every((name) => name !== null && name === names[0])
            ? (names[0] as string)
            : null;
        return query({ kind: 'style', name: agreed });
      }

      case 'setStyle': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse('invalid-offset', 'that story holds no paragraph to style', 'empty-story');
        const story = storyReadsOf(resolved.value);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planSetStyle(planFor(story), resolved.value, operation.name);
      }

      case 'getParagraphFormat': {
        const paragraph = resolveParagraphRef(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that is not a paragraph', paragraph.detail);
        const story = packageReads.story(paragraph.value.story);
        if (!story) return refuse('document-unavailable', 'this host holds no document right now');
        const format = paragraphFormatRead(story.part, paragraph.value.paragraphId, story.styles());
        if (!format) return refuse('invalid-handle', 'that handle does not name a paragraph');
        return query({ kind: 'paragraphFormat', format });
      }

      case 'setParagraphFormat': {
        const paragraph = resolveParagraphRef(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that is not a paragraph', paragraph.detail);
        const story = packageReads.story(paragraph.value.story);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planSetParagraphFormat(planFor(story), paragraph.value, operation.format);
      }

      case 'deleteParagraph': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const story = packageReads.story(paragraph.value.story);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planDeleteParagraph(planFor(story), paragraph.value);
      }

      case 'getSections': {
        if (!handles.resolve(operation.document, 'document'))
          return refuse('invalid-handle', 'that handle does not name a document', 'document');
        return query({
          kind: 'handles',
          handles: packageReads.sections().map((section) => handles.section(section.index)),
        });
      }

      case 'getPageSetup': {
        const target = handles.resolve(operation.section, 'section');
        if (!target || target.kind !== 'section')
          return refuse('invalid-handle', 'that handle does not name a section', 'section');
        const section = packageReads.sections()[target.index];
        if (!section) return refuse('invalid-handle', 'that section is not in this document');
        return query({ kind: 'pageSetup', setup: section.pageSetup });
      }

      case 'setPageSetup': {
        const target = handles.resolve(operation.section, 'section');
        if (!target || target.kind !== 'section')
          return refuse('invalid-handle', 'that handle does not name a section', 'section');
        return planSetPageSetup(target.index, operation.setup);
      }

      case 'getFurniture': {
        const target = handles.resolve(operation.section, 'section');
        if (!target || target.kind !== 'section')
          return refuse('invalid-handle', 'that handle does not name a section', 'section');
        if (operation.kind !== 'header' && operation.kind !== 'footer')
          return refuse('unknown-operation', 'that is not furniture', String(operation.kind));
        const story: AutomationStoryId = {
          kind: operation.kind,
          sectionIndex: target.index,
          variant: operation.variant,
        };
        // Validated as untrusted input BEFORE it is used to look a story up: `variant` arrives
        // from a caller, and a story id this lane will not act on must not become a handle.
        if (!isStoryId(story))
          return refuse(
            'unknown-operation',
            'that is not a furniture variant',
            String(operation.variant)
          );
        if (!packageReads.story(story))
          return refuse(
            'invalid-handle',
            'this document declares no such header or footer',
            storyKey(story)
          );
        return query({ kind: 'handle', handle: handles.body(story) });
      }

      case 'getNotes': {
        if (!handles.resolve(operation.document, 'document'))
          return refuse('invalid-handle', 'that handle does not name a document', 'document');
        if (operation.noteKind !== 'footnote' && operation.noteKind !== 'endnote')
          return refuse(
            'unknown-operation',
            'that is not a kind of note',
            String(operation.noteKind)
          );
        const kind = operation.noteKind;
        return query({
          kind: 'handles',
          handles: packageReads.noteIds(kind).map((noteId) => handles.note(kind, noteId)),
        });
      }

      case 'getNoteBody':
      case 'getNoteText': {
        const target = handles.resolve(operation.note, 'note');
        if (!target || target.kind !== 'note')
          return refuse('invalid-handle', 'that handle does not name a note', 'note');
        const story: AutomationStoryId = target;
        // A note DELETED since the handle was minted has no story, and saying so is the point:
        // answering empty text or a body would hide that the document lost it.
        const reads = packageReads.story(story);
        if (!reads)
          return refuse('invalid-handle', 'that note is not in this document', storyKey(story));
        return operation.op === 'getNoteText'
          ? query({ kind: 'text', text: reads.text() })
          : query({ kind: 'handle', handle: handles.body(story) });
      }

      case 'getNoteKind': {
        const target = handles.resolve(operation.note, 'note');
        if (!target || target.kind !== 'note')
          return refuse('invalid-handle', 'that handle does not name a note', 'note');
        return query({ kind: 'text', text: target.noteKind });
      }

      case 'deleteNote': {
        const target = handles.resolve(operation.note, 'note');
        if (!target || target.kind !== 'note')
          return refuse('invalid-handle', 'that handle does not name a note', 'note');
        if (!packageReads.noteIds(target.noteKind).includes(target.noteId))
          return refuse('invalid-handle', 'that note is not in this document');
        return planDeleteNote(target.noteKind, target.noteId);
      }

      case 'getLists': {
        const story = storyOfHandle(operation.body, 'body', handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that handle does not name a body', story.detail);
        return query({
          kind: 'handles',
          handles: listReads(story.value).map((list) =>
            handles.list(list.numId, story.value.story)
          ),
        });
      }

      case 'getListId': {
        const found = listOf(operation.list);
        if (!('list' in found)) return found;
        // Decimal by schema (`ST_DecimalNumber`), and validated as one before it is parsed: the
        // string came out of a file, and `Number('1e3')` is not the id anything wrote.
        return query({ kind: 'number', value: Number(found.list.numId) });
      }

      case 'getListById': {
        const story = storyOfHandle(operation.body, 'body', handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that handle does not name a body', story.detail);
        if (!Number.isInteger(operation.id) || operation.id <= 0)
          return refuse('unsupported-content', 'a list is numbered from one', String(operation.id));
        const wanted = String(operation.id);
        const found = listReads(story.value).find((list) => list.numId === wanted);
        if (!found)
          return refuse('invalid-handle', 'no list in that story carries that number', wanted);
        return query({ kind: 'handle', handle: handles.list(found.numId, story.value.story) });
      }

      case 'getListParagraphs': {
        const found = listOf(operation.list);
        if (!('list' in found)) return found;
        const level = operation.level;
        if (
          level !== undefined &&
          (!Number.isInteger(level) || level < 0 || level > MAX_LIST_LEVEL)
        ) {
          return refuse(
            'invalid-offset',
            `a list level is 0 to ${String(MAX_LIST_LEVEL)}`,
            String(level)
          );
        }
        const reads = found.plan.reads;
        const ids =
          level === undefined
            ? found.list.paragraphIds
            : found.list.paragraphIds.filter((id) => membershipIn(reads, id)?.level === level);
        return query({
          kind: 'handles',
          handles: ids.map((id) => handles.paragraph(id, reads.story)),
        });
      }

      case 'getParagraphList': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const reads = packageReads.story(paragraph.value.story);
        if (!reads) return refuse('invalid-handle', 'that story is not in this document');
        const membership = membershipIn(reads, paragraph.value.paragraphId);
        if (!membership)
          return refuse(
            'unsupported-content',
            'that paragraph is not in a list',
            paragraph.value.paragraphId
          );
        return query({
          kind: 'handle',
          handle: handles.list(membership.numId, reads.story),
        });
      }

      case 'getListLevel': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const reads = packageReads.story(paragraph.value.story);
        if (!reads) return refuse('invalid-handle', 'that story is not in this document');
        const membership = membershipIn(reads, paragraph.value.paragraphId);
        if (!membership)
          return refuse(
            'unsupported-content',
            'that paragraph is not in a list',
            paragraph.value.paragraphId
          );
        return query({ kind: 'number', value: membership.level });
      }

      case 'setListLevel': {
        const paragraph = resolveParagraphHandle(operation.paragraph, handles, packageReads);
        if (!paragraph.ok)
          return refuse(paragraph.code, 'that handle does not name a paragraph', paragraph.detail);
        const reads = packageReads.story(paragraph.value.story);
        if (!reads) return refuse('invalid-handle', 'that story is not in this document');
        return planSetListLevel(planFor(reads), paragraph.value.paragraphId, operation.level);
      }

      case 'insertListParagraph': {
        const found = listOf(operation.list);
        if (!('list' in found)) return found;
        return planInsertListParagraph(found.plan, found.list, operation.where, operation.text);
      }

      case 'getHyperlink': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        const story = storyOfSpanRef(operation.span, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
        const pkg = packageReads.package;
        if (!pkg || !resolved.value) return query({ kind: 'text', text: '' });
        const link = linkCovering(story.value, resolved.value);
        if (!link) return query({ kind: 'text', text: '' });
        const node = findNode(story.value.part, link.id);
        const target = node ? linkTarget(pkg, story.value.part.name, node) : null;
        return query({ kind: 'text', text: target ?? '' });
      }

      case 'setHyperlink': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse('invalid-offset', 'that story holds no text to link', 'empty-story');
        const story = storyReadsOf(resolved.value);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planSetHyperlink(planFor(story), resolved.value, operation.target);
      }

      case 'getBookmarks': {
        const resolved = resolveSpanRef(operation.scope, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        const story = storyOfSpanRef(operation.scope, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
        const reads = story.value;
        const scope = resolved.value;
        const covered = scope === null ? null : new Set(spanParagraphIds(scope, reads));
        const overlapping = bookmarkReads(reads).filter((bookmark) => {
          if (!covered) return false;
          // Overlap, not containment: a range that starts inside a bookmark and ends past it has
          // that bookmark, which is what Word's own range collection answers.
          if (!covered.has(bookmark.start.paragraphId) && !covered.has(bookmark.end.paragraphId))
            return false;
          if (scope === null) return false;
          const startsAfter =
            bookmark.start.paragraphId === scope.end.paragraphId &&
            bookmark.start.offset > scope.end.offset;
          const endsBefore =
            bookmark.end.paragraphId === scope.start.paragraphId &&
            bookmark.end.offset < scope.start.offset;
          return !startsAfter && !endsBefore;
        });
        return query({
          kind: 'handles',
          handles: overlapping.map((bookmark) => handles.bookmark(bookmark.name, reads.story)),
        });
      }

      case 'getBookmarkName': {
        const target = handles.resolve(operation.bookmark, 'bookmark');
        if (!target || target.kind !== 'bookmark')
          return refuse('invalid-handle', 'that handle does not name a bookmark', 'bookmark');
        return query({ kind: 'text', text: target.name });
      }

      case 'getBookmarkRange': {
        const found = resolveBookmarkRange(operation.bookmark);
        if (!('reads' in found)) return found;
        return query({ kind: 'span', span: spanOf(found.range) });
      }

      case 'getComments': {
        const scope = resolveSpanRef(operation.scope, handles, packageReads);
        if (!scope.ok) return refuse(scope.code, 'that scope is not a place', scope.detail);
        const story = storyOfSpanRef(operation.scope, handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that scope names no story', story.detail);
        const reads = story.value;
        const comments = commentsOf(reads);
        if (!comments) return refuse('document-unavailable', 'this host holds no document');
        // A SCOPE NARROWS: a whole-story ask answers every top-level comment, a span answers the
        // ones whose words it overlaps, so `Range#getComments` is not the body's list again.
        const covering = scope.value;
        const roots = comments.roots.filter((item) => {
          if (!covering) return true;
          const range = item.range;
          if (!range) return false;
          const from = reads.indexOf(range.start.paragraphId);
          const to = reads.indexOf(range.end.paragraphId);
          const low = reads.indexOf(covering.start.paragraphId);
          const high = reads.indexOf(covering.end.paragraphId);
          if (to < low || from > high) return false;
          if (to === low && from === low && high === low) {
            return (
              range.end.offset > covering.start.offset && range.start.offset < covering.end.offset
            );
          }
          return true;
        });
        return query({
          kind: 'handles',
          handles: roots.map((item) => handles.comment(item.id, reads.story)),
        });
      }

      case 'getCommentReplies': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return query({
          kind: 'handles',
          handles: found.item.replyIds.map((id) => handles.comment(id, found.reads.story)),
        });
      }

      case 'getCommentId': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return query({ kind: 'text', text: found.item.id });
      }

      case 'getCommentAuthor': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return query({ kind: 'text', text: found.item.comment.author });
      }

      case 'getCommentDate': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return query({ kind: 'text', text: found.item.comment.date ?? '' });
      }

      case 'getCommentText': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        const comments = commentsOf(found.reads);
        return query({ kind: 'text', text: comments?.textOf(found.item.id) ?? '' });
      }

      case 'getCommentRange': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        const range = found.item.range;
        // ORPHANED IS NOT A PLACE. A file can reference a comment with no usable range, and
        // answering the story's start would put a caller's edit somewhere nobody commented on.
        if (!range || found.item.orphaned)
          return refuse('invalid-handle', 'that comment has no range in this document');
        const span = spanOfReviewRange(found.reads, range);
        if (!span)
          return refuse('invalid-handle', 'that comment’s range is no longer in the story');
        return query({ kind: 'span', span });
      }

      case 'getCommentResolved': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return query({ kind: 'flag', value: found.item.resolved });
      }

      case 'insertComment':
        return planInsertComment(operation, handles, packageReads, pinCommentStory);

      case 'setCommentResolved': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        if (typeof operation.resolved !== 'boolean')
          return refuse(
            'unsupported-content',
            'resolved is a yes or a no',
            String(operation.resolved)
          );
        const conflict = pinWrite(planFor(found.reads));
        if (conflict) return conflict;
        return {
          ok: true,
          kind: 'commentWrite',
          write: { kind: 'resolve', commentId: found.item.id, resolved: operation.resolved },
          story: found.reads.story,
          answer: () => APPLIED,
        };
      }

      case 'replyToComment': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        const fields = validatePlannedCommentFields({
          author: operation.author,
          text: operation.text,
          date: operation.date,
          kind: 'reply',
        });
        if (fields) return fields;
        const range = found.item.range;
        if (!range || found.item.orphaned)
          return refuse('invalid-handle', 'that comment has no range to reply over');
        const conflict = pinWrite(planFor(found.reads));
        if (conflict) return conflict;
        const story = found.reads.story;
        const date = stagedCommentDate(operation.date);
        return {
          ok: true,
          kind: 'commentWrite',
          write: {
            kind: 'reply',
            parentCommentId: found.item.id,
            anchor: {
              paragraphId: range.start.paragraphId,
              start: range.start.offset,
              end: range.end.offset,
              ...(range.end.paragraphId === range.start.paragraphId
                ? {}
                : { endParagraphId: range.end.paragraphId }),
            },
            text: operation.text,
            author: operation.author,
            ...(date === undefined ? {} : { date }),
          },
          story: found.reads.story,
          answer: (_post, commentId) =>
            commentId === undefined
              ? APPLIED
              : { kind: 'handle', handle: handles.comment(commentId, story) },
        };
      }

      case 'deleteComment': {
        const found = commentAt(operation.comment);
        if (!found.ok) return found.planned;
        return planDeleteComment(found.item, found.reads, (reads) => pinWrite(planFor(reads)));
      }

      case 'getRevisions': {
        const story = storyOfHandle(operation.body, 'body', handles, packageReads);
        if (!story.ok) return refuse(story.code, 'that handle does not name a body', story.detail);
        const reads = story.value;
        return query({
          kind: 'handles',
          handles: revisionReads(reads).map((item) => handles.revision(item.id, reads.story)),
        });
      }

      case 'getRevisionType': {
        const found = revisionAt(operation.revision);
        if (!found.ok) return found.planned;
        return query({ kind: 'text', text: found.item.type });
      }

      case 'getRevisionAuthor': {
        const found = revisionAt(operation.revision);
        if (!found.ok) return found.planned;
        return query({ kind: 'text', text: found.item.author });
      }

      case 'getRevisionDate': {
        const found = revisionAt(operation.revision);
        if (!found.ok) return found.planned;
        return query({ kind: 'text', text: found.item.date });
      }

      case 'getRevisionRange': {
        const found = revisionAt(operation.revision);
        if (!found.ok) return found.planned;
        const [first] = found.item.item.ranges;
        if (!first) return refuse('invalid-handle', 'that change covers no characters');
        const span = spanOfReviewRange(found.reads, first);
        if (!span) return refuse('invalid-handle', 'that change’s range is no longer in the story');
        return query({ kind: 'span', span });
      }

      case 'acceptRevision':
      case 'rejectRevision': {
        const found = revisionAt(operation.revision);
        if (!found.ok) return found.planned;
        const plan = planFor(found.reads);
        const conflict = pinWrite(plan);
        if (conflict) return conflict;
        // EVERY ADDRESS THE DECISION COVERS, in one transaction — a replacement written as two
        // revisions is one decision, and resolving half of it is a state no reviewer asked for.
        const accept = operation.op === 'acceptRevision';
        return {
          ok: true,
          kind: 'command',
          story: found.reads.story,
          ops: found.item.item.addresses.map((address) =>
            accept
              ? ({ op: 'acceptRevision', revision: address } as const)
              : ({ op: 'rejectRevision', revision: address } as const)
          ),
          answer: () => APPLIED,
        };
      }

      case 'acceptAllRevisions':
      case 'rejectAllRevisions': {
        const target = revisionDecisionTarget(operation, handles, packageReads);
        if (!target.ok) return refuse(target.code, target.message, target.detail);
        const plan = planFor(target.reads);
        const conflict = pinWrite(plan);
        if (conflict) return conflict;
        const ops = revisionCollectionOps(operation, target.reads, target.storyScoped);
        if (!ops) {
          return refuse(
            'unsupported-revision',
            'that story contains a tracked change this engine cannot resolve'
          );
        }
        return {
          ok: true,
          kind: 'command',
          story: target.reads.story,
          ops,
          answer: () => APPLIED,
        };
      }

      case 'selectSpan': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse('invalid-offset', 'that story holds no paragraph to select', 'empty-story');
        const story = storyReadsOf(resolved.value);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        return planSelect(planFor(story), resolved.value, operation.mode);
      }

      case 'selectBookmark': {
        const found = resolveBookmarkRange(operation.bookmark);
        if (!('reads' in found)) return found;
        return planSelect(planFor(found.reads), found.range, operation.mode);
      }

      case 'getContentControls': {
        const scope = controlScope(operation.scope);
        if (!('reads' in scope)) return scope;
        return query({
          kind: 'handles',
          handles: contentControlReads(scope.reads, scope.node).map((control) =>
            handles.contentControl(control.nodeId, scope.reads.story)
          ),
        });
      }

      case 'getContentControlById': {
        const scope = controlScope(operation.scope);
        if (!('reads' in scope)) return scope;
        if (!Number.isInteger(operation.id)) {
          return refuse(
            'unsupported-content',
            'a control id is a whole number',
            String(operation.id)
          );
        }
        // Document order over the WHOLE scope subtree, nested controls included: an id lookup is
        // a search of what the file wrote, and Word's own numbering is not scoped to a nesting
        // level. The first match wins because `w:id` is not unique.
        const found = allControlsUnder(scope.node).find(
          (control) => contentControlPropertiesOf(control).id === operation.id
        );
        if (!found) {
          // `invalid-handle`, the same code a bookmark the document stopped declaring answers: the
          // caller named an object this document does not have. A second code for "looked up by a
          // file attribute rather than by a handle" would be a distinction without a caller.
          return refuse(
            'invalid-handle',
            'no control in that scope carries that id',
            String(operation.id)
          );
        }
        return query({
          kind: 'handle',
          handle: handles.contentControl(found.id, scope.reads.story),
        });
      }

      case 'getContentControlsByTag':
      case 'getContentControlsByTitle': {
        const scope = controlScope(operation.scope);
        if (!('reads' in scope)) return scope;
        const wanted = operation.op === 'getContentControlsByTag' ? operation.tag : operation.title;
        if (typeof wanted !== 'string' || wanted.length === 0) {
          return refuse('unsupported-content', 'a tag or title to match is required', operation.op);
        }
        const matches = allControlsUnder(scope.node).filter((control) => {
          const properties = contentControlPropertiesOf(control);
          return operation.op === 'getContentControlsByTag'
            ? properties.tag === wanted
            : properties.alias === wanted;
        });
        return query({
          kind: 'handles',
          handles: matches.map((control) => handles.contentControl(control.id, scope.reads.story)),
        });
      }

      case 'getContentControlTag':
      case 'getContentControlTitle':
      case 'getContentControlFileId':
      case 'getContentControlSubtype':
      case 'getContentControlLock': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        const properties = found.control.properties;
        if (operation.op === 'getContentControlLock') {
          return query({ kind: 'text', text: found.control.lock });
        }
        if (operation.op === 'getContentControlSubtype') {
          return query({ kind: 'text', text: properties.type });
        }
        if (operation.op === 'getContentControlFileId') {
          // A STRING, and empty for a control the file never numbered — the identity a caller
          // holds is the handle, so an absent `w:id` is a missing label rather than an error.
          return query({
            kind: 'text',
            text: properties.id === undefined ? '' : String(properties.id),
          });
        }
        const text = operation.op === 'getContentControlTag' ? properties.tag : properties.alias;
        return query({ kind: 'text', text: text ?? '' });
      }

      case 'getContentControlIsBound':
      case 'getContentControlPlaceholderShown':
      case 'getContentControlTemporary': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        const value =
          operation.op === 'getContentControlIsBound'
            ? found.control.properties.dataBinding !== undefined
            : operation.op === 'getContentControlPlaceholderShown'
              ? found.control.properties.showingPlaceholder
              : found.control.properties.temporary;
        return query({ kind: 'flag', value });
      }

      case 'getContentControlText': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        return query({ kind: 'text', text: contentControlText(found.node) });
      }

      case 'getContentControlParagraphs': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        return query({
          kind: 'handles',
          handles: found.control.paragraphIds.map((id) => handles.paragraph(id, found.reads.story)),
        });
      }

      case 'getContentControlRange': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        const location = operation.location ?? 'whole';
        if (!CONTENT_CONTROL_RANGE_LOCATIONS.has(location)) {
          return refuse('unsupported-content', 'that is not a place in a control', location);
        }
        const span = contentControlSpan(found.reads, found.node);
        if (!span) {
          return refuse('unsupported-content', 'that control holds nothing addressable', 'empty');
        }
        // `before`/`start` and `after`/`end` land on the same point on purpose: the control's
        // boundary marks take no offset, so there is no position outside the content to answer.
        const edge = location === 'start' || location === 'before' ? span.start : span.end;
        const collapsed = location !== 'whole' && location !== 'content';
        const point = (at: { readonly paragraphId: string; readonly offset: number }) => ({
          story: found.reads.story,
          paragraphId: at.paragraphId,
          index: found.reads.indexOf(at.paragraphId),
          offset: at.offset,
        });
        return query({
          kind: 'span',
          span: spanValue(
            collapsed
              ? { start: point(edge), end: point(edge) }
              : { start: point(span.start), end: point(span.end) },
            handles
          ),
        });
      }

      case 'setContentControlValue': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        const value = contentControlValueOf(operation.value);
        if (!value.ok) return refuse(value.code, value.message, value.detail);
        const plan = planFor(found.reads);
        const pin = pinWrite(plan);
        if (pin) return pin;
        return {
          ok: true,
          kind: 'command',
          story: found.reads.story,
          ops: [
            { op: 'setContentControlValue', controlId: found.control.nodeId, value: value.value },
          ],
          answer: () => APPLIED,
        };
      }

      case 'setContentControlProperties': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        if (
          operation.tag === undefined &&
          operation.title === undefined &&
          operation.lock === undefined
        ) {
          return refuse('unsupported-content', 'nothing to write', 'no-properties');
        }
        if (operation.lock !== undefined && !CONTENT_CONTROL_LOCKS.has(operation.lock)) {
          return refuse(
            'unsupported-content',
            'that is not a lock this schema declares',
            operation.lock
          );
        }
        const plan = planFor(found.reads);
        const pin = pinWrite(plan);
        if (pin) return pin;
        return {
          ok: true,
          kind: 'command',
          story: found.reads.story,
          ops: [
            {
              op: 'setContentControlProperties',
              controlId: found.control.nodeId,
              ...(operation.tag === undefined ? {} : { tag: operation.tag }),
              // `title` in the object model is `w:alias` in the file. One name each side, and the
              // translation happens here rather than leaking Word's UI wording into the tree.
              ...(operation.title === undefined ? {} : { alias: operation.title }),
              ...(operation.lock === undefined ? {} : { lock: operation.lock }),
            },
          ],
          answer: () => APPLIED,
        };
      }

      case 'insertContentControlText': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        if (typeof operation.text !== 'string') {
          return refuse('unsupported-content', 'text is required', 'text');
        }
        if (operation.at !== 'replace' && operation.at !== 'start' && operation.at !== 'end') {
          return refuse(
            'unsupported-content',
            'that is not a place to insert at',
            String(operation.at)
          );
        }
        const plan = planFor(found.reads);
        const pin = pinWrite(plan);
        if (pin) return pin;
        const span = contentControlSpan(found.reads, found.node);
        if (!span) {
          return refuse('unsupported-content', 'that control holds nothing addressable', 'empty');
        }
        // WHERE THE WRITTEN TEXT WILL BE, answered by the command itself rather than by a read
        // beside it: reads are planned against the document as it is now, so a read enqueued after
        // this write would answer the span the control had BEFORE it. `replace` puts the whole
        // value in the content's first paragraph, which keeps its identity across the write.
        const at = operation.at === 'end' ? span.end : span.start;
        const written = (): AutomationValue => ({
          kind: 'span',
          span: spanOf({
            start: {
              story: found.reads.story,
              paragraphId: at.paragraphId,
              index: found.reads.indexOf(at.paragraphId),
              offset: at.offset,
            },
            end: {
              story: found.reads.story,
              paragraphId: at.paragraphId,
              index: found.reads.indexOf(at.paragraphId),
              offset: at.offset + operation.text.length,
            },
          }),
        });
        // `replace` is the control's own value path, so the prompt and `w:temporary` are dealt
        // with there rather than twice. The edges are ordinary insertions at the ends of the
        // content: the lock the control carries refuses them as it refuses a keystroke.
        if (operation.at === 'replace') {
          return {
            ok: true,
            kind: 'command',
            story: found.reads.story,
            ops: [
              {
                op: 'setContentControlValue',
                controlId: found.control.nodeId,
                value: { kind: 'text', text: operation.text },
              },
            ],
            answer: written,
          };
        }
        return {
          ok: true,
          kind: 'command',
          story: found.reads.story,
          ops:
            operation.text.length === 0
              ? []
              : [
                  {
                    op: 'insertText',
                    paragraphId: at.paragraphId,
                    offset: at.offset,
                    text: operation.text,
                    // THE TEXT GOES IN THE CONTROL, which the offset alone cannot say: a boundary
                    // offset belongs to the run that starts there, so an inline control's
                    // trailing edge is the text AFTER the control and the command would have
                    // written beside the field it was handed.
                    inside: found.node.id,
                  },
                ],
          answer: written,
        };
      }

      case 'deleteContentControl': {
        const found = controlOf(operation.contentControl);
        if (!('control' in found)) return found;
        if (typeof operation.keepContent !== 'boolean') {
          return refuse('unsupported-content', 'keepContent is required', 'keepContent');
        }
        const plan = planFor(found.reads);
        const pin = pinWrite(plan);
        if (pin) return pin;
        return {
          ok: true,
          kind: 'command',
          story: found.reads.story,
          ops: [
            {
              op: 'removeContentControl',
              controlId: found.control.nodeId,
              keepContent: operation.keepContent,
            },
          ],
          answer: () => APPLIED,
        };
      }

      case 'insertContentControl': {
        const resolved = resolveSpanRef(operation.span, handles, packageReads);
        if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
        if (!resolved.value)
          return refuse('invalid-offset', 'that story holds nothing to wrap', 'empty-story');
        const story = storyReadsOf(resolved.value);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        const range = resolved.value;
        // ONE PARAGRAPH: a control that starts in one paragraph and ends in another is a BLOCK
        // control over both, which is a different wrapper than the inline one this operation
        // authors. Refused rather than guessed, so a caller learns which they asked for.
        if (range.start.paragraphId !== range.end.paragraphId) {
          return refuse(
            'unsupported-content',
            'wrapping several paragraphs in one control is not supported here',
            'multi-paragraph'
          );
        }
        if (!CONTENT_CONTROL_SUBTYPES.has(operation.subtype)) {
          return refuse(
            'unsupported-content',
            'that control type cannot be inserted',
            operation.subtype
          );
        }
        const plan = planFor(story);
        const pin = pinWrite(plan);
        if (pin) return pin;
        return {
          ok: true,
          kind: 'command',
          story: story.story,
          ops: [
            {
              op: 'insertContentControl',
              paragraphId: range.start.paragraphId,
              start: range.start.offset,
              end: range.end.offset,
              type: operation.subtype,
              ...(operation.tag === undefined ? {} : { tag: operation.tag }),
              ...(operation.title === undefined ? {} : { alias: operation.title }),
            },
          ],
          answer: () => APPLIED,
        };
      }

      case 'insertCustomNode': {
        // Everything that can be judged from the request alone, before a handle is resolved.
        const shape = customNodeRequestRefusal(operation);
        if (shape) return refuse('unsupported-content', shape.message, shape.detail);
        const payload = customNodePayloadOf(operation.payload);
        if (!payload.ok) {
          return refuse('unsupported-content', 'that payload cannot be written', payload.field);
        }

        const placed = customNodePlacement(operation, handles, packageReads);
        if ('code' in placed) return refuse(placed.code, placed.message, placed.detail);
        const { start, end } = placed.range;
        const story = storyReadsOf(placed.range);
        if (!story) return refuse('invalid-handle', 'that story is not in this document');
        const conflict = pinWrite(planFor(story));
        if (conflict) return conflict;
        return {
          ok: true,
          kind: 'customNodeWrite',
          story: story.story,
          write: customNodeWriteOf(operation, start, end, payload.value),
          answer: () => APPLIED,
        };
      }

      default: {
        const unknown = operation as { readonly op?: unknown };
        return refuse(
          'unknown-operation',
          'this host does not implement that operation',
          String(unknown.op)
        );
      }
    }
  };

  return {
    plan(operation) {
      const conflict = commandPolicy.conflict(operation);
      if (conflict) return refuse('conflicting-operations', conflict.message, conflict.detail);
      const planned = plan(operation);
      if (planned.ok) commandPolicy.note(operation);
      return planned;
    },
    get hasCommands() {
      return commandPolicy.hasCommands;
    },
    get writeScope() {
      return writeStory?.reads.scope ?? null;
    },
    settle(post) {
      // ONE story settles: a batch's commands are pinned to one story, so only that story can
      // have created paragraphs. A read-only batch has nothing to bind at all.
      const pinned = writeStory;
      if (pinned) {
        const after = post.story(pinned.reads.story);
        if (!after) {
          return {
            ok: false,
            detail: `the story this batch wrote is gone: ${storyKey(pinned.reads.story)}`,
          };
        }
        const before = new Set(pinned.reads.paragraphIds);
        const fresh = after.paragraphIds.filter((id) => !before.has(id));
        if (fresh.length !== pinned.created.length) {
          return {
            ok: false,
            detail: `planned ${String(pinned.created.length)} new paragraphs, the transaction made ${String(fresh.length)}`,
          };
        }
        // Reading order on both sides: `created` is ordered by the symbolic story position each
        // slot was inserted at, and `fresh` by where the paragraphs actually landed.
        const inOrder = pinned.order.filter((slot) => slot.id === null);
        inOrder.forEach((slot, index) => {
          slot.id = fresh[index] ?? null;
        });
        for (const retarget of pinned.retargets) {
          if (retarget.slot.id) handles.retarget(retarget.from, retarget.slot.id);
        }
      }
      // LAST GATE BEFORE A CARET MOVES. Planning already refuses a batch that selects a paragraph
      // it also changes, so a selection reaching here should describe the committed document
      // exactly. "Should" is the reason for the check: if it does not — a planner bug, an op with
      // an effect this file did not model — the right outcome is that no caret moves, not that one
      // moves to a position that has stopped meaning what it meant.
      for (const selection of selections) {
        const story = post.story(selection.range.start.story);
        if (!story || !placeable(selection.range, story)) continue;
        host.select?.(selection.range, selection.mode);
      }
      return { ok: true };
    },
  };
}
