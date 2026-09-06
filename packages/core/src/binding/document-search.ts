// Document text search over the canonical tree, for the navigation pane's Find tab.
//
// Sibling of `document-outline.ts` and under the same discipline: the derivation reads the
// CANONICAL TREE — never the DOM, never the layout — and every string that leaves this
// module is bounded here at the derivation boundary. A match's text and its surrounding
// context are authored file content, and the panel rows that render them are chrome, so
// downstream sinks only ever receive strings this module has already bounded.
//
// NO REGEX ON THE HAYSTACK OR THE NEEDLE. Both are attacker-influenced (the document is a
// zip of XML the author controls; the query is host input), and a pattern built from either
// is a catastrophic-backtracking hazard. Scanning is `indexOf` only. The one regex here
// runs against a SINGLE character at a time for the whole-word test, where there is no
// backtracking to trigger.
//
// OFFSETS ARE `paragraphTextOf`'s VOCABULARY — UTF-16 offsets with tabs, hard breaks, and
// atomic fields counted as one character each. Match text and context use the visible text
// projection, so a field result can be longer than the editable model range it maps to.
//
// WHAT IS SEARCHED: body, furniture, footnotes, then endnotes. Each story uses the shared
// paragraph walk, which descends into tables, nested tables, and block controls. Selectable
// body and furniture text boxes follow their owners: ANCHORED ones only, because layout paints
// no story for an inline box. Note-owned text boxes remain excluded.

import {
  SEARCH_MATCH_LIMIT,
  SEARCH_QUERY_MAX,
  isSearchableQuery,
  paragraphTextOf,
} from '@docx-editor.dev/core/store';
import type { ViewScope } from '../contracts/editor.ts';
import {
  headerFooterVariantCanPaint,
  type HeaderFooterSectionResolution,
} from '../store/package/hf-references.ts';
import {
  formatNoteScopeId,
  isNormalNote,
  noteIdOf,
  resolvableNotesOf,
  type NoteKind,
} from '../store/package/note-nodes.ts';
import { isFldSimple } from '../store/package/field-nodes.ts';
import { bodyStoryRoot, storyParagraphs, storyRootsOf } from '../store/package/story-blocks.ts';
import { walkParagraphInline } from '../store/package/content-control-walk.ts';
import type { OoxmlParagraphNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { projectVisibleParagraphText } from '../store/store/text-projection.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { expandSelectableTextboxStories, type SearchStory } from './document-search-frames.ts';

export { SEARCH_MATCH_LIMIT, SEARCH_QUERY_MAX };

/** Characters of surrounding paragraph text carried on each side of a match. */
const CONTEXT_RADIUS = 48;

/** Control characters are flattened to spaces in every string that leaves this module. */
const CONTROL_CHARS_ALL = /[\u0000-\u001F\u007F-\u009F]/g;

/** How a search is narrowed. Both flags default to off, matching Word's initial state. */
export interface DocumentSearchOptions {
  readonly matchCase?: boolean;
  readonly wholeWord?: boolean;
  /** Override the default {@link SEARCH_MATCH_LIMIT}. Clamped to it; never raised past it. */
  readonly limit?: number;
  /** Stories the facade can navigate in its current mode. */
  readonly stories?: 'all' | 'body';
}

/**
 * One occurrence of a query in an editable document story.
 *
 * Carries the engine's own address (`blockId` + `start`) and the positional one a find UI
 * needs (`paragraphIndex` / `runIndex` / `runOffset`), both derived from the SAME walk —
 * a caller reconstructing run boundaries itself is where an off-by-one would come from.
 * A match can span runs when formatting changes mid-word; the run address is where it
 * STARTS.
 */
export interface DocumentSearchMatch {
  readonly blockId: string;
  readonly start: number;
  readonly length: number;
  readonly paragraphIndex: number;
  readonly runIndex: number;
  readonly runOffset: number;
  /** Story containing the match. Omitted for the body. */
  readonly scope?: ViewScope;
  /** The matched text as it appears in the document, control characters flattened. */
  readonly text: string;
  /** Paragraph text immediately before the match, bounded and flattened. */
  readonly contextBefore: string;
  /** Paragraph text immediately after the match, bounded and flattened. */
  readonly contextAfter: string;
}

/** Package stories outside the body, supplied without opening their story stores. */
export interface DocumentSearchSources {
  readonly headerFooterBySection: readonly HeaderFooterSectionResolution[];
  readonly footnotes: OoxmlPart | null;
  readonly endnotes: OoxmlPart | null;
  /** Normal note ids with a body reference that the surface can place. */
  readonly referencedNoteIds: {
    readonly footnote: ReadonlySet<number>;
    readonly endnote: ReadonlySet<number>;
  };
}

/**
 * What one search answers with.
 *
 * `truncated` says the scan stopped at the cap with matches still ahead of it, so a caller
 * can show "2000+" honestly instead of claiming an exact total it does not have.
 */
export interface DocumentSearchResult {
  readonly matches: readonly DocumentSearchMatch[];
  readonly truncated: boolean;
}

/**
 * Where each run starts, in paragraph-text offsets, in document order. Hyperlink runs and
 * `w:fldSimple` result runs are flattened where a reader meets them. An empty simple field
 * contributes no run, and its empty result cannot start a match. A complex field keeps its
 * existing run sequence; its atom starts in the begin run.
 */
interface RunStart {
  readonly id: string;
  readonly start: number;
}

function runStarts(paragraph: OoxmlParagraphNode): RunStart[] {
  const starts: RunStart[] = [];
  const offsets = paragraphOffsetIndex(paragraph);
  const simpleResultRuns = new Map<string, readonly string[]>();
  for (const segment of offsets.segments) {
    if (isFldSimple(segment.node)) {
      simpleResultRuns.set(segment.node.id, segment.formatRunIds ?? []);
    }
  }
  walkParagraphInline(
    paragraph.children,
    0,
    (node) => {
      if (node.kind === 'run') {
        starts.push({ id: node.id, start: offsets.spanOf(node)?.start ?? 0 });
        return;
      }
      if (!isFldSimple(node)) return;
      for (const runId of simpleResultRuns.get(node.id) ?? []) {
        const span = offsets.spanOf(runId);
        if (span) starts.push({ id: runId, start: span.start });
      }
    },
    { descendRevisions: true }
  );
  return starts;
}

function bodyStories(part: OoxmlPart): SearchStory[] {
  const body = bodyStoryRoot(part);
  return body ? [{ part, root: body }] : [];
}

function furnitureStories(
  sections: readonly HeaderFooterSectionResolution[],
  seen: Set<OoxmlPart>
): SearchStory[] {
  const stories: SearchStory[] = [];
  for (const kind of ['header', 'footer'] as const) {
    for (const section of sections) {
      const slots = kind === 'header' ? section.headers : section.footers;
      for (const [variant, slot] of slots) {
        if (!headerFooterVariantCanPaint(section, variant)) continue;
        if (seen.has(slot.part)) continue;
        seen.add(slot.part);
        const story = storyRootsOf(slot.part).find((candidate) => candidate.kind === kind);
        if (story) {
          stories.push({
            part: slot.part,
            root: story.root,
            scope: { kind: 'headerFooter', rId: slot.rId },
          });
        }
      }
    }
  }
  return stories;
}

function noteStories(
  part: OoxmlPart | null,
  noteKind: NoteKind,
  referencedIds: ReadonlySet<number>
): SearchStory[] {
  if (!part) return [];
  const stories: SearchStory[] = [];
  for (const note of resolvableNotesOf(part.root)) {
    const noteId = noteIdOf(note);
    if (!isNormalNote(note) || noteId === null || !referencedIds.has(noteId)) continue;
    stories.push({
      part,
      root: note,
      scope: { kind: 'note', id: formatNoteScopeId(noteKind, noteId) },
    });
  }
  return stories;
}

function searchStories(part: OoxmlPart, sources?: DocumentSearchSources): SearchStory[] {
  const stories = bodyStories(part);
  if (sources) {
    const seen = new Set<OoxmlPart>();
    for (const story of furnitureStories(sources.headerFooterBySection, seen)) stories.push(story);
    for (const story of noteStories(
      sources.footnotes,
      'footnote',
      sources.referencedNoteIds.footnote
    )) {
      stories.push(story);
    }
    for (const story of noteStories(
      sources.endnotes,
      'endnote',
      sources.referencedNoteIds.endnote
    )) {
      stories.push(story);
    }
  }
  return expandSelectableTextboxStories(stories);
}

/** The run a paragraph offset falls in, and the offset inside it. */
function runAddressAt(
  starts: readonly RunStart[],
  offset: number
): { index: number; offset: number } {
  if (starts.length === 0) return { index: 0, offset };
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const start = starts[index]!.start;
    if (offset >= start) return { index, offset: offset - start };
  }
  return { index: 0, offset };
}

function resultRunAddressAt(
  starts: readonly RunStart[],
  runId: string,
  offset: number
): { index: number; offset: number } | null {
  const index = starts.findIndex((run) => run.id === runId);
  return index < 0 ? null : { index, offset };
}

/** Bound and flatten one file-derived string on its way out of this module. */
function bounded(raw: string, max: number): string {
  return raw.replace(CONTROL_CHARS_ALL, ' ').slice(0, max);
}

/**
 * Every occurrence of `query` across stories, in navigation order.
 *
 * Matches are NON-OVERLAPPING, which is what a find dialog counts: searching `aa` in
 * `aaaa` finds two, not three. An empty or over-long query finds nothing rather than
 * everything — "find nothing typed" is not a document-wide selection.
 */
export function collectTextMatches(
  part: OoxmlPart,
  query: string,
  options: DocumentSearchOptions = {},
  sources?: DocumentSearchSources
): DocumentSearchResult {
  const empty: DocumentSearchResult = { matches: [], truncated: false };
  if (!isSearchableQuery(query)) return empty;

  const limit =
    options.limit !== undefined && Number.isInteger(options.limit) && options.limit > 0
      ? Math.min(options.limit, SEARCH_MATCH_LIMIT)
      : SEARCH_MATCH_LIMIT;
  const scan = {
    ...(options.matchCase === undefined ? {} : { matchCase: options.matchCase }),
    ...(options.wholeWord === undefined ? {} : { wholeWord: options.wholeWord }),
  };

  const matches: DocumentSearchMatch[] = [];
  const searchableSources = options.stories === 'body' ? undefined : sources;
  for (const story of searchStories(part, searchableSources)) {
    let paragraphIndex = 0;
    for (const paragraph of storyParagraphs(story.root)) {
      if (paragraph.kind !== 'paragraph') continue;
      const index = paragraphIndex;
      paragraphIndex += 1;
      const rawText = paragraphTextOf(story.part, paragraph.id) ?? '';
      const projected = projectVisibleParagraphText(paragraph, rawText);
      if (projected.text.length === 0) continue;

      // One global budget, not one per paragraph or story.
      const remaining = limit - matches.length;
      // Once full, scan for one more occurrence to distinguish an exact total from truncation.
      const found = projected.findOccurrences(query, Math.max(remaining, 1), scan);
      if (remaining === 0 && found.matches.length > 0) return { matches, truncated: true };
      // Run starts are derived once per paragraph that has a hit, not per occurrence.
      let starts: RunStart[] | null = null;
      for (const occurrence of found.matches) {
        const projectedEnd = occurrence.start + occurrence.length;
        starts ??= runStarts(paragraph);
        // Simple-field expansions retain their visible result-run boundaries. Complex-field
        // results remain one editable atom, so their address names the field's begin run.
        const resultRun = projected.resultRunAddressAt(occurrence.start);
        const address = resultRun
          ? (resultRunAddressAt(starts, resultRun.runId, resultRun.offset) ??
            runAddressAt(starts, occurrence.rawStart))
          : runAddressAt(starts, occurrence.rawStart);
        matches.push({
          blockId: paragraph.id,
          start: occurrence.rawStart,
          length: occurrence.rawEnd - occurrence.rawStart,
          paragraphIndex: index,
          runIndex: address.index,
          runOffset: address.offset,
          ...(story.scope ? { scope: story.scope } : {}),
          text: bounded(projected.text.slice(occurrence.start, projectedEnd), SEARCH_QUERY_MAX),
          contextBefore: bounded(
            projected.text.slice(Math.max(0, occurrence.start - CONTEXT_RADIUS), occurrence.start),
            CONTEXT_RADIUS
          ),
          contextAfter: bounded(
            projected.text.slice(projectedEnd, projectedEnd + CONTEXT_RADIUS),
            CONTEXT_RADIUS
          ),
        });
      }
      if (found.truncated) return { matches, truncated: true };
    }
  }

  return { matches, truncated: false };
}
