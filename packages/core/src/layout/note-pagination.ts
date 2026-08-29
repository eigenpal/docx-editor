/* eslint-disable max-lines -- note pagination seam: reservation, continuation, overflow pages */

// Footnote / endnote pagination: reservation, split/continuation, sect/doc end collection.
//
// Body flow places references; this module lays referenced notes at content width, reserves
// separator+note area (pageBottom / beneathText), bounds the reflow loop, and attaches
// layout-owned note records. Endnotes reserve nothing on reference pages — they collect at
// sectEnd / docEnd. Hostile counts and oscillation fail closed with named reasons.

import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { fragmentOwnsPosition, fragmentParagraphs, lineSegments } from './line-segments.ts';
import { collectNoteReferences } from '../store/package/note-references.ts';
import type { DocumentSection } from './section-properties.ts';
import { storyBlocks } from './story-roots.ts';
import {
  customMarkFollows,
  formatNoteScopeId,
  noteIdOf,
  noteReferenceKindOf,
  type NoteKind,
} from '../store/package/note-nodes.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  type FootnotePosition,
  type ResolvedEndnoteProperties,
  type ResolvedFootnoteProperties,
} from '../store/package/note-properties.ts';
import { formatNumFmt } from './numbering-format.ts';
import {
  deriveNoteDisplayMarksResolved,
  noteDisplayMarkMap,
  type NoteReferenceSite,
} from './note-numbering.ts';
import {
  layoutNoteById,
  layoutNoteSeparator,
  noteSeparatorAreaBox,
  MAX_NOTES_LAID_OUT,
  MAX_NOTE_FRAGMENTS,
  type NoteLayoutFallbackReason,
  type NoteSeparatorLayout,
  type NoteStoryDrawings,
  type NoteStoryLayout,
  type LayoutNoteStoryOptions,
} from './note-layout.ts';
import { noteMarkKey, type NoteMarkContext } from './note-projection.ts';
import {
  compactFootnoteReserves,
  footnoteReservesEqual,
  footnoteReservesFingerprint,
  growFootnoteReserves,
  notesReserveContextKey,
} from './note-reserves.ts';
export { notesReserveContextKey };
import {
  fragmentFlowBottom,
  noteReferenceLineBandPt,
  shiftFragments,
  type NoteReferenceLineBand,
} from './note-fragment-geometry.ts';
import { reindexAndRestackPages } from './page-restacking.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  LayoutBox,
  NoteAreaRecord,
  NoteStoryRecord,
  PageNoteStream,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  StyleSpanRecord,
  TextMeasurer,
} from './semantic-records.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './paragraph-flow.ts';
import { cascadeRunProperties, type StyleCascadeTable } from './style-cascade.ts';
import { DEFAULT_RUN_STYLE, resolveRunStyle, type ResolvedRunStyle } from './run-style.ts';
import { finalizePageFieldProjection } from './field-projection.ts';
import { overflowPageShellAt, type OverflowPageShell } from './page-furniture-insets.ts';
import { DEFAULT_REVISION_DISPLAY_MODE, type RevisionDisplayMode } from './revision-projection.ts';

/**
 * Bound on reflow attempts per document layout pass.
 *
 * Sized for a COLD OPEN of a reference-dense document: adoption is a forward fixed-point
 * iteration whose settled prefix extends a few pages per round, so a legal document with a
 * hundred footnotes converges in tens of rounds (a 53-page/108-note fixture took 24), and
 * a round over a settled prefix is nearly free (checkpointed body layout + per-page
 * reserve memos). Orbits exit earlier through the fingerprint/envelope checks below, so
 * the cap is a safety bound, not the expected cost.
 */
export const MAX_NOTE_REFLOW_ATTEMPTS = 64;

/**
 * Total reserve-map adoptions allowed per BODY-PART identity, across passes.
 *
 * One pass is capped at {@link MAX_NOTE_REFLOW_ATTEMPTS}; session-seeded passes continue
 * the same iteration, so a reference-dense document converges across a few passes instead
 * of restarting. Some documents have no fixed point at all — the map's own body shifts move
 * references across page boundaries and the iteration orbits a short cycle — so the search
 * must also END: once this budget is spent, the memo records the answer and every later
 * pass over the same part reproduces it, instead of flapping an unchanged document between
 * the orbit's page counts forever. An edit replaces the part and restarts the search.
 */
const MAX_NOTE_REFLOW_ADOPTIONS_PER_STATE = 3 * MAX_NOTE_REFLOW_ATTEMPTS;

/** Cap on total note story fragments attached across the document. */
export const MAX_NOTE_AREA_FRAGMENTS = 4_096;

/** Cap on empty pages created solely to drain footnote/endnote overflow. */
export const MAX_NOTE_OVERFLOW_PAGES = 256;

/** One document-wide allowance shared by every footnote/endnote overflow stream. */
interface NoteOverflowBudget {
  remaining: number;
}

/**
 * Minimum body band (points) retained when computing footnote bottom reserves.
 *
 * Reserving the full content column would shrink body flow to 1pt and chase blank
 * sheets as every reference line fails to land. Oversized notes split/continue into
 * the shared overflow budget instead of evacuating the referencing page.
 */
const MIN_FOOTNOTE_BODY_BAND_PT = 14;

/**
 * Half-point back-off applied to reserves derived from an observed line boundary (eviction,
 * hold-out), so the body budget falls mid-line instead of edge-to-edge on a kept line's
 * exact bottom, where the body pass's strict fit compare flips on float drift.
 */
const RESERVE_BOUNDARY_BACKOFF_PT = 0.5;

/** One document-wide allowance shared by every footnote/endnote overflow stream. */
interface NoteOverflowBudget {
  remaining: number;
}

/**
 * Cap on synthetic eachPage mark candidates measured per section (plus actual marks).
 *
 * eachPage sequences restart every page, so a page almost never carries more than a
 * handful of auto-numbered notes. Measuring `numStart .. numStart + N - 1` covers
 * single→double digit decimal growth and typical roman width peaks (e.g. `viii` vs `ix`)
 * without scanning hostile `numStart` ranges unboundedly. Derived marks already assigned
 * for the pass are always included in addition to this window.
 */
export const MAX_EACH_PAGE_MARK_CANDIDATES = 12;

/**
 * Why note PAGINATION fell back, widening {@link NoteLayoutFallbackReason} with the reasons that
 * only arise while distributing notes across pages.
 */
export type NotePaginationFallbackReason =
  | NoteLayoutFallbackReason
  | 'note-reflow-exhausted'
  | 'note-area-fragment-limit'
  | 'note-overflow-page-limit'
  /**
   * Overflow/drain iteration placed zero note stories while carry/pending remained —
   * abort rather than minting blank separator-only sheets up to the page budget.
   */
  | 'note-overflow-stalled'
  /** A single note line exceeds the full content column; content is not placed overflowing. */
  | 'note-line-exceeds-page';

/**
 * Everything note pagination needs: the note parts, and the per-section properties governing
 * them.
 *
 * Per-SECTION because numbering, restart rules and placement are all section properties — one
 * document can restart footnote numbering at every section and end notes at the document end.
 */
export interface NotesLayoutInput {
  readonly footnotesPart: OoxmlPart | null;
  readonly endnotesPart: OoxmlPart | null;
  /** Per-section resolved footnote properties (index-aligned with document sections). */
  readonly footnotePropsBySection: readonly ResolvedFootnoteProperties[];
  /** Per-section resolved endnote properties. */
  readonly endnotePropsBySection: readonly ResolvedEndnoteProperties[];
  /** Document-level defaults (section 0 fallback). */
  readonly documentFootnoteProps: ResolvedFootnoteProperties;
  readonly documentEndnoteProps: ResolvedEndnoteProperties;
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]>;
  readonly styleCascade?: StyleCascadeTable;
  /** `numbering.xml`, so a `w:numPr` paragraph inside a note resolves a marker. */
  readonly numberingIndex?: import('./numbering-index.ts').NumberingIndex;
  readonly defaultTabStopPt?: number;
  /**
   * Link projector seams, same as the body walk's. Normally injected by `semantic-layout`
   * from its own options, so a note's `w:hyperlink` / HYPERLINK field carries the same
   * sanitized record a body one does instead of painting dead text.
   */
  readonly projectLink?: import('./field-pieces.ts').HyperlinkProjector;
  readonly projectFieldLink?: import('./field-pieces.ts').FieldLinkProjector;
  /** Document properties for a document-property field inside a note story. */
  readonly documentProperties?: import('@docx-editor.dev/core/store').DocumentProperties;
  /**
   * The document's resolved REF inputs, so a footnote's cross-reference paints the live
   * value the body paints. Normally injected by `semantic-layout` from the context it built
   * over the body and note stories; its values token joins the notes-pass fingerprint so a
   * renumbering edit repaints the notes that cite the renumbered target.
   */
  readonly refFields?: import('./field-ref.ts').RefFieldContext;
  /**
   * Inline drawing support per notes part. Absent means note paragraphs flow without
   * drawing records, which is what a headless caller with no image port wants.
   */
  readonly drawingsForPart?: (ownerPartName: string) => NoteStoryDrawings | undefined;
  /**
   * Part-level drawing epoch covering the notes parts, standing in for
   * {@link drawingsForPart}'s closure in the notes-pass memo (the closure is rebuilt per
   * pass, so only an epoch can say "the drawing state did not move"). A caller that
   * supplies `drawingsForPart` without this keeps the rebuild path.
   */
  readonly drawingLayoutEpoch?: string;
}

// ---------------------------------------------------------------------------------------
// Notes-pass memo (session-carried)
// ---------------------------------------------------------------------------------------

interface NotesPageAttachEntry {
  readonly allHits: readonly PageRefHit[];
  readonly marks: NoteMarkContext;
  readonly attached: PageRecord;
  readonly reserve: number;
  readonly reasons: readonly NotePaginationFallbackReason[];
}

/**
 * Incremental state for the notes pass, carried on the layout session's opaque `notes`
 * slot. Validity is layered: the memo object itself is replaced whenever the reference
 * fingerprint or the notes-input fingerprint moves, so anything read THROUGH a live memo
 * (the hit array, the mark contexts, per-page results keyed by identical hit/mark
 * identities) is current by construction.
 */
interface NotesPassMemo {
  readonly hitsFingerprint: string;
  readonly inputFingerprint: string;
  readonly allHits: readonly PageRefHit[];
  readonly provisionalMarks: NoteMarkContext;
  finalMarks: { readonly sitesFingerprint: string; readonly marks: NoteMarkContext } | null;
  /**
   * The reserve answer the reflow settled on for one body-part identity.
   *
   * Recorded when a pass converges, when it ends without adopting a new map, or when the
   * cross-pass adoption budget ({@link MAX_NOTE_REFLOW_ADOPTIONS_PER_STATE}) is spent. A
   * later pass over the SAME part seeded with this exact map skips the reflow loop and
   * republishes — the loop exists to find reserves for a new document state, and re-running
   * it on an unchanged one can only flap a fixed-point-free document between the page
   * counts of its orbit. An edit replaces the part, which invalidates this by identity.
   */
  settledReserves: {
    readonly part: OoxmlPart;
    readonly fingerprint: string;
    readonly reasons: readonly NotePaginationFallbackReason[];
  } | null;
  /** Reserve-map adoptions spent on the current body-part identity (budget above). */
  reflowSpent: { readonly part: OoxmlPart; adopted: number } | null;
  readonly pageAttach: WeakMap<PageRecord, NotesPageAttachEntry>;
  readonly pageReserve: WeakMap<
    PageRecord,
    {
      readonly allHits: readonly PageRefHit[];
      readonly marks: NoteMarkContext;
      readonly reserve: number;
      readonly reasons: readonly NotePaginationFallbackReason[];
      /**
       * The NEXT page's fragments at compute time (null = no next page). The hold-out
       * check reads the next page's first line, so a reserve computed against one
       * neighbour must not answer for another.
       */
      readonly nextFragments: readonly BlockFragmentRecord[] | null;
    }
  >;
}

function fingerprintHits(hits: readonly PageRefHit[]): string {
  const parts: string[] = [];
  for (const hit of hits) {
    parts.push(
      `${hit.noteKind}|${hit.noteId}|${hit.paragraphId}|${hit.atomOffset}|${hit.customMarkFollows ? 1 : 0}|${hit.sectionIndex}`
    );
  }
  return parts.join(';');
}

function fingerprintNoteProps(props: {
  readonly pos: string;
  readonly numFmt: string;
  readonly numStart: number;
  readonly numRestart: string;
}): string {
  return `${props.pos},${props.numFmt},${props.numStart},${props.numRestart}`;
}

/**
 * Content fingerprint of the notes input, paired with the IDENTITY checks a string cannot
 * carry (parts, measurer, cache, cascade). Answers null when the input cannot be
 * fingerprinted safely — drawings threaded without an epoch — which disables the memo.
 */
function fingerprintNotesInput(input: NotesLayoutInput): string | null {
  if (input.drawingsForPart !== undefined && input.drawingLayoutEpoch === undefined) return null;
  return [
    input.producer,
    input.defaultTabStopPt ?? '',
    input.drawingLayoutEpoch ?? '',
    // By CONTENT, not identity: a keystroke rebuilds the context object while every
    // resolved value stands still, and only a value move should invalidate the memo.
    input.refFields?.valuesToken ?? '',
    fingerprintNoteProps(input.documentFootnoteProps),
    fingerprintNoteProps(input.documentEndnoteProps),
    input.footnotePropsBySection.map(fingerprintNoteProps).join(';'),
    input.endnotePropsBySection.map(fingerprintNoteProps).join(';'),
  ].join('\0');
}

/** Identity fields the fingerprint cannot express; compared against the previous input. */
const notesInputIdentities = new WeakMap<
  NotesPassMemo,
  {
    readonly footnotesPart: OoxmlPart | null;
    readonly endnotesPart: OoxmlPart | null;
    readonly measurer: TextMeasurer;
    readonly cache: unknown;
    readonly styleCascade: unknown;
    readonly numberingIndex: unknown;
  }
>();

function notesMemoFor(
  session: { notes: unknown } | undefined,
  allHits: readonly PageRefHit[],
  input: NotesLayoutInput
): { memo: NotesPassMemo | null; allHits: readonly PageRefHit[]; reused: boolean } {
  if (!session) return { memo: null, allHits, reused: false };
  const inputFingerprint = fingerprintNotesInput(input);
  if (inputFingerprint === null) {
    session.notes = null;
    return { memo: null, allHits, reused: false };
  }
  const hitsFingerprint = fingerprintHits(allHits);
  const existing = session.notes as NotesPassMemo | null;
  if (existing && existing.hitsFingerprint === hitsFingerprint) {
    const identity = notesInputIdentities.get(existing);
    if (
      existing.inputFingerprint === inputFingerprint &&
      identity &&
      identity.footnotesPart === input.footnotesPart &&
      identity.endnotesPart === input.endnotesPart &&
      identity.measurer === input.measurer &&
      identity.cache === input.cache &&
      identity.styleCascade === input.styleCascade &&
      // By identity, like the cascade beside it. `numbering.xml` is a different part from the
      // notes part, so an edit to it moves nothing else this fingerprint compares.
      identity.numberingIndex === input.numberingIndex
    ) {
      return { memo: existing, allHits: existing.allHits, reused: true };
    }
  }
  const fresh: NotesPassMemo = {
    hitsFingerprint,
    inputFingerprint,
    allHits,
    provisionalMarks: provisionalNoteMarks(allHits, input),
    finalMarks: null,
    settledReserves: null,
    reflowSpent: null,
    pageAttach: new WeakMap(),
    pageReserve: new WeakMap(),
  };
  notesInputIdentities.set(fresh, {
    footnotesPart: input.footnotesPart,
    endnotesPart: input.endnotesPart,
    measurer: input.measurer,
    cache: input.cache,
    styleCascade: input.styleCascade,
    numberingIndex: input.numberingIndex,
  });
  session.notes = fresh;
  return { memo: fresh, allHits, reused: false };
}

/**
 * The layout with notes attached, plus any fallbacks taken and the mark context used.
 *
 * The marks come back because they feed the body's incremental cache tokens: a note number that
 * changed must invalidate the paragraph that references it.
 */
export interface NotesAttachResult {
  readonly layout: SemanticLayout;
  readonly fallbackReasons: readonly NotePaginationFallbackReason[];
  /** Mark context used for the final body projection (for incremental cache tokens). */
  readonly noteMarks: NoteMarkContext;
}

interface PageRefHit {
  readonly noteKind: NoteKind;
  readonly noteId: number;
  readonly paragraphId: string;
  /** Canonical UTF-16 atom offset within the paragraph. */
  readonly atomOffset: number;
  readonly customMarkFollows: boolean;
  readonly sectionIndex: number;
}

export type { PageRefHit };

type NoteCarryMap = Map<
  string,
  { fragments: readonly BlockFragmentRecord[]; height: number; mark: string | null }
>;

/**
 * Whether a paragraph fragment owns a note atom at `atomOffset`.
 *
 * Fragment ranges are half-open for content ownership: `[start, end)`. The shared
 * boundary offset belongs to the later fragment (downstream affinity), matching line
 * splits where `fragmentStart = previous.range.end`.
 */
export function fragmentOwnsAtomOffset(
  fragment: ParagraphFragmentRecord,
  atomOffset: number
): boolean {
  return atomOffset >= fragment.range.start && atomOffset < fragment.range.end;
}

/**
 * Memoized by the fragments array's identity: pages reuse their fragment arrays across
 * incremental passes, and this flatten runs per page per pass on the ref-collection path.
 */
const paragraphFragmentsMemos = new WeakMap<
  readonly BlockFragmentRecord[],
  ParagraphFragmentRecord[]
>();

function paragraphFragmentsOfBlocks(
  blocks: readonly BlockFragmentRecord[]
): ParagraphFragmentRecord[] {
  const cached = paragraphFragmentsMemos.get(blocks);
  if (cached) return cached;
  const found: ParagraphFragmentRecord[] = [];
  const visit = (list: readonly BlockFragmentRecord[]): void => {
    for (const block of list) {
      if (block.kind === 'paragraph') {
        found.push(block);
        continue;
      }
      for (const row of block.rows) {
        if (row.isHeaderRepeat) continue;
        for (const cell of row.cells) visit(cell.blocks);
      }
    }
  };
  visit(blocks);
  paragraphFragmentsMemos.set(blocks, found);
  return found;
}

/** Paragraph-id → refs index for linear {@link filterRefsOnPage} over a layout pass. */
export type PageRefIndex = ReadonlyMap<string, readonly PageRefHit[]>;

/**
 * Memoized on the hit array's identity: the session memo hands the previous pass's hit array
 * back by identity when its content is unchanged, so the reserve compute and the attach pass
 * of every keystroke rebuilt an identical index.
 */
const pageRefIndexMemos = new WeakMap<readonly PageRefHit[], PageRefIndex>();

/** Build a reusable paragraph-id index (document order preserved per paragraph). */
export function buildPageRefIndex(allRefs: readonly PageRefHit[]): PageRefIndex {
  const cached = pageRefIndexMemos.get(allRefs);
  if (cached) return cached;
  const map = new Map<string, PageRefHit[]>();
  for (const ref of allRefs) {
    const list = map.get(ref.paragraphId);
    if (list) list.push(ref);
    else map.set(ref.paragraphId, [ref]);
  }
  pageRefIndexMemos.set(allRefs, map);
  return map;
}

/**
 * Per-page answers, memoized on the page's fragments array: a page an incremental pass
 * carried over keeps its fragments by identity, and one settle walks every page THREE times
 * (mark sites, reserve compute, attach). Keyed on the index too — a changed hit set publishes
 * a new index object, which invalidates every entry at once.
 */
const pageRefFilterMemos = new WeakMap<
  readonly BlockFragmentRecord[],
  { readonly refIndex: PageRefIndex; readonly result: readonly PageRefHit[] }
>();

/**
 * Collect note references that appear in laid-out body fragments on a page.
 * Matches {@link ParagraphFragmentRecord.range} ownership (half-open + boundary affinity).
 *
 * Pass {@link buildPageRefIndex} result as `refIndex` for O(fragments + matching refs)
 * instead of scanning every document ref against every page fragment.
 */
export function filterRefsOnPage(
  page: PageRecord,
  allRefs: readonly PageRefHit[],
  refIndex?: PageRefIndex
): readonly PageRefHit[] {
  const fragments = paragraphFragmentsOfBlocks(page.fragments);
  if (!refIndex) {
    return allRefs.filter((ref) =>
      fragments.some((fragment) => fragmentOwnsPosition(fragment, ref.paragraphId, ref.atomOffset))
    );
  }
  const cached = pageRefFilterMemos.get(page.fragments);
  if (cached && cached.refIndex === refIndex) return cached.result;
  const out: PageRefHit[] = [];
  const claimed = new Set<PageRefHit>();
  for (const fragment of fragments) {
    // Asked per paragraph the fragment DRAWS. A resolved display mode publishes a merged run
    // under the survivor's name, so a reference in an absorbed member matched no fragment at
    // all: the note it calls never reached the page, and the reader saw a mark with no note.
    for (const paragraphId of fragmentParagraphs(fragment)) {
      const candidates = refIndex.get(paragraphId);
      if (!candidates) continue;
      for (const ref of candidates) {
        if (claimed.has(ref)) continue;
        if (!fragmentOwnsPosition(fragment, paragraphId, ref.atomOffset)) continue;
        claimed.add(ref);
        out.push(ref);
      }
    }
  }
  pageRefFilterMemos.set(page.fragments, { refIndex, result: out });
  return out;
}

/**
 * Pass-local cache for separator / continuationSeparator layouts.
 * Tall authored separators are expensive to re-measure on every drain page.
 */
interface NoteSeparatorCache {
  get(
    part: OoxmlPart | null | undefined,
    kind: 'separator' | 'continuationSeparator',
    contentWidth: number,
    noteKind: NoteKind,
    maxFlowHeightPt: number,
    opts: LayoutNoteStoryOptions,
    reasons: NotePaginationFallbackReason[]
  ): NoteSeparatorLayout;
}

function createNoteSeparatorCache(): NoteSeparatorCache {
  const map = new Map<string, NoteSeparatorLayout>();
  return {
    get(part, kind, contentWidth, noteKind, maxFlowHeightPt, opts, reasons) {
      const partKey = part?.name ?? 'none';
      const key = `${partKey}\0${noteKind}\0${kind}\0${contentWidth}\0${maxFlowHeightPt}`;
      const cached = map.get(key);
      if (cached) return cached;
      const laid = layoutNoteSeparator(part, kind, contentWidth, opts, noteKind, maxFlowHeightPt);
      map.set(key, laid);
      if (laid.fallbackReason) reasons.push(laid.fallbackReason);
      return laid;
    },
  };
}

/** Scan an OOXML part's laid-out paragraph ids → refs already collected from the package. */
export function buildPageRefHits(
  refs: readonly {
    readonly noteKind: NoteKind;
    readonly noteId: number;
    readonly paragraphId: string;
    readonly atomOffset: number;
    readonly customMarkFollows: boolean;
  }[],
  paragraphSectionIndex: ReadonlyMap<string, number>
): readonly PageRefHit[] {
  const hits: PageRefHit[] = [];
  for (const ref of refs) {
    if (hits.length >= MAX_NOTES_LAID_OUT) break;
    hits.push({
      ...ref,
      sectionIndex: paragraphSectionIndex.get(ref.paragraphId) ?? 0,
    });
  }
  return hits;
}

function footnotePropsFor(
  input: NotesLayoutInput,
  sectionIndex: number
): ResolvedFootnoteProperties {
  return (
    input.footnotePropsBySection[sectionIndex] ??
    input.footnotePropsBySection[0] ??
    input.documentFootnoteProps
  );
}

function endnotePropsFor(input: NotesLayoutInput, sectionIndex: number): ResolvedEndnoteProperties {
  return (
    input.endnotePropsBySection[sectionIndex] ??
    input.endnotePropsBySection[0] ??
    input.documentEndnoteProps
  );
}

function layoutOpts(input: NotesLayoutInput, noteMarks?: NoteMarkContext): LayoutNoteStoryOptions {
  return {
    measurer: input.measurer,
    producer: input.producer,
    cache: input.cache,
    styleCascade: input.styleCascade,
    numberingIndex: input.numberingIndex,
    defaultTabStopPt: input.defaultTabStopPt,
    projectLink: input.projectLink,
    projectFieldLink: input.projectFieldLink,
    documentProperties: input.documentProperties,
    refFields: input.refFields,
    noteMarks,
    drawingsForPart: input.drawingsForPart,
  };
}

/**
 * Split one paragraph fragment at a line boundary so the head fits under `availableBottom`
 * (story-relative). Empty head means no line fits — caller must defer the fragment.
 */
function splitParagraphFragmentByBottom(
  fragment: ParagraphFragmentRecord,
  availableBottom: number
): {
  readonly head: ParagraphFragmentRecord | null;
  readonly tail: ParagraphFragmentRecord | null;
} {
  if (fragment.lines.length === 0) {
    return fragment.box.y + fragment.box.height <= availableBottom + 0.001
      ? { head: fragment, tail: null }
      : { head: null, tail: fragment };
  }

  let cut = 0;
  for (; cut < fragment.lines.length; cut += 1) {
    const line = fragment.lines[cut]!;
    if (line.box.y + line.box.height > availableBottom + 0.001) break;
  }
  if (cut === 0) return { head: null, tail: fragment };
  if (cut >= fragment.lines.length) return { head: fragment, tail: null };

  const headLines = fragment.lines.slice(0, cut);
  const tailLines = fragment.lines.slice(cut);
  const headLast = headLines[headLines.length - 1]!;
  const headTop = fragment.box.y;
  const headBottom = headLast.box.y + headLast.box.height;
  const headBorders = fragment.borders?.filter((stroke) => stroke.side !== 'bottom');

  const head: ParagraphFragmentRecord = {
    ...fragment,
    range: {
      paragraphId: fragment.paragraphId,
      start: headLines[0]!.range.start,
      end: headLast.range.end,
    },
    spacing: { before: fragment.spacing.before, after: 0 },
    lines: headLines,
    box: { ...fragment.box, height: Math.max(0, headBottom - headTop) },
    ...(headBorders && headBorders.length > 0 ? { borders: headBorders } : { borders: undefined }),
    bottomBorder: undefined,
    ...(fragment.shadingBox
      ? {
          shadingBox: {
            ...fragment.shadingBox,
            height: Math.max(0, headBottom - fragment.shadingBox.y),
          },
        }
      : {}),
  };

  // Keep the tail in the original story coordinate space; {@link splitNoteFragments} rebases
  // the whole raw tail with one shift so sibling blocks stay contiguous.
  const tailLast = tailLines[tailLines.length - 1]!;
  const tailTop = tailLines[0]!.box.y;
  const tailBottom = tailLast.box.y + tailLast.box.height;
  const tailBorders = fragment.borders?.filter((stroke) => stroke.side !== 'top');
  const tail: ParagraphFragmentRecord = {
    ...fragment,
    id: `${fragment.paragraphId}#f${fragment.fragmentIndex + 1}`,
    fragmentIndex: fragment.fragmentIndex + 1,
    range: {
      paragraphId: fragment.paragraphId,
      start: tailLines[0]!.range.start,
      end: tailLines[tailLines.length - 1]!.range.end,
    },
    spacing: { before: 0, after: fragment.spacing.after },
    lines: tailLines,
    box: {
      x: fragment.box.x,
      y: tailTop,
      width: fragment.box.width,
      height: Math.max(0, tailBottom - tailTop),
    },
    marker: undefined,
    ...(tailBorders && tailBorders.length > 0 ? { borders: tailBorders } : { borders: undefined }),
    ...(fragment.bottomBorder ? { bottomBorder: fragment.bottomBorder } : {}),
    ...(fragment.shadingBox
      ? {
          shadingBox: {
            x: fragment.shadingBox.x,
            y: tailTop,
            width: fragment.shadingBox.width,
            height: Math.max(0, tailBottom - tailTop),
          },
        }
      : {}),
  };
  return { head, tail };
}

/**
 * Split a note story so the head fits in `availableHeight` (story-relative).
 *
 * Allows an empty head (entire story moves to the next page) instead of accepting a first
 * fragment taller than the remaining room. Paragraph fragments split at line boundaries;
 * a single line that exceeds a full content column records {@link note-line-exceeds-page}
 * and is not placed with overflowing geometry.
 */
function splitNoteFragments(
  laid: NoteStoryLayout,
  availableHeight: number,
  options?: {
    readonly fullContentHeight?: number;
    readonly reasons?: NotePaginationFallbackReason[];
  }
): {
  readonly head: readonly BlockFragmentRecord[];
  readonly headHeight: number;
  readonly tail: readonly BlockFragmentRecord[];
  readonly tailHeight: number;
} {
  if (laid.flowHeight <= availableHeight + 0.001) {
    return {
      head: laid.fragments,
      headHeight: laid.flowHeight,
      tail: [],
      tailHeight: 0,
    };
  }
  if (availableHeight <= 0.001) {
    return {
      head: [],
      headHeight: 0,
      tail: laid.fragments,
      tailHeight: laid.flowHeight,
    };
  }

  const head: BlockFragmentRecord[] = [];
  let headHeight = 0;
  let cut = 0;
  let partialTail: BlockFragmentRecord | null = null;

  for (let i = 0; i < laid.fragments.length && i < MAX_NOTE_FRAGMENTS; i += 1) {
    const fragment = laid.fragments[i]!;
    const next = fragment.box.y + fragment.box.height;
    if (next <= availableHeight + 0.001) {
      head.push(fragment);
      headHeight = next;
      cut = i + 1;
      continue;
    }

    if (fragment.kind === 'paragraph') {
      const split = splitParagraphFragmentByBottom(fragment, availableHeight);
      if (split.head) {
        head.push(split.head);
        headHeight = split.head.box.y + split.head.box.height;
        partialTail = split.tail;
        cut = i + 1;
      } else {
        // No line fits in the remaining room — leave head as-is (possibly empty) and
        // defer this fragment. When the room is a full content column and one line still
        // does not fit, record a named fallback rather than overflowing geometry.
        const fullH = options?.fullContentHeight ?? availableHeight;
        const firstLine = fragment.lines[0];
        const lineH = firstLine?.box.height ?? fragment.box.height;
        if (head.length === 0 && availableHeight >= fullH - 0.001 && lineH > fullH + 0.001) {
          options?.reasons?.push('note-line-exceeds-page');
          // Skip the unsplittable fragment; continue attempting later siblings on a fresh
          // carry rather than clipping it into the column.
          cut = i + 1;
          partialTail = null;
          const rest = laid.fragments.slice(cut);
          const dy = rest[0]?.box.y ?? 0;
          return {
            head: [],
            headHeight: 0,
            tail: shiftFragments(rest, -dy),
            tailHeight: Math.max(0, laid.flowHeight - dy),
          };
        }
        cut = i;
        partialTail = null;
      }
      break;
    }

    // Tables / non-paragraph: never accept an overflowing first fragment.
    cut = i;
    break;
  }

  const rawTail = [...(partialTail ? [partialTail] : []), ...laid.fragments.slice(cut)];
  if (rawTail.length === 0) {
    return { head, headHeight, tail: [], tailHeight: 0 };
  }
  const dy = rawTail[0]?.box.y ?? 0;
  const tail = shiftFragments(rawTail, -dy);
  const tailHeight = fragmentFlowBottom(tail);
  return { head, headHeight, tail, tailHeight };
}

function effectiveNoteMarkStyle(
  noteKind: NoteKind,
  styleCascade: StyleCascadeTable | undefined
): ResolvedRunStyle {
  const styleId = noteKind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference';
  if (!styleCascade) {
    return { ...DEFAULT_RUN_STYLE, verticalAlign: 'superscript' };
  }
  const props = cascadeRunProperties(
    [],
    [{ localName: 'rStyle', attributes: { val: styleId } }],
    styleCascade
  );
  return resolveRunStyle(props, styleCascade.themeFonts);
}

/**
 * Pick the widest-measuring eachPage reservation string across actual marks and a bounded
 * window of per-section candidate values/formats. Selection is by measured width under the
 * effective mark style — not string length — so proportional fonts where a shorter glyph
 * run is wider (e.g. `ii` vs `10`) reserve correctly.
 */
function selectEachPageReservedMarkText(
  marks: ReadonlyMap<string, string | null>,
  input: NotesLayoutInput,
  footnoteSites: readonly NoteReferenceSite[],
  endnoteSites: readonly NoteReferenceSite[]
): string | undefined {
  const candidates = new Set<string>();
  for (const mark of marks.values()) {
    if (mark && mark.length > 0) candidates.add(mark);
  }

  const sectionCount = Math.max(
    input.footnotePropsBySection.length,
    input.endnotePropsBySection.length,
    1,
    ...footnoteSites.map((site) => site.sectionIndex + 1),
    ...endnoteSites.map((site) => site.sectionIndex + 1)
  );

  let usesEachPage = false;
  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    const fn = footnotePropsFor(input, sectionIndex);
    if (fn.numRestart === 'eachPage') {
      usesEachPage = true;
      for (let i = 0; i < MAX_EACH_PAGE_MARK_CANDIDATES; i += 1) {
        const text = formatNumFmt(fn.numFmt, fn.numStart + i);
        if (text.length > 0) candidates.add(text);
      }
    }
    const en = endnotePropsFor(input, sectionIndex);
    if (en.numRestart === 'eachPage') {
      usesEachPage = true;
      for (let i = 0; i < MAX_EACH_PAGE_MARK_CANDIDATES; i += 1) {
        const text = formatNumFmt(en.numFmt, en.numStart + i);
        if (text.length > 0) candidates.add(text);
      }
    }
  }
  if (!usesEachPage || candidates.size === 0) return undefined;

  const style = effectiveNoteMarkStyle('footnote', input.styleCascade);
  let best: string | undefined;
  let bestWidth = -1;
  for (const text of candidates) {
    const width = input.measurer.measure(text, style);
    if (
      width > bestWidth + 0.001 ||
      (Math.abs(width - bestWidth) <= 0.001 && text.length > (best?.length ?? 0))
    ) {
      best = text;
      bestWidth = width;
    }
  }
  return best;
}

function buildMarkContext(
  footnoteSites: readonly NoteReferenceSite[],
  endnoteSites: readonly NoteReferenceSite[],
  input: NotesLayoutInput
): NoteMarkContext {
  const fnMarks = deriveNoteDisplayMarksResolved('footnote', footnoteSites, (sectionIndex) =>
    footnotePropsFor(input, sectionIndex)
  );
  const enMarks = deriveNoteDisplayMarksResolved('endnote', endnoteSites, (sectionIndex) =>
    endnotePropsFor(input, sectionIndex)
  );
  const marks = new Map<string, string | null>();
  for (const entry of fnMarks) {
    marks.set(noteMarkKey('footnote', entry.noteId), entry.mark);
  }
  for (const entry of enMarks) {
    marks.set(noteMarkKey('endnote', entry.noteId), entry.mark);
  }

  const reservedMarkText = selectEachPageReservedMarkText(
    marks,
    input,
    footnoteSites,
    endnoteSites
  );
  return {
    marks,
    ...(reservedMarkText ? { reservedMarkText } : {}),
  };
}

/**
 * Body bottom (content-relative pt) the note passes measure against.
 *
 * MINUS each paragraph's trailing after-spacing: the page-fit decision admits a paragraph
 * without charging its `w:spacing w:after` (it moves to the next page with the flow), but
 * the fragment BOX includes it — so a page whose last paragraph carries after-spacing
 * "uses" more height here than the fit rule budgeted, the reserve the reflow settles on
 * under-claims by that amount, and the attach pass splits a note the reserve fit whole.
 * Word lets the footnote area rise into that blank band the same way.
 */
function bodyUsedHeight(page: PageRecord): number {
  let bottom = 0;
  for (const fragment of page.fragments) {
    const trailingAfter = fragment.kind === 'paragraph' ? fragment.spacing.after : 0;
    bottom = Math.max(bottom, fragment.box.y + fragment.box.height - trailingAfter);
  }
  return bottom;
}

/** Remove note-pass output before recomputing it from canonical references. */
function bodyOnlyPage(page: PageRecord): PageRecord {
  // IDENTITY WHEN THERE IS NOTHING TO STRIP. The rest-destructure allocates a new object
  // every time, and a page record is what the painter reuses BY IDENTITY — so a document
  // with a notes part and no notes at all handed the painter a whole new set of pages on
  // every pass, and every visible page's DOM was rebuilt on every keystroke. The lane runs
  // for any package that HAS a footnotes or endnotes part, which is nearly every Word file.
  // Its three siblings — `withPageFieldSources`, `attachContentControlBoundaries` and
  // `reprojectBodyNoteMarks` — all return the original page when nothing moved.
  if (
    page.footnotes === undefined &&
    page.endnotes === undefined &&
    page.noteStream === undefined
  ) {
    return page;
  }
  const { footnotes, endnotes, noteStream, ...body } = page;
  void footnotes;
  void endnotes;
  void noteStream;
  return body;
}

/**
 * Replace provisional body citation digits with page-aware marks after attach.
 *
 * Body layout runs with {@link provisionalNoteMarks} (no `pageIndex`, so `eachPage`
 * behaves like continuous). {@link attachNotesToLayout} then derives final marks with
 * page assignment. This walk updates only `to-note` projected span *display* text —
 * source ranges, box geometry (reserved width), and note areas stay untouched — so
 * digit refinement cannot reflow or corrupt interaction offsets.
 *
 * Structural sharing: unchanged spans/lines/fragments/pages keep identity.
 */
export function reprojectBodyNoteMarks(
  layout: SemanticLayout,
  noteMarks: NoteMarkContext
): SemanticLayout {
  if (noteMarks.marks.size === 0) return layout;

  let anyPageChanged = false;
  const pages = layout.pages.map((page) => {
    // Most pages of a long document carry no note reference at all; their fragment trees
    // are identity-stable across passes, so the answer memoizes and the reprojection walk
    // skips them in O(1) instead of visiting every span per keystroke.
    if (!blocksCarryNoteNav(page.fragments)) return page;
    const fragments = reprojectBodyBlocks(page.fragments, noteMarks);
    if (fragments === page.fragments) return page;
    anyPageChanged = true;
    return { ...page, fragments };
  });
  return anyPageChanged ? { revision: layout.revision, pages } : layout;
}

/** Whether any span under `blocks` is a projected to-note citation, memoized by identity. */
const blocksNoteNavMemos = new WeakMap<readonly BlockFragmentRecord[], boolean>();

function blocksCarryNoteNav(blocks: readonly BlockFragmentRecord[]): boolean {
  const cached = blocksNoteNavMemos.get(blocks);
  if (cached !== undefined) return cached;
  let found = false;
  const visit = (list: readonly BlockFragmentRecord[]): void => {
    for (const block of list) {
      if (found) return;
      if (block.kind === 'paragraph') {
        for (const line of block.lines) {
          for (const span of line.spans) {
            if (span.projected && span.noteNav?.direction === 'to-note') {
              found = true;
              return;
            }
          }
        }
        continue;
      }
      for (const row of block.rows) {
        for (const cell of row.cells) visit(cell.blocks);
      }
    }
  };
  visit(blocks);
  blocksNoteNavMemos.set(blocks, found);
  return found;
}

function reprojectBodyBlocks(
  blocks: readonly BlockFragmentRecord[],
  noteMarks: NoteMarkContext
): readonly BlockFragmentRecord[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.kind === 'paragraph') {
      const updated = reprojectParagraphFragment(block, noteMarks);
      if (updated !== block) changed = true;
      return updated;
    }
    let rowsChanged = false;
    const rows = block.rows.map((row) => {
      let cellsChanged = false;
      const cells = row.cells.map((cell) => {
        const nested = reprojectBodyBlocks(cell.blocks, noteMarks);
        if (nested === cell.blocks) return cell;
        cellsChanged = true;
        return { ...cell, blocks: nested };
      });
      if (!cellsChanged) return row;
      rowsChanged = true;
      return { ...row, cells };
    });
    if (!rowsChanged) return block;
    changed = true;
    return { ...block, rows };
  });
  return changed ? next : blocks;
}

function reprojectParagraphFragment(
  fragment: ParagraphFragmentRecord,
  noteMarks: NoteMarkContext
): ParagraphFragmentRecord {
  let linesChanged = false;
  const lines = fragment.lines.map((line) => {
    const updated = reprojectLine(line, noteMarks);
    if (updated !== line) linesChanged = true;
    return updated;
  });
  return linesChanged ? { ...fragment, lines } : fragment;
}

function reprojectLine(line: LineRecord, noteMarks: NoteMarkContext): LineRecord {
  let spansChanged = false;
  const spans = line.spans.map((span) => {
    const updated = reprojectBodyCitationSpan(span, noteMarks);
    if (updated !== span) spansChanged = true;
    return updated;
  });
  return spansChanged ? { ...line, spans } : line;
}

function reprojectBodyCitationSpan(
  span: StyleSpanRecord,
  noteMarks: NoteMarkContext
): StyleSpanRecord {
  if (!span.projected || span.noteNav?.direction !== 'to-note') return span;
  const mark = noteMarks.marks.get(span.noteNav.scopeId);
  // Absent key: leave provisional text (dangling / unknown). null = customMarkFollows.
  if (mark === undefined) return span;
  const text = mark ?? '';
  if (span.text === text) return span;
  // Keep box.width — eachPage reserved measurement already sized for the widest mark.
  return { ...span, text };
}

/**
 * Content-column y (relative to contentBox.y) at which footnotes begin, or the column
 * bottom when the page has no footnote area. Endnotes must stay strictly above this.
 */
function footnoteReservedTop(page: PageRecord): number {
  if (!page.footnotes) return page.contentBox.height;
  return Math.max(0, Math.min(page.contentBox.height, page.footnotes.box.y - page.contentBox.y));
}

/**
 * Whether a page may host sectEnd/docEnd endnotes in leftover body room.
 *
 * Footnote-only continuation/drain sheets are never free endnote hosts — even when their
 * body fragments are empty and look like unused column space.
 */
export function isEndnoteHostEligible(page: PageRecord): boolean {
  if (page.noteStream === 'footnote-drain') return false;
  // Untagged safety net: empty body + footnote stories is a drain/continuation sheet.
  if (page.fragments.length === 0 && (page.footnotes?.notes.length ?? 0) > 0) return false;
  return true;
}

/** Last page index that may share endnotes with body (or an empty endnote overflow sheet). */
function lastEndnoteHostIndex(pages: readonly PageRecord[]): number {
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    if (isEndnoteHostEligible(pages[i]!)) return i;
  }
  return Math.max(0, pages.length - 1);
}

function buildFootnoteArea(
  page: PageRecord,
  refs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  placement: FootnotePosition,
  continuationCarry: NoteCarryMap,
  reasons: NotePaginationFallbackReason[],
  options?: {
    /**
     * When true, size the note stack against the content column (minus
     * {@link MIN_FOOTNOTE_BODY_BAND_PT}) instead of leftover body slack. Used by
     * reserve measurement so height is not clipped before body reflow.
     */
    readonly reserveColumnBudget?: boolean;
    /**
     * Band (content-relative pt) of each REFERENCE's own line
     * ({@link noteReferenceLineBandPt}). The BOTTOM keeps a note's first fragment on its
     * reference page: a budget that ignores where the reference sits evicts the
     * referencing line itself, and the reflow loop then chases the reference across pages
     * instead of converging. Per reference, because the stack tightens as it grows: note
     * `i` may fill down to reference `i`'s line, so an earlier note keeps its full room
     * while a later one whose line sits under the accumulated stack gets nothing — one
     * shared floor at the page's lowest reference strangles them all to the sliver under
     * it, stably. The TOP is where the reserve reaches when the note cannot even start in
     * that room: Word keeps a footnote whole with its reference, so the reference's LINE
     * moves to the next page instead of the note splitting (see the eviction branch in the
     * reference loop). Only read with {@link reserveColumnBudget}; attach passes size from
     * real body slack.
     */
    readonly reserveBandOf?: (ref: PageRefHit) => NoteReferenceLineBand;
    readonly separatorCache?: NoteSeparatorCache;
  }
): {
  area: NoteAreaRecord | undefined;
  nextCarry: NoteCarryMap;
  /**
   * Content-relative top the page's reserve must reach to push an unplaceable reference's
   * line to the next page (reserve mode only; undefined when nothing needs evicting).
   */
  evictionTopPt?: number;
} {
  const nextCarry: NoteCarryMap = new Map(continuationCarry);
  const pageRefs = refs.filter((ref) => ref.noteKind === 'footnote');
  const contentWidth = page.contentBox.width;
  const opts = layoutOpts(input, noteMarks);

  // Continuations from previous page first.
  const notes: NoteStoryRecord[] = [];
  let stackHeight = 0;
  let fragmentBudget = MAX_NOTE_AREA_FRAGMENTS;
  const separatorKind =
    continuationCarry.size > 0 ? ('continuationSeparator' as const) : ('separator' as const);
  const maxSepHeight = Math.max(0, page.contentBox.height);
  const separator = options?.separatorCache
    ? options.separatorCache.get(
        input.footnotesPart,
        separatorKind,
        contentWidth,
        'footnote',
        maxSepHeight,
        opts,
        reasons
      )
    : (() => {
        const laid = layoutNoteSeparator(
          input.footnotesPart,
          separatorKind,
          contentWidth,
          opts,
          'footnote',
          maxSepHeight
        );
        if (laid.fallbackReason) reasons.push(laid.fallbackReason);
        return laid;
      })();

  const slackBudget = Math.max(
    0,
    page.contentBox.height - bodyUsedHeight(page) - separator.flowHeight
  );
  const columnBudget = Math.max(
    0,
    page.contentBox.height - MIN_FOOTNOTE_BODY_BAND_PT - separator.flowHeight
  );
  const availableForNotes = options?.reserveColumnBudget ? columnBudget : slackBudget;
  const fullNoteColumn = Math.max(0, page.contentBox.height - separator.flowHeight);
  const splitOpts = { fullContentHeight: fullNoteColumn, reasons };

  // Place continuations.
  for (const [scopeId, carry] of continuationCarry) {
    const parsed = scopeId.match(/^(footnote|endnote):(-?\d+)$/);
    if (!parsed || parsed[1] !== 'footnote') continue;
    const noteId = Number(parsed[2]);
    const room = Math.max(0, availableForNotes - stackHeight);
    if (carry.height <= room + 0.001) {
      notes.push({
        noteKind: 'footnote',
        noteId,
        scopeId,
        mark: null,
        continuation: true,
        box: {
          x: page.contentBox.x,
          y: 0,
          width: contentWidth,
          height: carry.height,
        },
        fragments: carry.fragments,
      });
      stackHeight += carry.height;
      nextCarry.delete(scopeId);
    } else {
      const split = splitNoteFragments(
        {
          noteKind: 'footnote',
          noteId,
          scopeId,
          noteType: undefined,
          fragments: carry.fragments,
          flowHeight: carry.height,
        },
        room,
        splitOpts
      );
      if (split.head.length > 0) {
        notes.push({
          noteKind: 'footnote',
          noteId,
          scopeId,
          mark: null,
          continuation: true,
          box: {
            x: page.contentBox.x,
            y: 0,
            width: contentWidth,
            height: split.headHeight,
          },
          fragments: split.head,
        });
        stackHeight += split.headHeight;
      }
      if (split.tail.length > 0) {
        nextCarry.set(scopeId, {
          fragments: split.tail,
          height: split.tailHeight,
          mark: null,
        });
      } else {
        nextCarry.delete(scopeId);
      }
    }
  }

  let evictionTopPt: number | undefined;
  for (const ref of pageRefs) {
    if (notes.length >= MAX_NOTES_LAID_OUT) {
      reasons.push('note-count-limit');
      break;
    }
    const laid = layoutNoteById(input.footnotesPart, ref.noteId, contentWidth, opts);
    if (!laid) {
      reasons.push('missing-note-body');
      continue;
    }
    const mark = noteMarks.marks.get(noteMarkKey('footnote', ref.noteId)) ?? null;
    // Reserve mode tightens each note's budget to ITS reference's floor; the stack may not
    // rise above any line that cites into it. Later references sit lower, so their budgets
    // only shrink.
    const band = options?.reserveBandOf?.(ref);
    const refBudget = band
      ? Math.min(
          availableForNotes,
          Math.max(
            0,
            page.contentBox.height -
              Math.max(MIN_FOOTNOTE_BODY_BAND_PT, band.bottom) -
              separator.flowHeight
          )
        )
      : availableForNotes;
    const room = Math.max(0, refBudget - stackHeight);
    fragmentBudget -= laid.fragments.length;
    if (fragmentBudget < 0) {
      reasons.push('note-area-fragment-limit');
      break;
    }
    // Word keeps a footnote whole with its reference: a note that cannot fit whole below
    // its reference line — but could fit in a page's note column — does not split. The
    // reference's LINE moves to the next page instead, so the reserve must reach the
    // line's TOP; the next reflow pass finds the reference there and lays the note whole
    // beside it. Every later reference on this page sits on or after the evicted line and
    // moves with it, so the loop ends here. Splitting remains for a note taller than the
    // column (nothing can hold it whole) and for a reference already inside the minimum
    // body band (evicting it would chase blank pages).
    if (
      band &&
      band.evictable &&
      laid.flowHeight > room + 0.001 &&
      laid.flowHeight <= columnBudget + 0.001 &&
      band.top > MIN_FOOTNOTE_BODY_BAND_PT + 0.001
    ) {
      evictionTopPt = evictionTopPt === undefined ? band.top : Math.min(evictionTopPt, band.top);
      break;
    }
    if (laid.flowHeight <= room + 0.001) {
      notes.push({
        noteKind: 'footnote',
        noteId: ref.noteId,
        scopeId: laid.scopeId,
        mark: ref.customMarkFollows ? null : mark,
        box: {
          x: page.contentBox.x,
          y: 0,
          width: contentWidth,
          height: laid.flowHeight,
        },
        fragments: laid.fragments,
      });
      stackHeight += laid.flowHeight;
    } else {
      const split = splitNoteFragments(laid, room, splitOpts);
      if (split.head.length > 0) {
        notes.push({
          noteKind: 'footnote',
          noteId: ref.noteId,
          scopeId: laid.scopeId,
          mark: ref.customMarkFollows ? null : mark,
          box: {
            x: page.contentBox.x,
            y: 0,
            width: contentWidth,
            height: split.headHeight,
          },
          fragments: split.head,
        });
        stackHeight += split.headHeight;
      }
      if (split.tail.length > 0) {
        nextCarry.set(laid.scopeId, {
          fragments: split.tail,
          height: split.tailHeight,
          mark: null,
        });
      }
    }
  }

  if (notes.length === 0 && continuationCarry.size === 0) {
    return {
      area: undefined,
      nextCarry,
      ...(evictionTopPt !== undefined ? { evictionTopPt } : {}),
    };
  }

  const sepHeight = separator.flowHeight;
  const totalHeight = sepHeight + stackHeight;
  const bodyBottom = bodyUsedHeight(page);
  let areaTop: number;
  if (placement === 'beneathText') {
    areaTop = page.contentBox.y + bodyBottom;
  } else {
    // pageBottom — pin to bottom of content column.
    areaTop = page.contentBox.y + page.contentBox.height - totalHeight;
    // Never overlap body text.
    areaTop = Math.max(areaTop, page.contentBox.y + bodyBottom);
  }

  let cursorY = areaTop + sepHeight;
  const placedNotes: NoteStoryRecord[] = notes.map((note) => {
    const placed = {
      ...note,
      box: { ...note.box, y: cursorY },
    };
    cursorY += note.box.height;
    return placed;
  });

  const sepBox = noteSeparatorAreaBox(separator, page.contentBox.x, contentWidth, areaTop);

  const area: NoteAreaRecord = {
    kind: 'footnotes',
    placement: placement === 'beneathText' ? 'beneathText' : 'pageBottom',
    box: {
      x: page.contentBox.x,
      y: areaTop,
      width: contentWidth,
      height: totalHeight,
    },
    separator: {
      kind: separatorKind,
      box: sepBox,
      fragments: separator.fragments,
      synthetic: separator.synthetic,
      ...(separator.ruleStyle !== undefined ? { ruleStyle: separator.ruleStyle } : {}),
    },
    notes: placedNotes,
  };
  return { area, nextCarry, ...(evictionTopPt !== undefined ? { evictionTopPt } : {}) };
}

/**
 * The last page at or before `position` that the BODY pass produced.
 *
 * Only such a page carries an index in the layout's original space, which is what a section
 * lookup needs. `lastEndnoteHostIndex` and `lastPageIndexForSection` both hand back a page that
 * can HOST notes, and an endnote overflow sheet qualifies — `isEndnoteHostEligible` turns away
 * only footnote drain sheets — so the run's starting page is not itself a guarantee. Position 0
 * is always a body-pass page: minting needs a template, so nothing can be inserted before it.
 */
function originalPageAtOrBefore(pages: readonly PageRecord[], position: number): number {
  let at = Math.min(Math.max(position, 0), pages.length - 1);
  while (at > 0 && pages[at]!.noteStream !== undefined) at -= 1;
  return at;
}

/**
 * Mints the blank sheets a note run needs, each resolving its OWN shell.
 *
 * Both indices come from the caller, and each answers a different question in its own space.
 *
 * The SECTION ANCHOR must read in the layout's ORIGINAL index space, so it comes from a page the
 * body pass produced — {@link originalPageAtOrBefore} finds one. A sheet this pass minted cannot
 * serve: `insertOverflowPageAt` stamps it with an insertion POSITION, and the section spans it
 * would be looked up against are in original space.
 *
 * The LANDING INDEX is the array position the sheet occupies, which is the document index it
 * keeps once the pass reindexes — inserts only ever move forward, so nothing displaces it
 * afterwards. It decides the variant, and through it the content box, because
 * `w:evenAndOddHeaders` alternates on the page's number in the document: the drain sheets and
 * earlier overflow sheets in front of this one all count towards it.
 */
function createOverflowSheetMinter(layout: SemanticLayout): OverflowSheetMinter {
  return (args) => {
    const shell = overflowPageShellAt(
      layout,
      args.sectionAnchorIndex,
      args.landingIndex,
      args.template.box
    );
    return cloneEmptyOverflowPage(args.template, args.landingIndex, args.noteStream, shell);
  };
}

type OverflowSheetMinter = (args: {
  readonly template: PageRecord;
  /** Array position the sheet is inserted at, which is also its final document index. */
  readonly landingIndex: number;
  readonly noteStream?: PageNoteStream;
  /** Original-space index of a body-pass page in the section the new sheet belongs to. */
  readonly sectionAnchorIndex: number;
}) => PageRecord;

/**
 * A blank sheet minted after body layout, for notes that ran off the page.
 *
 * `shell` is the content box AND the furniture the NEW index resolves to. Neither is the
 * template's: a sheet cloned from a title page inherits a content box that page 0's variant
 * resolved and its own never does — 20 pt of a header's worth on the shape this fixture class
 * uses — and the furniture page 0 shows, which for a `w:titlePg` section with no `first`
 * reference is no header at all. Taking one without the other is worse than taking neither: a
 * default-variant inset over a title page's absent header paints an empty band exactly a
 * header high. Absent shell keeps the template's, which is what a layout assembled outside the
 * body pass can offer.
 */
function cloneEmptyOverflowPage(
  template: PageRecord,
  index: number,
  noteStream?: PageNoteStream,
  shell?: OverflowPageShell
): PageRecord {
  const contentBox = shell
    ? {
        x: template.contentBox.x,
        y: template.box.y + shell.insets.top,
        width: template.contentBox.width,
        height: shell.insets.height,
      }
    : template.contentBox;
  const header = shell ? shell.header : template.header;
  const footer = shell ? shell.footer : template.footer;
  return {
    id: `page-${index}`,
    index,
    box: template.box,
    contentBox,
    fragments: [],
    ...(noteStream ? { noteStream } : {}),
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
    ...(template.pageFieldSource
      ? {
          pageFieldSource: {
            ...template.pageFieldSource,
            // ONE PAGE after its template, stated rather than derived. `index` is an array
            // position and `template.index` is the layout index the body pass gave it, and the
            // notes pass reindexes only at the end — so once anything has been inserted in
            // front of the template the two spaces differ, and their difference is a count of
            // insertions, not a page distance. Every minted sheet sits directly after the page
            // it was cloned from, which is what this number means.
            pageNumber: template.pageFieldSource.pageNumber + 1,
          },
        }
      : {}),
  };
}

/**
 * Re-resolve the shell of every minted sheet that later insertions slid along.
 *
 * A sheet resolves its shell when it is minted, from where it lands at that moment. That is
 * final for a sheet inserted inside its own section, but not for the footnote drain: the drain
 * appends at the document's end BEFORE the section loop runs, because that is the document
 * order Word uses, and an earlier section's `sectEnd` insertion then moves every drain sheet
 * one position along for each sheet it adds. Under `w:evenAndOddHeaders` an odd number of them
 * leaves each drain sheet showing the other variant's header over the other variant's box.
 *
 * Runs BEFORE `reindexAndFinalizeFields`, while a body-pass page still carries the index the
 * layout gave it — that is what a section lookup reads. From here an array position IS the
 * final page index, so the two inputs the resolver wants are both in hand.
 *
 * The comparison is on the FURNITURE as well as the insets. Two variants routinely resolve to
 * the same height — a one-line `default` header against a one-line `even` header is the common
 * shape — so equal insets say nothing about whether the sheet is showing the right story, and
 * an inset-only test would leave exactly the sheets this exists for untouched.
 *
 * A `pageBottom` note area hangs from the content box's BOTTOM, so it travels with that edge
 * when a footer variant moves it; every other area is measured from the top and travels with
 * that. A sheet whose area cannot sit inside the new box after the shift KEEPS the shell it was
 * minted with: its notes were fitted to the old box's HEIGHT and this pass cannot re-fit them,
 * and a sheet that is wrong about its variant beats one whose own notes fall outside it.
 */
function resettleMintedSheets(pages: readonly PageRecord[], layout: SemanticLayout): PageRecord[] {
  let sectionAnchorIndex: number | null = null;
  let changed = false;
  const next = pages.map((page, position) => {
    if (page.noteStream === undefined) {
      sectionAnchorIndex = page.index;
      return page;
    }
    if (sectionAnchorIndex === null) return page;
    const shell = overflowPageShellAt(layout, sectionAnchorIndex, position, page.box);
    if (!shell) return page;
    const top = page.box.y + shell.insets.top;
    const settled =
      top === page.contentBox.y &&
      shell.insets.height === page.contentBox.height &&
      shell.header?.variant === page.header?.variant &&
      shell.footer?.variant === page.footer?.variant;
    if (settled) return page;
    const contentBox = { ...page.contentBox, y: top, height: shell.insets.height };
    const bottom = top + contentBox.height;
    const oldBottom = page.contentBox.y + page.contentBox.height;
    const shifted = shiftNoteAreas(page, top - page.contentBox.y, bottom - oldBottom);
    if (!shifted.fits(top, bottom)) return page;
    changed = true;
    const { header: _header, footer: _footer, ...rest } = page;
    return {
      ...rest,
      contentBox,
      ...(shifted.footnotes ? { footnotes: shifted.footnotes } : {}),
      ...(shifted.endnotes ? { endnotes: shifted.endnotes } : {}),
      ...(shell.header ? { header: shell.header } : {}),
      ...(shell.footer ? { footer: shell.footer } : {}),
    };
  });
  return changed ? next : [...pages];
}

/** Translate one note area and everything inside it by `dy`. */
function shiftNoteArea(area: NoteAreaRecord, dy: number): NoteAreaRecord {
  if (dy === 0) return area;
  const shiftBox = (box: LayoutBox): LayoutBox => ({ ...box, y: box.y + dy });
  return {
    ...area,
    box: shiftBox(area.box),
    ...(area.separator
      ? { separator: { ...area.separator, box: shiftBox(area.separator.box) } }
      : {}),
    notes: area.notes.map((note) => ({ ...note, box: shiftBox(note.box) })),
  };
}

/**
 * Move a resettled sheet's note areas onto the edge each one is measured from, and say whether
 * they still sit inside the new box.
 *
 * A `pageBottom` footnote area hangs from the content bottom, so a footer variant that moves
 * that edge must move the area with it — leaving it where it was would paint the notes over the
 * footer band. Everything else is placed from the content top.
 */
function shiftNoteAreas(
  page: PageRecord,
  topDelta: number,
  bottomDelta: number
): {
  readonly footnotes?: NoteAreaRecord;
  readonly endnotes?: NoteAreaRecord;
  fits(top: number, bottom: number): boolean;
} {
  const deltaFor = (area: NoteAreaRecord): number =>
    area.placement === 'pageBottom' ? bottomDelta : topDelta;
  const footnotes = page.footnotes
    ? shiftNoteArea(page.footnotes, deltaFor(page.footnotes))
    : undefined;
  const endnotes = page.endnotes
    ? shiftNoteArea(page.endnotes, deltaFor(page.endnotes))
    : undefined;
  return {
    ...(footnotes ? { footnotes } : {}),
    ...(endnotes ? { endnotes } : {}),
    fits(top: number, bottom: number): boolean {
      const inside = (area: NoteAreaRecord | undefined): boolean =>
        area === undefined ||
        (area.box.y >= top - 0.001 && area.box.y + area.box.height <= bottom + 0.001);
      return inside(footnotes) && inside(endnotes);
    },
  };
}

/** Section indexes represented by body paragraph fragments on a page. */
function pageBodySectionIndexes(
  page: PageRecord,
  paragraphSectionIndex: ReadonlyMap<string, number>
): readonly number[] {
  const found = new Set<number>();
  for (const fragment of paragraphFragmentsOfBlocks(page.fragments)) {
    found.add(paragraphSectionIndex.get(fragment.paragraphId) ?? 0);
  }
  return [...found].sort((a, b) => a - b);
}

/** Last page index that carries any body content owned by `sectionIndex`. */
function lastPageIndexForSection(
  pages: readonly PageRecord[],
  sectionIndex: number,
  paragraphSectionIndex: ReadonlyMap<string, number>
): number {
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    if (pageBodySectionIndexes(pages[i]!, paragraphSectionIndex).includes(sectionIndex)) {
      return i;
    }
  }
  return Math.max(0, pages.length - 1);
}

/**
 * Exclusive upper bound for advancing into existing pages while placing section-end notes:
 * the first page after this section's body + footnote-drain run that belongs to a later
 * section. Overflow sheets are inserted at this boundary so notes never land on a later
 * section's body pages, and stay after this section's footnote drain pages.
 */
function sectionEndInsertBound(
  pages: readonly PageRecord[],
  sectionIndex: number,
  paragraphSectionIndex: ReadonlyMap<string, number>
): number {
  const last = lastPageIndexForSection(pages, sectionIndex, paragraphSectionIndex);
  for (let i = last + 1; i < pages.length; i += 1) {
    const page = pages[i]!;
    // Footnote drain / endnote overflow sheets still belong to the preceding note stream.
    if (page.noteStream === 'footnote-drain' || page.noteStream === 'endnote-overflow') {
      continue;
    }
    // Untagged empty-body footnote continuation (pre-tag safety).
    if (page.fragments.length === 0 && (page.footnotes?.notes.length ?? 0) > 0) {
      continue;
    }
    const sections = pageBodySectionIndexes(page, paragraphSectionIndex);
    if (sections.length === 0) continue;
    if (!sections.includes(sectionIndex)) return i;
  }
  return pages.length;
}

/**
 * After note overflow insertion, reindex sheets and re-project allowlisted PAGE fields.
 * Inserted overflow pages already carry a `pageFieldSource` cloned from the section template;
 * document-level NUMPAGES and furniture text need finalize against the new page count.
 */
function reindexAndFinalizeFields(pages: readonly PageRecord[]): PageRecord[] {
  const reindexed = reindexAndRestackPages(pages);
  return [...finalizePageFieldProjection({ revision: 0, pages: reindexed }).pages];
}

/**
 * Place endnotes (or sect/doc-end footnotes) onto `page`, splitting under a continuation
 * separator when they do not fit. Returns unplaced carry for further pages.
 *
 * Room accounting reserves any existing footnote area: endnotes stack below body text and
 * stay strictly above footnotes so the two geometries cannot overlap.
 */
function buildEndnoteArea(
  page: PageRecord,
  refs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  placement: 'sectEnd' | 'docEnd',
  continuationCarry: NoteCarryMap,
  reasons: NotePaginationFallbackReason[],
  options?: {
    readonly separatorKind?: 'separator' | 'continuationSeparator';
    readonly separatorCache?: NoteSeparatorCache;
  }
): { area: NoteAreaRecord | undefined; nextCarry: NoteCarryMap; remainingRefs: PageRefHit[] } {
  const nextCarry: NoteCarryMap = new Map(continuationCarry);
  const remainingRefs: PageRefHit[] = [];
  if (refs.length === 0 && continuationCarry.size === 0) {
    return { area: undefined, nextCarry, remainingRefs };
  }

  const contentWidth = page.contentBox.width;
  const opts = layoutOpts(input, noteMarks);
  const separatorKind = options?.separatorKind ?? 'separator';
  const notesPartFor = (kind: NoteKind) =>
    kind === 'footnote' ? input.footnotesPart : input.endnotesPart;
  // Separator drawn from endnotes part when placing endnote area; footnotes at sect/doc end
  // still use the endnotes-area chrome (Word draws the endnote separator for doc-end notes).
  const sepPart = input.endnotesPart ?? input.footnotesPart;
  const maxSepHeight = Math.max(0, page.contentBox.height);
  const separator = options?.separatorCache
    ? options.separatorCache.get(
        sepPart,
        separatorKind,
        contentWidth,
        'endnote',
        maxSepHeight,
        opts,
        reasons
      )
    : (() => {
        const laid = layoutNoteSeparator(
          sepPart,
          separatorKind,
          contentWidth,
          opts,
          'endnote',
          maxSepHeight
        );
        if (laid.fallbackReason) reasons.push(laid.fallbackReason);
        return laid;
      })();
  const sepHeight = separator.flowHeight;
  const bodyBottom = bodyUsedHeight(page);
  // Existing endnotes already consume room below body (merged on re-entry).
  const existingEndnoteBottom = page.endnotes
    ? Math.max(bodyBottom, page.endnotes.box.y - page.contentBox.y + page.endnotes.box.height)
    : bodyBottom;
  const usableBottom = footnoteReservedTop(page);
  const availableForNotes = Math.max(0, usableBottom - existingEndnoteBottom - sepHeight);
  // Full-column split budget also excludes the footnote reservation.
  const fullNoteColumn = Math.max(0, usableBottom - sepHeight);
  const splitOpts = { fullContentHeight: fullNoteColumn, reasons };

  const notes: NoteStoryRecord[] = [];
  let stackHeight = 0;
  let fragmentBudget = MAX_NOTE_AREA_FRAGMENTS;

  for (const [scopeId, carry] of continuationCarry) {
    const parsed = scopeId.match(/^(footnote|endnote):(-?\d+)$/);
    if (!parsed) continue;
    const noteKind = parsed[1] as NoteKind;
    const noteId = Number(parsed[2]);
    const room = Math.max(0, availableForNotes - stackHeight);
    if (carry.height <= room + 0.001) {
      notes.push({
        noteKind,
        noteId,
        scopeId,
        mark: null,
        continuation: true,
        box: { x: page.contentBox.x, y: 0, width: contentWidth, height: carry.height },
        fragments: carry.fragments,
      });
      stackHeight += carry.height;
      nextCarry.delete(scopeId);
    } else {
      const split = splitNoteFragments(
        {
          noteKind,
          noteId,
          scopeId,
          noteType: undefined,
          fragments: carry.fragments,
          flowHeight: carry.height,
        },
        room,
        splitOpts
      );
      if (split.head.length > 0) {
        notes.push({
          noteKind,
          noteId,
          scopeId,
          mark: null,
          continuation: true,
          box: { x: page.contentBox.x, y: 0, width: contentWidth, height: split.headHeight },
          fragments: split.head,
        });
        stackHeight += split.headHeight;
      }
      if (split.tail.length > 0) {
        nextCarry.set(scopeId, { fragments: split.tail, height: split.tailHeight, mark: null });
      } else {
        nextCarry.delete(scopeId);
      }
    }
  }

  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i]!;
    if (notes.length >= MAX_NOTES_LAID_OUT) {
      reasons.push('note-count-limit');
      remainingRefs.push(...refs.slice(i));
      break;
    }
    const part = notesPartFor(ref.noteKind);
    const laid = layoutNoteById(part, ref.noteId, contentWidth, opts);
    if (!laid) {
      reasons.push('missing-note-body');
      continue;
    }
    const mark = noteMarks.marks.get(noteMarkKey(ref.noteKind, ref.noteId)) ?? null;
    const room = Math.max(0, availableForNotes - stackHeight);
    fragmentBudget -= laid.fragments.length;
    if (fragmentBudget < 0) {
      reasons.push('note-area-fragment-limit');
      remainingRefs.push(...refs.slice(i));
      break;
    }
    if (laid.flowHeight <= room + 0.001) {
      notes.push({
        noteKind: ref.noteKind,
        noteId: ref.noteId,
        scopeId: laid.scopeId,
        mark: ref.customMarkFollows ? null : mark,
        box: {
          x: page.contentBox.x,
          y: 0,
          width: contentWidth,
          height: laid.flowHeight,
        },
        fragments: laid.fragments,
      });
      stackHeight += laid.flowHeight;
    } else {
      const split = splitNoteFragments(laid, room, splitOpts);
      if (split.head.length > 0) {
        notes.push({
          noteKind: ref.noteKind,
          noteId: ref.noteId,
          scopeId: laid.scopeId,
          mark: ref.customMarkFollows ? null : mark,
          box: {
            x: page.contentBox.x,
            y: 0,
            width: contentWidth,
            height: split.headHeight,
          },
          fragments: split.head,
        });
        stackHeight += split.headHeight;
      }
      if (split.tail.length > 0) {
        nextCarry.set(laid.scopeId, {
          fragments: split.tail,
          height: split.tailHeight,
          mark: null,
        });
      }
      remainingRefs.push(...refs.slice(i + 1));
      break;
    }
  }

  if (notes.length === 0 && continuationCarry.size === 0) {
    return { area: undefined, nextCarry, remainingRefs };
  }
  if (notes.length === 0) {
    return { area: undefined, nextCarry, remainingRefs };
  }

  const areaTop = page.contentBox.y + existingEndnoteBottom;
  let cursorY = areaTop + sepHeight;
  const placedNotes = notes.map((note) => {
    const placed = { ...note, box: { ...note.box, y: cursorY } };
    cursorY += note.box.height;
    return placed;
  });

  const sepBox = noteSeparatorAreaBox(separator, page.contentBox.x, contentWidth, areaTop);
  const areaHeight = sepHeight + stackHeight;
  // Hard clip: never extend into the footnote reservation.
  const maxHeight = Math.max(0, usableBottom - existingEndnoteBottom);
  const clippedHeight = Math.min(areaHeight, maxHeight);

  return {
    area: {
      kind: 'endnotes',
      placement,
      box: {
        x: page.contentBox.x,
        y: areaTop,
        width: contentWidth,
        height: clippedHeight,
      },
      separator: {
        kind: separatorKind,
        box: sepBox,
        fragments: separator.fragments,
        synthetic: separator.synthetic,
        ...(separator.ruleStyle !== undefined ? { ruleStyle: separator.ruleStyle } : {}),
      },
      notes: placedNotes,
    },
    nextCarry,
    remainingRefs,
  };
}

/** Append empty pages until footnote continuation carry is drained (bounded). */
function drainFootnoteCarryPages(
  pages: PageRecord[],
  carry: NoteCarryMap,
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  reasons: NotePaginationFallbackReason[],
  overflowBudget: NoteOverflowBudget,
  separatorCache: NoteSeparatorCache,
  mint: OverflowSheetMinter
): { pages: PageRecord[]; carry: NoteCarryMap } {
  let nextPages = pages;
  let nextCarry = carry;
  // This run appends after the last page and goes before any endnote insertion, so that page
  // is a body-pass one — the walk-back is belt and braces, and states the requirement.
  const sectionAnchorIndex = pages[originalPageAtOrBefore(pages, pages.length - 1)]!.index;
  while (nextCarry.size > 0 && overflowBudget.remaining > 0) {
    const template = nextPages[nextPages.length - 1]!;
    const page = mint({
      template,
      landingIndex: nextPages.length,
      noteStream: 'footnote-drain',
      sectionAnchorIndex,
    });
    const built = buildFootnoteArea(page, [], input, noteMarks, 'pageBottom', nextCarry, reasons, {
      separatorCache,
    });
    const notesPlaced = built.area?.notes.length ?? 0;
    nextCarry = built.nextCarry;
    // Zero-progress: separator-only / empty area while carry remains — do not mint up to
    // MAX_NOTE_OVERFLOW_PAGES blank sheets (tall-separator amplifier).
    if (notesPlaced === 0) {
      reasons.push('note-overflow-stalled');
      if (built.area) {
        nextPages = [...nextPages, { ...page, footnotes: built.area }];
        overflowBudget.remaining -= 1;
      }
      break;
    }
    nextPages = [...nextPages, { ...page, footnotes: built.area! }];
    overflowBudget.remaining -= 1;
  }
  if (nextCarry.size > 0 && !reasons.includes('note-overflow-stalled')) {
    reasons.push('note-overflow-page-limit');
  }
  return { pages: nextPages, carry: nextCarry };
}

function insertOverflowPageAt(
  pages: PageRecord[],
  insertAt: number,
  template: PageRecord,
  mint: OverflowSheetMinter,
  sectionAnchorIndex: number,
  noteStream: PageNoteStream = 'endnote-overflow'
): { pages: PageRecord[]; pageIndex: number } {
  const page = mint({ template, landingIndex: insertAt, noteStream, sectionAnchorIndex });
  const next = [...pages.slice(0, insertAt), page, ...pages.slice(insertAt)];
  // Defer reindex to attachNotesToLayout — per-insert reindex is O(overflow²).
  return { pages: next, pageIndex: insertAt };
}

/**
 * Patch section-local PAGE/SECTIONPAGES sources for pages `[start, endExclusive)` after
 * overflow sheets were inserted into that section.
 */
function patchSectionFieldSources(
  pages: PageRecord[],
  start: number,
  endExclusive: number
): PageRecord[] {
  if (endExclusive <= start || start >= pages.length) return pages;
  const end = Math.min(endExclusive, pages.length);
  const anchor = pages[start]!;
  const displayedStart = anchor.pageFieldSource?.pageNumber ?? start + 1;
  const format = anchor.pageFieldSource?.format;
  const count = end - start;
  const next = [...pages];
  for (let i = start; i < end; i += 1) {
    const page = next[i]!;
    next[i] = {
      ...page,
      pageFieldSource: {
        pageNumber: displayedStart + (i - start),
        sectionPageCount: count,
        ...(format ? { format } : {}),
      },
    };
  }
  return next;
}

/** Place collected endnotes starting at `startIndex`, creating overflow pages as needed. */
function placeEndnotesFromPage(
  pages: PageRecord[],
  startIndex: number,
  refs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  placement: 'sectEnd' | 'docEnd',
  reasons: NotePaginationFallbackReason[],
  overflowBudget: NoteOverflowBudget,
  options: {
    /**
     * Exclusive index of the first page that belongs to a later section. Overflow sheets are
     * inserted here rather than advancing into subsequent-section body pages.
     */
    readonly stopBeforeIndex?: number;
    /** First page index of the owning section (for SECTIONPAGES patching). */
    readonly sectionStartIndex?: number;
    readonly separatorCache?: NoteSeparatorCache;
    /** Mints an overflow sheet with the shell its own index resolves to. */
    readonly mint: OverflowSheetMinter;
  }
): PageRecord[] {
  if (refs.length === 0 || pages.length === 0) return pages;
  // The section comes from the nearest BODY-PASS page at or before the run's start. The start
  // itself may be a sheet an earlier run minted: `lastEndnoteHostIndex` accepts an endnote
  // overflow sheet, and that sheet's `index` is an insertion position, not a layout index.
  const sectionAnchorIndex = pages[originalPageAtOrBefore(pages, startIndex)]!.index;
  let nextPages = [...pages];
  let pending = [...refs];
  let carry: NoteCarryMap = new Map();
  let index = startIndex;
  let created = 0;
  let separatorKind: 'separator' | 'continuationSeparator' = 'separator';
  // Tracks the first later-section page as overflow sheets are inserted before it.
  let stopBefore = options?.stopBeforeIndex ?? Number.POSITIVE_INFINITY;
  const sectionStart = options?.sectionStartIndex ?? startIndex;
  const boundToSection = options?.stopBeforeIndex !== undefined;
  const separatorCache = options?.separatorCache;

  while (pending.length > 0 || carry.size > 0) {
    if (index >= nextPages.length || index >= stopBefore) {
      if (overflowBudget.remaining <= 0) {
        reasons.push('note-overflow-page-limit');
        break;
      }
      const template =
        nextPages[Math.min(Math.max(index, 1), nextPages.length) - 1] ??
        nextPages[nextPages.length - 1]!;
      const insertAt = Math.min(index, stopBefore, nextPages.length);
      const inserted = insertOverflowPageAt(
        nextPages,
        insertAt,
        template,
        options.mint,
        sectionAnchorIndex,
        'endnote-overflow'
      );
      nextPages = inserted.pages;
      index = inserted.pageIndex;
      // Later-section pages shifted right by one; keep the boundary after the new sheet.
      if (boundToSection) stopBefore = insertAt + 1;
      created += 1;
      overflowBudget.remaining -= 1;
    }
    const page = nextPages[index]!;
    // Footnote-only drain pages are never free endnote hosts — skip past the drain run
    // (still before later-section body) so overflow inserts after it.
    if (!isEndnoteHostEligible(page)) {
      index += 1;
      continue;
    }
    const built = buildEndnoteArea(page, pending, input, noteMarks, placement, carry, reasons, {
      separatorKind,
      ...(separatorCache ? { separatorCache } : {}),
    });
    carry = built.nextCarry;
    pending = built.remainingRefs;
    const notesPlaced = built.area?.notes.length ?? 0;
    if (built.area) {
      const prev = nextPages[index]!;
      nextPages[index] = {
        ...prev,
        endnotes: prev.endnotes
          ? {
              ...built.area,
              notes: [...prev.endnotes.notes, ...built.area.notes],
              box: {
                ...built.area.box,
                y: prev.endnotes.box.y,
                height: prev.endnotes.box.height + built.area.box.height,
              },
            }
          : built.area,
      };
    } else if (carry.size === 0 && pending.length === 0) {
      break;
    } else if (!built.area && carry.size === 0 && pending.length > 0) {
      // No room on this page — advance / create the next (still before later sections).
      index += 1;
      separatorKind = 'separator';
      continue;
    }
    // Empty overflow sheet that placed nothing while work remains: stall (tall separator).
    if (
      notesPlaced === 0 &&
      (carry.size > 0 || pending.length > 0) &&
      page.fragments.length === 0 &&
      page.noteStream === 'endnote-overflow'
    ) {
      reasons.push('note-overflow-stalled');
      break;
    }
    if (carry.size > 0 || pending.length > 0) {
      separatorKind = 'continuationSeparator';
      index += 1;
      continue;
    }
    break;
  }
  if (pending.length > 0 || carry.size > 0) {
    if (!reasons.includes('note-overflow-stalled')) {
      reasons.push('note-overflow-page-limit');
    }
  }

  if (boundToSection) {
    nextPages = patchSectionFieldSources(
      nextPages,
      sectionStart,
      Math.min(stopBefore, nextPages.length)
    );
  } else if (created > 0) {
    nextPages = patchSectionFieldSources(nextPages, sectionStart, nextPages.length);
  }
  return nextPages;
}

/**
 * Compute per-page bottom reserves (points) needed for footnotes given a provisional layout.
 * Used by the bounded reflow loop before final attach.
 *
 * Height is measured against a column-derived note budget (not leftover body slack). Measuring
 * from slack makes `stable` true on the first pass and never shrinks the body — references and
 * notes then compete for the same band. Oversized notes still split/continue within the budget;
 * {@link MIN_FOOTNOTE_BODY_BAND_PT} keeps a body band so reflow cannot chase blank sheets.
 */
/**
 * Reserve (pt) `bodyPage` must keep so the first line of `nextPage` stays put.
 *
 * Zero when there is nothing to hold out: no next page, the next page does not open with a
 * paragraph line, that line carries no page-bottom footnote reference, or the line and its
 * notes would fit back here (then the line SHOULD return — a deleted note must release its
 * room). A note taller than the note column is splittable and never holds out: its line may
 * legitimately return with a head. Otherwise the answer claims the page's remaining slack,
 * which reproduces the current body end exactly and gives the reflow loop its fixed point.
 */
function holdOutReserveNeed(
  bodyPage: PageRecord,
  nextPage: PageRecord | undefined,
  refIndex: PageRefIndex,
  existingAreaHeight: number,
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  separatorCache: NoteSeparatorCache,
  reasons: NotePaginationFallbackReason[]
): number {
  if (!nextPage) return 0;
  const firstBlock = bodyOnlyPage(nextPage).fragments[0];
  if (!firstBlock || firstBlock.kind !== 'paragraph') return 0;
  // Walk the opening fragment's lines to the FIRST reference-bearing one, accumulating the
  // band the pull-back would occupy. The eviction reserve names the reference's line, but
  // widow/orphan control moves its companion with it, so the reference is not necessarily
  // the very first line of the next page — and the companions can only return together.
  const pulled: PageRefHit[] = [];
  let pulledBandHeight = 0;
  let refLineHeight = 0;
  for (const line of firstBlock.lines) {
    pulledBandHeight += line.box.height;
    refLineHeight = line.box.height;
    for (const segment of lineSegments(line)) {
      const candidates = refIndex.get(segment.paragraphId);
      if (!candidates) continue;
      for (const ref of candidates) {
        if (ref.noteKind !== 'footnote') continue;
        const pos = footnotePropsFor(input, ref.sectionIndex).pos;
        if (pos === 'sectEnd' || pos === 'docEnd') continue;
        if (ref.atomOffset >= segment.start && ref.atomOffset < segment.end) pulled.push(ref);
      }
    }
    if (pulled.length > 0) break;
  }
  if (pulled.length === 0) return 0;

  const contentWidth = bodyPage.contentBox.width;
  const opts = layoutOpts(input, noteMarks);
  const separator = separatorCache.get(
    input.footnotesPart,
    'separator',
    contentWidth,
    'footnote',
    Math.max(0, bodyPage.contentBox.height),
    opts,
    reasons
  );
  const columnBudget = Math.max(
    0,
    bodyPage.contentBox.height - MIN_FOOTNOTE_BODY_BAND_PT - separator.flowHeight
  );
  let pulledNotesHeight = 0;
  for (const ref of pulled) {
    const laid = layoutNoteById(input.footnotesPart, ref.noteId, contentWidth, opts);
    if (!laid) continue;
    if (laid.flowHeight > columnBudget + 0.001) return 0;
    pulledNotesHeight += laid.flowHeight;
  }
  if (pulledNotesHeight <= 0) return 0;
  const bodyBottom = bodyUsedHeight(bodyPage);
  const areaWithPulled =
    (existingAreaHeight > 0 ? existingAreaHeight : separator.flowHeight) + pulledNotesHeight;
  // One reference-line of headroom: the split tail wraps from the split offset, so the
  // reference sits up to one line higher here than the joined re-wrap a pull-back produces.
  // Releasing on the tail's optimistic geometry re-splits the note the next round; erring
  // toward the hold keeps the note whole, which is the Word behavior this reserve encodes.
  const fits =
    bodyBottom + pulledBandHeight + refLineHeight + areaWithPulled <=
    bodyPage.contentBox.height + 0.001;
  if (fits) return 0;
  // Same half-point back-off as the eviction reserve: the last kept body line's bottom is
  // exactly `bodyBottom`, and a budget equal to it flips on float drift.
  return Math.max(0, bodyPage.contentBox.height - bodyBottom - RESERVE_BOUNDARY_BACKOFF_PT);
}

export function computeFootnoteReserves(
  layout: SemanticLayout,
  allRefs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  /** Session-carried notes memo (opaque; owned by this module). */
  passMemo?: unknown
): {
  readonly reserves: ReadonlyMap<number, number>;
  readonly stable: boolean;
  readonly reasons: readonly NotePaginationFallbackReason[];
} {
  const memo = (passMemo ?? null) as NotesPassMemo | null;
  const reserves = new Map<number, number>();
  const reasons: NotePaginationFallbackReason[] = [];
  let carry: NoteCarryMap = new Map();
  const refIndex = buildPageRefIndex(allRefs);
  const separatorCache = createNoteSeparatorCache();

  for (let pageAt = 0; pageAt < layout.pages.length; pageAt += 1) {
    const page = layout.pages[pageAt]!;
    // Strip any prior note-pass output so reserve height is body-only.
    const bodyPage = bodyOnlyPage(page);
    const pageRefs = filterRefsOnPage(bodyPage, allRefs, refIndex);
    const fnRefs = pageRefs.filter((r) => r.noteKind === 'footnote');
    // Position from first ref's section (Word uses section of the page).
    const sectionIndex = fnRefs[0]?.sectionIndex ?? 0;
    const props = footnotePropsFor(input, sectionIndex);
    if (props.pos === 'sectEnd' || props.pos === 'docEnd') {
      // No per-page reservation — collected later.
      continue;
    }

    const nextPage = layout.pages[pageAt + 1];
    // An unchanged page whose refs and marks are the previous pass's exact objects sized
    // to the same reserve; carry chains are the exception and rebuild.
    if (memo && carry.size === 0) {
      const cached = memo.pageReserve.get(page);
      if (
        cached &&
        cached.allHits === allRefs &&
        cached.marks === noteMarks &&
        cached.nextFragments === (nextPage ? nextPage.fragments : null)
      ) {
        for (const reason of cached.reasons) reasons.push(reason);
        if (cached.reserve > 0) {
          reserves.set(page.index, Math.max(reserves.get(page.index) ?? 0, cached.reserve));
        }
        continue;
      }
    }

    // Column budget for the note stack (separator is added inside buildFootnoteArea).
    // Each reference keeps the body band down to ITS OWN line (Word starts a footnote on
    // the page that references it): a reserve that ignores the reference evicts its own
    // line to the next page, and the reflow loop then oscillates between the two
    // placements — reference pages with zero note height, later pages holding a
    // reservation nothing fills. Per reference and never the page's lowest one, whose
    // floor would stably strangle every note above it on a multi-reference page.
    const maxArea = Math.max(0, bodyPage.contentBox.height - MIN_FOOTNOTE_BODY_BAND_PT);

    const carryWasEmpty = carry.size === 0;
    const reasonsBefore = reasons.length;
    const { area, nextCarry, evictionTopPt } = buildFootnoteArea(
      bodyPage,
      fnRefs,
      input,
      noteMarks,
      props.pos,
      carry,
      reasons,
      {
        reserveColumnBudget: true,
        reserveBandOf: (ref) => noteReferenceLineBandPt(bodyPage, ref),
        separatorCache,
      }
    );
    carry = nextCarry;
    // An eviction reaches past the note stack to the unplaceable reference's own line, so
    // the body pass pushes that line — and the reference — to the next page. The eviction
    // top sits below the minimum body band by construction, so the cap holds either way.
    // Backed off by half a point so the body budget lands MID-line: edge-to-edge the
    // previous line's bottom equals the budget exactly, the body pass's strict compare
    // flips on float drift, and an extra evicted line rewraps the tail into geometry the
    // next round cannot reproduce.
    const evictionNeed =
      evictionTopPt !== undefined
        ? Math.max(0, bodyPage.contentBox.height - evictionTopPt - RESERVE_BOUNDARY_BACKOFF_PT)
        : 0;
    // Hold-out: the fixed point of an eviction. Once the body pass has pushed a reference
    // line forward, THIS page's recomputed reserve no longer sees that reference — the
    // note-stack height alone under-claims, the next round pulls the line back, and the
    // loop orbits the two placements forever. When the next page OPENS with a reference
    // whose note cannot return here, this page's assignment is final under Word's rule
    // (the note stays whole with its reference), so the reserve claims the remaining
    // slack and reproduces itself round over round.
    const holdOutNeed = holdOutReserveNeed(
      bodyPage,
      nextPage,
      refIndex,
      area?.box.height ?? 0,
      input,
      noteMarks,
      separatorCache,
      reasons
    );
    const needed = Math.min(Math.max(area?.box.height ?? 0, evictionNeed, holdOutNeed), maxArea);
    if (memo && carryWasEmpty && carry.size === 0) {
      memo.pageReserve.set(page, {
        allHits: allRefs,
        marks: noteMarks,
        reserve: needed > 0 ? needed : 0,
        reasons: reasons.slice(reasonsBefore),
        nextFragments: nextPage ? nextPage.fragments : null,
      });
    }
    // Omit zero entries so a page the citation left does not linger as `0` in the map
    // (convergence compares maps by key set, and body layout treats missing as zero).
    if (needed > 0) {
      const prev = reserves.get(page.index) ?? 0;
      reserves.set(page.index, Math.max(prev, needed));
    }
  }

  // Stable only when the body has already left enough room for the measured reserve.
  // (Needed heights are no longer slack-clipped, so a full-body first pass is unstable.)
  let stable = true;
  for (const page of layout.pages) {
    const needed = reserves.get(page.index) ?? 0;
    if (needed <= 0) continue;
    const used = bodyUsedHeight(bodyOnlyPage(page));
    if (used + needed > page.contentBox.height + 0.5) {
      stable = false;
      break;
    }
  }
  return { reserves, stable, reasons };
}

/**
 * Attach footnote/endnote areas onto a body layout. Does not re-paginate — callers that
 * need reservation must re-run body layout with {@link pageBottomReserves} first.
 */
export function attachNotesToLayout(
  layout: SemanticLayout,
  allRefs: readonly PageRefHit[],
  input: NotesLayoutInput,
  options?: {
    readonly fallbackReasons?: readonly NotePaginationFallbackReason[];
    readonly paragraphSectionIndex?: ReadonlyMap<string, number>;
    /**
     * Session-carried notes memo, already validated against `allRefs` and `input`.
     * Opaque at this boundary; the shape is owned by this module.
     */
    readonly memo?: unknown;
  }
): NotesAttachResult {
  const memo = (options?.memo ?? null) as NotesPassMemo | null;
  const reasons: NotePaginationFallbackReason[] = [...(options?.fallbackReasons ?? [])];
  const paragraphSectionIndex = options?.paragraphSectionIndex ?? new Map<string, number>();
  const overflowBudget: NoteOverflowBudget = { remaining: MAX_NOTE_OVERFLOW_PAGES };
  const refIndex = buildPageRefIndex(allRefs);
  const separatorCache = createNoteSeparatorCache();
  // An overflow sheet resolves the shell its OWN index gets, not the one it was cloned from.
  const mint = createOverflowSheetMinter(layout);

  // Build sites for mark derivation (page index from layout).
  const footnoteSites: NoteReferenceSite[] = [];
  const endnoteSites: NoteReferenceSite[] = [];
  for (const page of layout.pages) {
    for (const ref of filterRefsOnPage(page, allRefs, refIndex)) {
      const site: NoteReferenceSite = {
        noteId: ref.noteId,
        sectionIndex: ref.sectionIndex,
        pageIndex: page.index,
        customMarkFollows: ref.customMarkFollows,
      };
      if (ref.noteKind === 'footnote') footnoteSites.push(site);
      else endnoteSites.push(site);
    }
  }

  // FINAL marks reuse by identity: the sites fingerprint covers note ids, sections, page
  // assignment and custom-mark flags, so an equal fingerprint under a live memo (whose
  // lifetime already pins the input) means an identical context.
  const sitesFingerprint = memo
    ? [...footnoteSites, ...endnoteSites]
        .map(
          (site) =>
            `${site.noteId}|${site.sectionIndex}|${site.pageIndex ?? ''}|${site.customMarkFollows ? 1 : 0}`
        )
        .join(';')
    : '';
  let noteMarks: NoteMarkContext;
  if (memo && memo.finalMarks && memo.finalMarks.sitesFingerprint === sitesFingerprint) {
    noteMarks = memo.finalMarks.marks;
  } else {
    noteMarks = buildMarkContext(footnoteSites, endnoteSites, input);
    if (memo) memo.finalMarks = { sitesFingerprint, marks: noteMarks };
  }

  let carry: NoteCarryMap = new Map();
  const endnotesBySection = new Map<number, PageRefHit[]>();
  const endnotesDoc: PageRefHit[] = [];

  let pages: PageRecord[] = layout.pages.map((page) => {
    const pageRefs = filterRefsOnPage(page, allRefs, refIndex);
    const fnRefs = pageRefs.filter((r) => r.noteKind === 'footnote');
    const enRefs = pageRefs.filter((r) => r.noteKind === 'endnote');

    for (const ref of enRefs) {
      const props = endnotePropsFor(input, ref.sectionIndex);
      if (props.pos === 'sectEnd') {
        const list = endnotesBySection.get(ref.sectionIndex) ?? [];
        list.push(ref);
        endnotesBySection.set(ref.sectionIndex, list);
      } else {
        endnotesDoc.push(ref);
      }
    }

    // Footnotes that collect at sect/doc end join the endnote-style collectors.
    for (const ref of fnRefs) {
      const props = footnotePropsFor(input, ref.sectionIndex);
      if (props.pos === 'sectEnd') {
        const list = endnotesBySection.get(ref.sectionIndex) ?? [];
        list.push(ref);
        endnotesBySection.set(ref.sectionIndex, list);
      } else if (props.pos === 'docEnd') {
        endnotesDoc.push(ref);
      }
    }

    // An unchanged page attaches to the same result as last pass when the hit array and
    // mark context are the previous pass's exact objects and no continuation chains in or
    // out of it. The endnote collectors above already ran, so skipping the build here
    // loses nothing.
    if (memo && carry.size === 0) {
      const cached = memo.pageAttach.get(page);
      if (cached && cached.allHits === allRefs && cached.marks === noteMarks) {
        for (const reason of cached.reasons) reasons.push(reason);
        return cached.attached;
      }
    }

    const bodyPage = bodyOnlyPage(page);
    const sectionIndex = fnRefs[0]?.sectionIndex ?? 0;
    const props = footnotePropsFor(input, sectionIndex);
    let footnotes: NoteAreaRecord | undefined;
    const carryWasEmpty = carry.size === 0;
    const reasonsBefore = reasons.length;
    if (props.pos === 'pageBottom' || props.pos === 'beneathText') {
      const pageBottomRefs = fnRefs.filter((ref) => {
        const pos = footnotePropsFor(input, ref.sectionIndex).pos;
        return pos === 'pageBottom' || pos === 'beneathText';
      });
      const built = buildFootnoteArea(
        bodyPage,
        pageBottomRefs,
        input,
        noteMarks,
        props.pos,
        carry,
        reasons,
        { separatorCache }
      );
      footnotes = built.area;
      carry = built.nextCarry;
    }

    // Same rule one level up: a page with no footnote area and nothing to strip is the page
    // it came in as, and saying so is what lets the painter keep its DOM.
    const attached = footnotes ? { ...bodyPage, footnotes } : bodyPage;
    if (memo && carryWasEmpty && carry.size === 0) {
      memo.pageAttach.set(page, {
        allHits: allRefs,
        marks: noteMarks,
        attached,
        reserve: 0,
        reasons: reasons.slice(reasonsBefore),
      });
    }
    return attached;
  });

  const pageCountBeforeOverflow = pages.length;

  // Drain footnote continuations that outlive the final body page.
  //
  // BEFORE the section loop, because that is the document order: footnote continuation belongs
  // to the section's running content, and its `sectEnd` endnotes come after all of it. Moving
  // this after the loop put a last section's endnote sheets in front of its own continuation.
  //
  // The cost is that an earlier section's insertion slides these sheets along after they were
  // minted, so the shell each resolved no longer describes where it sits. `resettleMintedSheets`
  // below re-resolves them once every insertion is done.
  if (carry.size > 0) {
    const drained = drainFootnoteCarryPages(
      pages,
      carry,
      input,
      noteMarks,
      reasons,
      overflowBudget,
      separatorCache,
      mint
    );
    pages = drained.pages;
    carry = drained.carry;
  }

  // Place sectEnd notes on the true last page of each section (body fragment ownership),
  // inserting overflow sheets before the next section rather than advancing into it.
  if (endnotesBySection.size > 0 && pages.length > 0) {
    // Process sections in ascending order so later stopBefore indexes stay valid as we insert.
    const sectionIndexes = [...endnotesBySection.keys()].sort((a, b) => a - b);
    for (const sectionIndex of sectionIndexes) {
      const refs = endnotesBySection.get(sectionIndex)!;
      const lastIdx = lastPageIndexForSection(pages, sectionIndex, paragraphSectionIndex);
      const stopBefore = sectionEndInsertBound(pages, sectionIndex, paragraphSectionIndex);
      let sectionStart = lastIdx;
      for (let i = 0; i <= lastIdx; i += 1) {
        if (pageBodySectionIndexes(pages[i]!, paragraphSectionIndex).includes(sectionIndex)) {
          sectionStart = i;
          break;
        }
      }
      pages = placeEndnotesFromPage(
        pages,
        lastIdx,
        refs,
        input,
        noteMarks,
        'sectEnd',
        reasons,
        overflowBudget,
        {
          stopBeforeIndex: stopBefore,
          sectionStartIndex: sectionStart,
          separatorCache,
          mint,
        }
      );
    }
  }

  if (endnotesDoc.length > 0 && pages.length > 0) {
    // Start on the last eligible host (body / endnote overflow), never the final
    // footnote-drain sheet — room above footnotes on the last body page is fair game.
    pages = placeEndnotesFromPage(
      pages,
      lastEndnoteHostIndex(pages),
      endnotesDoc,
      input,
      noteMarks,
      'docEnd',
      reasons,
      overflowBudget,
      { separatorCache, mint }
    );
  }

  if (pages.length !== pageCountBeforeOverflow) {
    // Every insertion is done, so a minted sheet's array position is the page index it keeps.
    pages = resettleMintedSheets(pages, layout);
    pages = reindexAndFinalizeFields(pages);
  }

  // Body was laid with provisional marks; publish page-aware citation digits without reflow.
  const withBodyMarks = reprojectBodyNoteMarks({ revision: layout.revision, pages }, noteMarks);

  return {
    layout: withBodyMarks,
    fallbackReasons: reasons,
    noteMarks,
  };
}

/** Body-story note references only (HF / nested notes are round-tripped, not laid out). */
function collectBodyNoteReferences(part: OoxmlPart): readonly {
  readonly noteKind: NoteKind;
  readonly noteId: number;
  readonly paragraphId: string;
  readonly atomOffset: number;
  readonly customMarkFollows: boolean;
}[] {
  return collectNoteReferences(part).map((hit) => ({
    noteKind: hit.noteKind,
    noteId: hit.noteId,
    paragraphId: hit.paragraphId,
    atomOffset: hit.atomOffset,
    customMarkFollows: hit.customMarkFollows,
  }));
}

/**
 * The retained previous answer per SESSION, content-validated. The map is a pure function of
 * the section bounds plus each block's paragraph-id list, and a keystroke changes NEITHER —
 * it replaces one block with a twin carrying the same ids. Rebuilding 10k+ map entries per
 * keystroke cost more than the lookups the map serves, so the previous answer is kept and
 * revalidated by identity-diffing the block lists: blocks that changed identity must still
 * contribute the same ids, or the map rebuilds.
 *
 * Keyed weakly on the caller's session object — NOT a module slot — so a disposed editor's
 * block list and id map die with its session instead of staying pinned until some other
 * document lays out, and two live editors do not thrash one slot. A call without a session
 * has no incremental pass to serve and builds fresh.
 */
interface ParagraphSectionIndexMemo {
  blocks: readonly OoxmlElement[];
  boundsFingerprint: string;
  map: ReadonlyMap<string, number>;
}

const paragraphSectionIndexMemos = new WeakMap<object, ParagraphSectionIndexMemo>();

function sectionBoundsFingerprint(
  sections: readonly DocumentSection[],
  displayMode: RevisionDisplayMode
): string {
  return `${displayMode};${sections.map((section) => `${section.blockStart}-${section.blockEndExclusive}`).join(',')}`;
}

function blockParagraphIdsEqual(next: OoxmlElement, previous: OoxmlElement): boolean {
  if (next.kind !== previous.kind) return false;
  if (next.kind === 'paragraph') return next.id === previous.id;
  const nextIds = tableParagraphIdsOf(next);
  const previousIds = tableParagraphIdsOf(previous);
  if (nextIds.length !== previousIds.length) return false;
  for (let index = 0; index < nextIds.length; index += 1) {
    if (nextIds[index] !== previousIds[index]) return false;
  }
  return true;
}

/** Map paragraph id → section index for note numbering / position resolution. */
function paragraphSectionIndexOf(
  part: OoxmlPart,
  sections: readonly DocumentSection[],
  displayMode: RevisionDisplayMode,
  /** The caller's layout session, as the memo's weak key; absent means no reuse. */
  memoHost?: object
): ReadonlyMap<string, number> {
  // IN THE SAME MODE the section bounds were counted in. `blockStart`/`blockEndExclusive`
  // index a mode-filtered block list, and a resolved view has fewer blocks — a paragraph a
  // tracked mark merged away is gone from it. Indexing an All Markup list with those bounds
  // put paragraphs in the wrong section, which renumbers a footnote in a section nobody
  // edited.
  const blocks = storyBlocks(part, displayMode);
  const boundsFingerprint = sectionBoundsFingerprint(sections, displayMode);
  const memo = memoHost ? paragraphSectionIndexMemos.get(memoHost) : undefined;
  if (
    memo &&
    memo.boundsFingerprint === boundsFingerprint &&
    memo.blocks.length === blocks.length
  ) {
    let reusable = true;
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]!;
      const previous = memo.blocks[index]!;
      if (block === previous) continue;
      if (!blockParagraphIdsEqual(block, previous)) {
        reusable = false;
        break;
      }
    }
    if (reusable) {
      // Re-anchor on the fresh list so the next keystroke diffs against it, not a stale one.
      memo.blocks = blocks;
      return memo.map;
    }
  }
  const map = new Map<string, number>();
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]!;
    for (let i = section.blockStart; i < section.blockEndExclusive; i += 1) {
      const block = blocks[i];
      if (!block) continue;
      if (block.kind === 'paragraph') {
        map.set(block.id, sectionIndex);
        continue;
      }
      // Tables: nested paragraph ids memoized per immutable table node, so this per-pass
      // index re-walks only tables an edit replaced.
      for (const id of tableParagraphIdsOf(block)) map.set(id, sectionIndex);
    }
  }
  if (memoHost) paragraphSectionIndexMemos.set(memoHost, { blocks, boundsFingerprint, map });
  return map;
}

const tableParagraphIdMemos = new WeakMap<OoxmlNode, readonly string[]>();

function tableParagraphIdsOf(table: OoxmlNode): readonly string[] {
  const cached = tableParagraphIdMemos.get(table);
  if (cached) return cached;
  const ids: string[] = [];
  const walk = (node: OoxmlNode, depth: number): void => {
    if (depth > 32) return;
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      ids.push(node.id);
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(table, 0);
  tableParagraphIdMemos.set(table, ids);
  return ids;
}

// Reserve-map algebra (context key, compact/equal/grow/fingerprint) lives in
// note-reserves.ts; the context key re-exports below so existing import sites hold.

/**
 * Notes path: provisional marks → body layout → reserve → bounded reflow → attach.
 * `runBody` is the coordinator's body layout pass (single- or multi-section).
 *
 * Convergence requires the body to have been laid out with exactly the reserves still
 * needed. Every pass adopts the freshly computed map (stale entries drop with it); a
 * revisited reserve fingerprint means a true placement cycle and fails closed via a
 * one-shot grow envelope so the loop cannot oscillate. The attempt cap can end a
 * reference-dense document short of the fixed point; the session seeds the next pass
 * with the last adopted map, so iteration continues across passes instead of restarting,
 * bounded by {@link MAX_NOTE_REFLOW_ADOPTIONS_PER_STATE} per body-part identity — after
 * which the memo's settled answer republishes and an unchanged document stops moving.
 *
 * Reserves seed from {@link LayoutSession.notePageBottomReserves} so a warm session's
 * first body pass already carries the prior published reserve set (and its context key).
 * Reflow keeps the session: a changed reserve set changes the layout context, so resume
 * falls through to a full pass without discarding the caller's session write-back.
 */
export function layoutSemanticDocumentWithNotes<
  Opts extends {
    noteMarks?: NoteMarkContext;
    pageBottomReserves?: ReadonlyMap<number, number>;
    session?: {
      previous: SemanticLayout | null;
      multi: unknown;
      notes: unknown;
      notePageBottomReserves?: ReadonlyMap<number, number> | null;
    };
  },
>(
  part: OoxmlPart,
  sections: readonly DocumentSection[],
  optionsWithLists: Opts,
  notesInput: NotesLayoutInput,
  runBody: (opts: Opts) => SemanticLayout
): SemanticLayout {
  const packageRefs = collectBodyNoteReferences(part);
  if (packageRefs.length === 0) {
    if (optionsWithLists.session) {
      optionsWithLists.session.notes = null;
      optionsWithLists.session.notePageBottomReserves = null;
    }
    return runBody({
      ...optionsWithLists,
      noteMarks: undefined,
      pageBottomReserves: undefined,
    });
  }
  const paragraphSectionIndex = paragraphSectionIndexOf(
    part,
    sections,
    (optionsWithLists as { displayMode?: RevisionDisplayMode }).displayMode ??
      DEFAULT_REVISION_DISPLAY_MODE,
    optionsWithLists.session
  );
  const builtHits = buildPageRefHits(packageRefs, paragraphSectionIndex);
  // The session memo hands back the PREVIOUS pass's hit array and provisional marks by
  // identity when their content is unchanged, which is what lets every per-page result
  // below validate with two identity compares.
  const notesMemoState = notesMemoFor(optionsWithLists.session, builtHits, notesInput);
  const notesMemo = notesMemoState.memo;
  const allHits = notesMemoState.allHits;
  const noteMarks = notesMemo?.provisionalMarks ?? provisionalNoteMarks(allHits, notesInput);
  const seeded = optionsWithLists.session?.notePageBottomReserves;
  let usedReserves: ReadonlyMap<number, number> = seeded
    ? compactFootnoteReserves(seeded)
    : new Map();
  let fallbackReasons: NotePaginationFallbackReason[] = [];
  let bodyLayout: SemanticLayout = runBody({
    ...optionsWithLists,
    noteMarks,
    pageBottomReserves: usedReserves,
  });
  const seedFingerprint = footnoteReservesFingerprint(usedReserves);
  // An unchanged document seeded with the answer it settled on republishes it: the loop
  // below exists to find reserves for a NEW document state, and re-running it on the same
  // one can only flap a fixed-point-free document between the page counts of its orbit.
  const settled =
    notesMemoState.reused &&
    notesMemo?.settledReserves &&
    notesMemo.settledReserves.part === part &&
    notesMemo.settledReserves.fingerprint === seedFingerprint
      ? notesMemo.settledReserves
      : null;
  if (settled) {
    fallbackReasons = [...settled.reasons];
  } else {
    const appliedFingerprints = new Set<string>([seedFingerprint]);
    // Adoption budget for this body-part identity, carried across session passes so the
    // iteration continues where the previous pass stopped instead of restarting.
    const spent =
      notesMemo && notesMemo.reflowSpent && notesMemo.reflowSpent.part === part
        ? notesMemo.reflowSpent
        : { part, adopted: 0 };
    if (notesMemo) notesMemo.reflowSpent = spent;
    let adoptedThisPass = 0;

    for (let attempt = 0; attempt < MAX_NOTE_REFLOW_ATTEMPTS; attempt += 1) {
      const computed = computeFootnoteReserves(
        bodyLayout,
        allHits,
        notesInput,
        noteMarks,
        notesMemo
      );
      fallbackReasons = [...computed.reasons];
      // Published pages must reflect the reserves used to produce them — not a later map.
      if (computed.stable && footnoteReservesEqual(computed.reserves, usedReserves)) {
        break;
      }
      if (spent.adopted >= MAX_NOTE_REFLOW_ADOPTIONS_PER_STATE) {
        fallbackReasons.push('note-reflow-exhausted');
        break;
      }

      // Adopt the computed map EVERY round — never union it with the previous one.
      // Reserves shift references forward, so consecutive rounds put the same note's
      // reserve at different page slots; a monotonic union keeps every slot any round
      // ever wanted, and on reference-dense documents the map only grows until the
      // attempt cap freezes a layout reserved at several times the notes' true height —
      // runs of near-empty pages whose reservation nothing fills. Plain adoption is a
      // fixed-point iteration whose settled prefix extends forward each round; an
      // unconverged tail under-fills a page or two near the frontier, which the next
      // (seeded) pass continues to repair, instead of over-reserving everywhere.
      let next = compactFootnoteReserves(computed.reserves);

      if (footnoteReservesEqual(next, usedReserves)) {
        fallbackReasons.push('note-reflow-exhausted');
        break;
      }

      const nextFp = footnoteReservesFingerprint(next);
      if (appliedFingerprints.has(nextFp)) {
        // Shrink↔grow cycle — lock to the monotonic envelope; stop if that is not new.
        next = growFootnoteReserves(usedReserves, computed.reserves);
        const envelopeFp = footnoteReservesFingerprint(next);
        if (footnoteReservesEqual(next, usedReserves) || appliedFingerprints.has(envelopeFp)) {
          fallbackReasons.push('note-reflow-exhausted');
          break;
        }
      }

      usedReserves = next;
      appliedFingerprints.add(footnoteReservesFingerprint(usedReserves));
      spent.adopted += 1;
      adoptedThisPass += 1;
      // Keep the caller's session: reserve changes alter the layout context key, so
      // checkpoints from a different reserve set are not resumed — they are replaced.
      bodyLayout = runBody({
        ...optionsWithLists,
        noteMarks,
        pageBottomReserves: usedReserves,
      });
      if (attempt === MAX_NOTE_REFLOW_ATTEMPTS - 1) {
        fallbackReasons.push('note-reflow-exhausted');
      }
    }

    // A pass that adopted nothing changed nothing — converged, computed==used, or an
    // immediate cycle — and a spent budget means the search is over either way. Record
    // the answer so later passes over this part republish instead of re-searching.
    if (
      notesMemo &&
      (adoptedThisPass === 0 || spent.adopted >= MAX_NOTE_REFLOW_ADOPTIONS_PER_STATE)
    ) {
      notesMemo.settledReserves = {
        part,
        fingerprint: footnoteReservesFingerprint(usedReserves),
        reasons: [...fallbackReasons],
      };
    }
  }

  const attached = attachNotesToLayout(bodyLayout, allHits, notesInput, {
    fallbackReasons,
    paragraphSectionIndex,
    memo: notesMemo,
  });
  if (optionsWithLists.session) {
    optionsWithLists.session.previous = attached.layout;
    optionsWithLists.session.notePageBottomReserves = compactFootnoteReserves(usedReserves);
  }
  return attached.layout;
}

/**
 * Build a continuous (pre-page) mark context for the first body layout pass.
 * eachPage reserves digit width; {@link reprojectBodyNoteMarks} publishes final marks
 * onto body citations after page assignment in {@link attachNotesToLayout}.
 */
export function provisionalNoteMarks(
  refs: readonly PageRefHit[],
  input: NotesLayoutInput
): NoteMarkContext {
  const footnoteSites: NoteReferenceSite[] = [];
  const endnoteSites: NoteReferenceSite[] = [];
  for (const ref of refs) {
    const site: NoteReferenceSite = {
      noteId: ref.noteId,
      sectionIndex: ref.sectionIndex,
      customMarkFollows: ref.customMarkFollows,
    };
    if (ref.noteKind === 'footnote') footnoteSites.push(site);
    else endnoteSites.push(site);
  }
  return buildMarkContext(footnoteSites, endnoteSites, input);
}

/**
 * Note stories run the same paragraph walk as the body, so they inherit the body's link
 * projector seams and document properties unless the notes input pinned its own — without which
 * a `w:hyperlink`, HYPERLINK field, or document-property field in a footnote painted as dead or
 * blank text while the body's twin resolved.
 */
export function inheritNotesLayoutInput(
  notes: NotesLayoutInput,
  body: {
    readonly projectLink?: NotesLayoutInput['projectLink'];
    readonly projectFieldLink?: NotesLayoutInput['projectFieldLink'];
    readonly documentProperties?: NotesLayoutInput['documentProperties'];
    readonly refFields?: NotesLayoutInput['refFields'];
  }
): NotesLayoutInput {
  const projectLink = notes.projectLink ?? body.projectLink;
  const projectFieldLink = notes.projectFieldLink ?? body.projectFieldLink;
  const documentProperties = notes.documentProperties ?? body.documentProperties;
  const refFields = notes.refFields ?? body.refFields;
  return {
    ...notes,
    ...(projectLink ? { projectLink } : {}),
    ...(projectFieldLink ? { projectFieldLink } : {}),
    ...(documentProperties ? { documentProperties } : {}),
    ...(refFields ? { refFields } : {}),
  };
}

export {
  resolveFootnoteProperties,
  resolveEndnoteProperties,
  formatNoteScopeId,
  noteReferenceKindOf,
  noteIdOf,
  customMarkFollows,
  noteDisplayMarkMap,
};
