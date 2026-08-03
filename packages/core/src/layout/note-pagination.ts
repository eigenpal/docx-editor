/* eslint-disable max-lines -- note pagination seam: reservation, continuation, overflow pages */

// Footnote / endnote pagination: reservation, split/continuation, sect/doc end collection.
//
// Body flow places references; this module lays referenced notes at content width, reserves
// separator+note area (pageBottom / beneathText), bounds the reflow loop, and attaches
// layout-owned note records. Endnotes reserve nothing on reference pages — they collect at
// sectEnd / docEnd. Hostile counts and oscillation fail closed with named reasons.

import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core-contract/store';
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
  type NoteStoryLayout,
  type LayoutNoteStoryOptions,
} from './note-layout.ts';
import { noteMarkKey, type NoteMarkContext } from './note-projection.ts';
import type {
  BlockFragmentRecord,
  NoteAreaRecord,
  NoteStoryRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  TextMeasurer,
} from './semantic-records.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './paragraph-flow.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

/** Bound on reflow attempts per document layout pass. */
export const MAX_NOTE_REFLOW_ATTEMPTS = 8;

/** Cap on total note story fragments attached across the document. */
export const MAX_NOTE_AREA_FRAGMENTS = 4_096;

/** Cap on empty pages created solely to drain footnote/endnote overflow. */
export const MAX_NOTE_OVERFLOW_PAGES = 256;

export type NotePaginationFallbackReason =
  | NoteLayoutFallbackReason
  | 'note-reflow-exhausted'
  | 'note-area-fragment-limit'
  | 'note-overflow-page-limit';

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
}

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

/**
 * Collect note references that appear in laid-out body fragments on a page.
 * Matches {@link ParagraphFragmentRecord.range} ownership (half-open + boundary affinity).
 */
export function filterRefsOnPage(
  page: PageRecord,
  allRefs: readonly PageRefHit[]
): readonly PageRefHit[] {
  const fragments = paragraphFragmentsOfBlocks(page.fragments);
  return allRefs.filter((ref) =>
    fragments.some(
      (fragment) =>
        fragment.paragraphId === ref.paragraphId && fragmentOwnsAtomOffset(fragment, ref.atomOffset)
    )
  );
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
    noteMarks,
  };
}

function shiftFragments(
  fragments: readonly BlockFragmentRecord[],
  dy: number
): BlockFragmentRecord[] {
  if (dy === 0) return [...fragments];
  return fragments.map((fragment) => ({
    ...fragment,
    box: { ...fragment.box, y: fragment.box.y + dy },
  }));
}

function splitNoteFragments(
  laid: NoteStoryLayout,
  availableHeight: number
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
  const head: BlockFragmentRecord[] = [];
  let headHeight = 0;
  let cut = 0;
  for (let i = 0; i < laid.fragments.length && i < MAX_NOTE_FRAGMENTS; i += 1) {
    const fragment = laid.fragments[i]!;
    const next = fragment.box.y + fragment.box.height;
    if (next > availableHeight + 0.001 && head.length > 0) break;
    head.push(fragment);
    headHeight = next;
    cut = i + 1;
  }
  const rawTail = laid.fragments.slice(cut);
  const dy = rawTail[0]?.box.y ?? 0;
  const tail = shiftFragments(rawTail, -dy);
  const tailHeight = Math.max(0, laid.flowHeight - dy);
  return { head, headHeight, tail, tailHeight };
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

  // eachPage: reserve digit width per section that restarts on pages; keep the widest
  // candidate so 9→10 cannot re-paginate under any section's numFmt.
  let reservedMarkText: string | undefined;
  const sectionCount = Math.max(
    input.footnotePropsBySection.length,
    1,
    ...footnoteSites.map((site) => site.sectionIndex + 1)
  );
  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    const props = footnotePropsFor(input, sectionIndex);
    if (props.numRestart !== 'eachPage') continue;
    const candidate = formatNumFmt(props.numFmt, Math.max(props.numStart + 9, 10));
    if (!reservedMarkText || candidate.length > reservedMarkText.length) {
      reservedMarkText = candidate;
    }
  }
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

function buildFootnoteArea(
  page: PageRecord,
  refs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  placement: FootnotePosition,
  continuationCarry: NoteCarryMap,
  reasons: NotePaginationFallbackReason[]
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
  const separator = layoutNoteSeparator(
    input.footnotesPart,
    separatorKind,
    contentWidth,
    opts,
    'footnote'
  );

  const availableForNotes =
    placement === 'beneathText'
      ? Math.max(0, page.contentBox.height - bodyUsedHeight(page) - separator.flowHeight)
      : Math.max(0, page.contentBox.height - bodyUsedHeight(page) - separator.flowHeight);

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
        room
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
      const split = splitNoteFragments(laid, room);
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

function cloneEmptyOverflowPage(template: PageRecord, index: number): PageRecord {
  return {
    id: `page-${index}`,
    index,
    box: template.box,
    contentBox: template.contentBox,
    fragments: [],
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

/**
 * Place endnotes (or sect/doc-end footnotes) onto `page`, splitting under a continuation
 * separator when they do not fit. Returns unplaced carry for further pages.
 */
function buildEndnoteArea(
  page: PageRecord,
  refs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  placement: 'sectEnd' | 'docEnd',
  continuationCarry: NoteCarryMap,
  reasons: NotePaginationFallbackReason[],
  options?: { readonly separatorKind?: 'separator' | 'continuationSeparator' }
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
  const separator = layoutNoteSeparator(
    input.endnotesPart ?? input.footnotesPart,
    separatorKind,
    contentWidth,
    opts,
    'endnote'
  );
  const sepHeight = separator.flowHeight;
  const availableForNotes = Math.max(0, page.contentBox.height - bodyUsedHeight(page) - sepHeight);

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
        room
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
      const split = splitNoteFragments(laid, room);
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

  const bodyBottom = bodyUsedHeight(page);
  const areaTop = page.contentBox.y + bodyBottom;
  let cursorY = areaTop + sepHeight;
  const placedNotes = notes.map((note) => {
    const placed = { ...note, box: { ...note.box, y: cursorY } };
    cursorY += note.box.height;
    return placed;
  });

  const sepBox = noteSeparatorAreaBox(separator, page.contentBox.x, contentWidth, areaTop);

  return {
    area: {
      kind: 'endnotes',
      placement,
      box: {
        x: page.contentBox.x,
        y: areaTop,
        width: contentWidth,
        height: sepHeight + stackHeight,
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
  reasons: NotePaginationFallbackReason[]
): { pages: PageRecord[]; carry: NoteCarryMap } {
  let nextPages = pages;
  let nextCarry = carry;
  let created = 0;
  while (nextCarry.size > 0 && created < MAX_NOTE_OVERFLOW_PAGES) {
    const template = nextPages[nextPages.length - 1]!;
    const page = cloneEmptyOverflowPage(template, template.index + 1);
    const built = buildFootnoteArea(page, [], input, noteMarks, 'pageBottom', nextCarry, reasons);
    nextCarry = built.nextCarry;
    if (!built.area) {
      reasons.push('note-overflow-page-limit');
      break;
    }
    nextPages = [...nextPages, { ...page, footnotes: built.area }];
    created += 1;
  }
  if (nextCarry.size > 0) reasons.push('note-overflow-page-limit');
  return { pages: nextPages, carry: nextCarry };
}

/** Place collected endnotes starting at `startIndex`, creating overflow pages as needed. */
function placeEndnotesFromPage(
  pages: PageRecord[],
  startIndex: number,
  refs: readonly PageRefHit[],
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext,
  placement: 'sectEnd' | 'docEnd',
  reasons: NotePaginationFallbackReason[]
): PageRecord[] {
  if (refs.length === 0 || pages.length === 0) return pages;
  const nextPages = [...pages];
  let pending = [...refs];
  let carry: NoteCarryMap = new Map();
  let index = startIndex;
  let created = 0;
  let separatorKind: 'separator' | 'continuationSeparator' = 'separator';

  while ((pending.length > 0 || carry.size > 0) && created <= MAX_NOTE_OVERFLOW_PAGES) {
    if (index >= nextPages.length) {
      if (created >= MAX_NOTE_OVERFLOW_PAGES) {
        reasons.push('note-overflow-page-limit');
        break;
      }
      const template = nextPages[nextPages.length - 1]!;
      nextPages.push(cloneEmptyOverflowPage(template, template.index + 1));
      created += 1;
    }
    const page = nextPages[index]!;
    const built = buildEndnoteArea(page, pending, input, noteMarks, placement, carry, reasons, {
      separatorKind,
    });
    carry = built.nextCarry;
    pending = built.remainingRefs;
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
      // No room on this page — advance / create the next.
      index += 1;
      separatorKind = 'separator';
      continue;
    }
    if (carry.size > 0 || pending.length > 0) {
      separatorKind = 'continuationSeparator';
      index += 1;
      continue;
    }
    break;
  }
  if (pending.length > 0 || carry.size > 0) {
    reasons.push('note-overflow-page-limit');
  }
  return nextPages;
}

/**
 * Compute per-page bottom reserves (points) needed for footnotes given a provisional layout.
 * Used by the bounded reflow loop before final attach.
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

  for (const page of layout.pages) {
    const pageRefs = filterRefsOnPage(page, allRefs);
    const fnRefs = pageRefs.filter((r) => r.noteKind === 'footnote');
    // Position from first ref's section (Word uses section of the page).
    const sectionIndex = fnRefs[0]?.sectionIndex ?? 0;
    const props = footnotePropsFor(input, sectionIndex);
    if (props.pos === 'sectEnd' || props.pos === 'docEnd') {
      // No per-page reservation — collected later.
      continue;
    }
    const { area, nextCarry } = buildFootnoteArea(
      page,
      fnRefs,
      input,
      noteMarks,
      props.pos,
      carry,
      reasons
    );
    carry = nextCarry;
    const needed = area?.box.height ?? 0;
    // Also reserve for carry that didn't fit — force room on next pages via body shrink.
    const prev = reserves.get(page.index) ?? 0;
    reserves.set(page.index, Math.max(prev, needed));
  }

  // Stability: reserves that fit within remaining body slack without pushing refs.
  let stable = true;
  for (const page of layout.pages) {
    const needed = reserves.get(page.index) ?? 0;
    if (needed <= 0) continue;
    const used = bodyUsedHeight(page);
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
  options?: { readonly fallbackReasons?: readonly NotePaginationFallbackReason[] }
): NotesAttachResult {
  const reasons: NotePaginationFallbackReason[] = [...(options?.fallbackReasons ?? [])];

  // Build sites for mark derivation (page index from layout).
  const footnoteSites: NoteReferenceSite[] = [];
  const endnoteSites: NoteReferenceSite[] = [];
  for (const page of layout.pages) {
    for (const ref of filterRefsOnPage(page, allRefs)) {
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
    const pageRefs = filterRefsOnPage(page, allRefs);
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
        page,
        pageBottomRefs,
        input,
        noteMarks,
        props.pos,
        carry,
        reasons
      );
      footnotes = built.area;
      carry = built.nextCarry;
    }

    return {
      ...page,
      ...(footnotes ? { footnotes } : {}),
    };
  });

  // Drain footnote continuations that outlive the final body page.
  if (carry.size > 0) {
    const drained = drainFootnoteCarryPages(pages, carry, input, noteMarks, reasons);
    pages = drained.pages;
    carry = drained.carry;
  }

  // Place sectEnd endnotes on the last page of each section (approximate: last page
  // whose body paragraphs belong to that section — fall back to last page overall).
  if (endnotesBySection.size > 0 && pages.length > 0) {
    for (const [sectionIndex, refs] of endnotesBySection) {
      const target =
        [...pages]
          .reverse()
          .find((page) =>
            filterRefsOnPage(page, allRefs).some((r) => r.sectionIndex === sectionIndex)
          ) ?? pages[pages.length - 1]!;
      const idx = pages.findIndex((p) => p.index === target.index);
      if (idx < 0) continue;
      pages = placeEndnotesFromPage(pages, idx, refs, input, noteMarks, 'sectEnd', reasons);
    }
  }

  if (endnotesDoc.length > 0 && pages.length > 0) {
    pages = placeEndnotesFromPage(
      pages,
      pages.length - 1,
      endnotesDoc,
      input,
      noteMarks,
      'docEnd',
      reasons
    );
  }

  return {
    layout: { revision: layout.revision, pages },
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
  sections: readonly DocumentSection[]
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  const blocks = storyBlocks(part);
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

/**
 * Notes path: provisional marks → body layout → reserve → bounded reflow → attach.
 * `runBody` is the coordinator's body layout pass (single- or multi-section).
 */
export function layoutSemanticDocumentWithNotes<
  Opts extends {
    noteMarks?: NoteMarkContext;
    pageBottomReserves?: ReadonlyMap<number, number>;
    session?: { previous: SemanticLayout | null; multi: unknown };
  },
>(
  part: OoxmlPart,
  sections: readonly DocumentSection[],
  optionsWithLists: Opts,
  notesInput: NotesLayoutInput,
  runBody: (opts: Opts) => SemanticLayout
): SemanticLayout {
  const packageRefs = collectBodyNoteReferences(part);
  const paragraphSectionIndex = paragraphSectionIndexOf(part, sections);
  const allHits = buildPageRefHits(packageRefs, paragraphSectionIndex);
  const noteMarks = provisionalNoteMarks(allHits, notesInput);
  let reserves: ReadonlyMap<number, number> = new Map();
  let fallbackReasons: NotePaginationFallbackReason[] = [];
  let bodyLayout: SemanticLayout = runBody({
    ...optionsWithLists,
    noteMarks,
    pageBottomReserves: reserves,
  });

  for (let attempt = 0; attempt < MAX_NOTE_REFLOW_ATTEMPTS; attempt += 1) {
    const computed = computeFootnoteReserves(bodyLayout, allHits, notesInput, noteMarks);
    fallbackReasons = [...computed.reasons];
    if (computed.stable) {
      reserves = computed.reserves;
      break;
    }
    // Grow reserves monotonically so the loop cannot oscillate.
    const next = new Map(reserves);
    for (const [pageIndex, height] of computed.reserves) {
      next.set(pageIndex, Math.max(next.get(pageIndex) ?? 0, height));
    }
    const unchanged =
      next.size === reserves.size && [...next].every(([k, v]) => (reserves.get(k) ?? 0) === v);
    reserves = next;
    if (unchanged) {
      fallbackReasons.push('note-reflow-exhausted');
      break;
    }
    bodyLayout = runBody({
      ...optionsWithLists,
      noteMarks,
      pageBottomReserves: reserves,
      // Reflow must not reuse checkpoints sized for a different reserve set.
      session: undefined,
    });
    if (attempt === MAX_NOTE_REFLOW_ATTEMPTS - 1) {
      fallbackReasons.push('note-reflow-exhausted');
    }
  }

  const attached = attachNotesToLayout(bodyLayout, allHits, notesInput, {
    fallbackReasons,
  });
  if (optionsWithLists.session) {
    optionsWithLists.session.previous = attached.layout;
  }
  return attached.layout;
}

/**
 * Build a continuous (pre-page) mark context for the first body layout pass.
 * eachPage reserves digit width; final marks refine after page assignment.
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

export {
  resolveFootnoteProperties,
  resolveEndnoteProperties,
  formatNoteScopeId,
  noteReferenceKindOf,
  noteIdOf,
  customMarkFollows,
  noteDisplayMarkMap,
};
