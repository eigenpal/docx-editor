/* eslint-disable max-lines -- note pagination seam: reservation, continuation, overflow pages */

// Footnote / endnote pagination: reservation, split/continuation, sect/doc end collection.
//
// Body flow places references; this module lays referenced notes at content width, reserves
// separator+note area (pageBottom / beneathText), bounds the reflow loop, and attaches
// layout-owned note records. Endnotes reserve nothing on reference pages — they collect at
// sectEnd / docEnd. Hostile counts and oscillation fail closed with named reasons.

import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { fragmentOwnsPosition, fragmentParagraphs } from './line-segments.ts';
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
import type {
  BlockFragmentRecord,
  LineRecord,
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
import { DEFAULT_REVISION_DISPLAY_MODE, type RevisionDisplayMode } from './revision-projection.ts';

/** Bound on reflow attempts per document layout pass. */
export const MAX_NOTE_REFLOW_ATTEMPTS = 8;

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
   * Inline drawing support per notes part. Absent means note paragraphs flow without
   * drawing records, which is what a headless caller with no image port wants.
   */
  readonly drawingsForPart?: (ownerPartName: string) => NoteStoryDrawings | undefined;
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

function paragraphFragmentsOfBlocks(
  blocks: readonly BlockFragmentRecord[]
): ParagraphFragmentRecord[] {
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
  return found;
}

/** Paragraph-id → refs index for linear {@link filterRefsOnPage} over a layout pass. */
export type PageRefIndex = ReadonlyMap<string, readonly PageRefHit[]>;

/** Build a reusable paragraph-id index (document order preserved per paragraph). */
export function buildPageRefIndex(allRefs: readonly PageRefHit[]): PageRefIndex {
  const map = new Map<string, PageRefHit[]>();
  for (const ref of allRefs) {
    const list = map.get(ref.paragraphId);
    if (list) list.push(ref);
    else map.set(ref.paragraphId, [ref]);
  }
  return map;
}

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
    defaultTabStopPt: input.defaultTabStopPt,
    projectLink: input.projectLink,
    projectFieldLink: input.projectFieldLink,
    documentProperties: input.documentProperties,
    noteMarks,
    drawingsForPart: input.drawingsForPart,
  };
}

function shiftParagraphFragment(
  fragment: ParagraphFragmentRecord,
  dy: number
): ParagraphFragmentRecord {
  if (dy === 0) return fragment;
  return {
    ...fragment,
    box: { ...fragment.box, y: fragment.box.y + dy },
    ...(fragment.shadingBox
      ? { shadingBox: { ...fragment.shadingBox, y: fragment.shadingBox.y + dy } }
      : {}),
    ...(fragment.bottomBorder
      ? {
          bottomBorder: {
            ...fragment.bottomBorder,
            box: { ...fragment.bottomBorder.box, y: fragment.bottomBorder.box.y + dy },
          },
        }
      : {}),
    ...(fragment.borders
      ? {
          borders: fragment.borders.map((stroke) => ({
            ...stroke,
            box: { ...stroke.box, y: stroke.box.y + dy },
          })),
        }
      : {}),
    ...(fragment.marker
      ? {
          marker: {
            ...fragment.marker,
            box: { ...fragment.marker.box, y: fragment.marker.box.y + dy },
          },
        }
      : {}),
    lines: fragment.lines.map((line) => ({
      ...line,
      box: { ...line.box, y: line.box.y + dy },
      spans: line.spans.map((span) => ({
        ...span,
        box: { ...span.box, y: span.box.y + dy },
      })),
    })),
  };
}

function shiftFragments(
  fragments: readonly BlockFragmentRecord[],
  dy: number
): BlockFragmentRecord[] {
  if (dy === 0) return [...fragments];
  return fragments.map((fragment) => {
    if (fragment.kind === 'paragraph') return shiftParagraphFragment(fragment, dy);
    return {
      ...fragment,
      box: { ...fragment.box, y: fragment.box.y + dy },
    };
  });
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

function fragmentFlowBottom(fragments: readonly BlockFragmentRecord[]): number {
  let bottom = 0;
  for (const fragment of fragments) {
    bottom = Math.max(bottom, fragment.box.y + fragment.box.height);
  }
  return bottom;
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

function bodyUsedHeight(page: PageRecord): number {
  let bottom = 0;
  for (const fragment of page.fragments) {
    bottom = Math.max(bottom, fragment.box.y + fragment.box.height);
  }
  return bottom;
}

/** Remove note-pass output before recomputing it from canonical references. */
function bodyOnlyPage(page: PageRecord): PageRecord {
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
    const fragments = reprojectBodyBlocks(page.fragments, noteMarks);
    if (fragments === page.fragments) return page;
    anyPageChanged = true;
    return { ...page, fragments };
  });
  return anyPageChanged ? { revision: layout.revision, pages } : layout;
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
    readonly separatorCache?: NoteSeparatorCache;
  }
): { area: NoteAreaRecord | undefined; nextCarry: NoteCarryMap } {
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
    const room = Math.max(0, availableForNotes - stackHeight);
    fragmentBudget -= laid.fragments.length;
    if (fragmentBudget < 0) {
      reasons.push('note-area-fragment-limit');
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
    return { area: undefined, nextCarry };
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
  return { area, nextCarry };
}

function cloneEmptyOverflowPage(
  template: PageRecord,
  index: number,
  noteStream?: PageNoteStream
): PageRecord {
  return {
    id: `page-${index}`,
    index,
    box: template.box,
    contentBox: template.contentBox,
    fragments: [],
    ...(noteStream ? { noteStream } : {}),
    ...(template.header ? { header: template.header } : {}),
    ...(template.footer ? { footer: template.footer } : {}),
    ...(template.pageFieldSource
      ? {
          pageFieldSource: {
            ...template.pageFieldSource,
            pageNumber: template.pageFieldSource.pageNumber + (index - template.index),
          },
        }
      : {}),
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

function reindexPages(pages: readonly PageRecord[]): PageRecord[] {
  return pages.map((page, index) => {
    if (page.index === index && page.id === `page-${index}`) return page;
    return { ...page, id: `page-${index}`, index };
  });
}

/**
 * After note overflow insertion, reindex sheets and re-project allowlisted PAGE fields.
 * Inserted overflow pages already carry a `pageFieldSource` cloned from the section template;
 * document-level NUMPAGES and furniture text need finalize against the new page count.
 */
function reindexAndFinalizeFields(pages: readonly PageRecord[]): PageRecord[] {
  const reindexed = reindexPages(pages);
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
  separatorCache: NoteSeparatorCache
): { pages: PageRecord[]; carry: NoteCarryMap } {
  let nextPages = pages;
  let nextCarry = carry;
  while (nextCarry.size > 0 && overflowBudget.remaining > 0) {
    const template = nextPages[nextPages.length - 1]!;
    const page = cloneEmptyOverflowPage(template, template.index + 1, 'footnote-drain');
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
  noteStream: PageNoteStream = 'endnote-overflow'
): { pages: PageRecord[]; pageIndex: number } {
  const page = cloneEmptyOverflowPage(template, insertAt, noteStream);
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
  options?: {
    /**
     * Exclusive index of the first page that belongs to a later section. Overflow sheets are
     * inserted here rather than advancing into subsequent-section body pages.
     */
    readonly stopBeforeIndex?: number;
    /** First page index of the owning section (for SECTIONPAGES patching). */
    readonly sectionStartIndex?: number;
    readonly separatorCache?: NoteSeparatorCache;
  }
): PageRecord[] {
  if (refs.length === 0 || pages.length === 0) return pages;
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
      const inserted = insertOverflowPageAt(nextPages, insertAt, template, 'endnote-overflow');
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
export function computeFootnoteReserves(
  layout: SemanticLayout,
  allRefs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext
): {
  readonly reserves: ReadonlyMap<number, number>;
  readonly stable: boolean;
  readonly reasons: readonly NotePaginationFallbackReason[];
} {
  const reserves = new Map<number, number>();
  const reasons: NotePaginationFallbackReason[] = [];
  let carry: NoteCarryMap = new Map();
  const refIndex = buildPageRefIndex(allRefs);
  const separatorCache = createNoteSeparatorCache();

  for (const page of layout.pages) {
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

    // Column budget for the note stack (separator is added inside buildFootnoteArea).
    // Cap so body retains MIN_FOOTNOTE_BODY_BAND_PT for a referencing line to land.
    const maxArea = Math.max(0, bodyPage.contentBox.height - MIN_FOOTNOTE_BODY_BAND_PT);

    const { area, nextCarry } = buildFootnoteArea(
      bodyPage,
      fnRefs,
      input,
      noteMarks,
      props.pos,
      carry,
      reasons,
      { reserveColumnBudget: true, separatorCache }
    );
    carry = nextCarry;
    const needed = Math.min(area?.box.height ?? 0, maxArea);
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
  }
): NotesAttachResult {
  const reasons: NotePaginationFallbackReason[] = [...(options?.fallbackReasons ?? [])];
  const paragraphSectionIndex = options?.paragraphSectionIndex ?? new Map<string, number>();
  const overflowBudget: NoteOverflowBudget = { remaining: MAX_NOTE_OVERFLOW_PAGES };
  const refIndex = buildPageRefIndex(allRefs);
  const separatorCache = createNoteSeparatorCache();

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

  const noteMarks = buildMarkContext(footnoteSites, endnoteSites, input);

  let carry: NoteCarryMap = new Map();
  const endnotesBySection = new Map<number, PageRefHit[]>();
  const endnotesDoc: PageRefHit[] = [];

  let pages: PageRecord[] = layout.pages.map((page) => {
    const bodyPage = bodyOnlyPage(page);
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

    const sectionIndex = fnRefs[0]?.sectionIndex ?? 0;
    const props = footnotePropsFor(input, sectionIndex);
    let footnotes: NoteAreaRecord | undefined;
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

    return {
      ...bodyPage,
      ...(footnotes ? { footnotes } : {}),
    };
  });

  const pageCountBeforeOverflow = pages.length;

  // Drain footnote continuations that outlive the final body page.
  if (carry.size > 0) {
    const drained = drainFootnoteCarryPages(
      pages,
      carry,
      input,
      noteMarks,
      reasons,
      overflowBudget,
      separatorCache
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
      { separatorCache }
    );
  }

  if (pages.length !== pageCountBeforeOverflow) {
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

/** Map paragraph id → section index for note numbering / position resolution. */
function paragraphSectionIndexOf(
  part: OoxmlPart,
  sections: readonly DocumentSection[],
  displayMode: RevisionDisplayMode
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  // IN THE SAME MODE the section bounds were counted in. `blockStart`/`blockEndExclusive`
  // index a mode-filtered block list, and a resolved view has fewer blocks — a paragraph a
  // tracked mark merged away is gone from it. Indexing an All Markup list with those bounds
  // put paragraphs in the wrong section, which renumbers a footnote in a section nobody
  // edited.
  const blocks = storyBlocks(part, displayMode);
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]!;
    for (let i = section.blockStart; i < section.blockEndExclusive; i += 1) {
      const block = blocks[i];
      if (!block) continue;
      if (block.kind === 'paragraph') {
        map.set(block.id, sectionIndex);
        continue;
      }
      // Tables: walk cell paragraphs lightly (bounded).
      const walk = (node: OoxmlNode, depth: number): void => {
        if (depth > 32) return;
        if (node.kind === 'textValue') return;
        if (node.kind === 'paragraph') {
          map.set(node.id, sectionIndex);
          return;
        }
        for (const child of node.children) walk(child, depth + 1);
      };
      walk(block, 0);
    }
  }
  return map;
}

/** Drop non-positive heights so missing and zero compare equal. */
function compactFootnoteReserves(reserves: ReadonlyMap<number, number>): Map<number, number> {
  const next = new Map<number, number>();
  for (const [pageIndex, height] of reserves) {
    if (height > 0) next.set(pageIndex, height);
  }
  return next;
}

/** True when both maps list the same page → height pairs (zeros ignored). */
function footnoteReservesEqual(
  a: ReadonlyMap<number, number>,
  b: ReadonlyMap<number, number>
): boolean {
  const left = compactFootnoteReserves(a);
  const right = compactFootnoteReserves(b);
  if (left.size !== right.size) return false;
  for (const [pageIndex, height] of left) {
    if ((right.get(pageIndex) ?? 0) !== height) return false;
  }
  return true;
}

/** Monotonic union: each page keeps the larger of the two heights. */
function growFootnoteReserves(
  base: ReadonlyMap<number, number>,
  computed: ReadonlyMap<number, number>
): Map<number, number> {
  const next = compactFootnoteReserves(base);
  for (const [pageIndex, height] of computed) {
    if (height <= 0) continue;
    next.set(pageIndex, Math.max(next.get(pageIndex) ?? 0, height));
  }
  return next;
}

function footnoteReservesFingerprint(reserves: ReadonlyMap<number, number>): string {
  return [...compactFootnoteReserves(reserves)]
    .map(([pageIndex, height]) => `${pageIndex}=${height}`)
    .sort()
    .join(',');
}

/**
 * Notes path: provisional marks → body layout → reserve → bounded reflow → attach.
 * `runBody` is the coordinator's body layout pass (single- or multi-section).
 *
 * Convergence requires the body to have been laid out with exactly the reserves still
 * needed. Monotonic growth covers the unstable path; a stable-but-mismatched compute
 * (citation moved off a reserved page) drops stale entries and re-runs. Revisited
 * reserve fingerprints fail closed via the grow envelope so the loop cannot oscillate.
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
  const paragraphSectionIndex = paragraphSectionIndexOf(
    part,
    sections,
    (optionsWithLists as { displayMode?: RevisionDisplayMode }).displayMode ??
      DEFAULT_REVISION_DISPLAY_MODE
  );
  const allHits = buildPageRefHits(packageRefs, paragraphSectionIndex);
  const noteMarks = provisionalNoteMarks(allHits, notesInput);
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
  const appliedFingerprints = new Set<string>([footnoteReservesFingerprint(usedReserves)]);

  for (let attempt = 0; attempt < MAX_NOTE_REFLOW_ATTEMPTS; attempt += 1) {
    const computed = computeFootnoteReserves(bodyLayout, allHits, notesInput, noteMarks);
    fallbackReasons = [...computed.reasons];
    // Published pages must reflect the reserves used to produce them — not a later map.
    if (computed.stable && footnoteReservesEqual(computed.reserves, usedReserves)) {
      break;
    }

    // Unstable: grow only. Stable mismatch: adopt exact computed (drop stale pages).
    let next = computed.stable
      ? compactFootnoteReserves(computed.reserves)
      : growFootnoteReserves(usedReserves, computed.reserves);

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

  const attached = attachNotesToLayout(bodyLayout, allHits, notesInput, {
    fallbackReasons,
    paragraphSectionIndex,
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
  }
): NotesLayoutInput {
  const projectLink = notes.projectLink ?? body.projectLink;
  const projectFieldLink = notes.projectFieldLink ?? body.projectFieldLink;
  const documentProperties = notes.documentProperties ?? body.documentProperties;
  return {
    ...notes,
    ...(projectLink ? { projectLink } : {}),
    ...(projectFieldLink ? { projectFieldLink } : {}),
    ...(documentProperties ? { documentProperties } : {}),
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
