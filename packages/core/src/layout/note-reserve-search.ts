// Runs the page-by-page footnote reserve walk (`note-reserve-walk.ts`) for one notes pass.
//
// A pass with a previous walk on its session first lays the body out under the previous
// reserves, each page reading the reserve its content had before. That probe is cheap: it
// resumes at the edit and reuses the unchanged pages after it. Comparing its pages with the
// previous layout shows where the content changed and where it stops changing, whatever the
// change was: text, styles, pictures or note numbers. The walk keeps the decisions on the
// pages before the change, and takes the previous decisions again once it reaches unchanged
// content.
//
// The walk's rounds lay out only a few pages past the page being decided. They run on the
// caller's session, which is then put back as the probe left it, so the final pass resumes
// at the edit and reuses the pages after it as any warm pass does.

import { snapshotLayoutSession } from './layout-session-snapshot.ts';
import type { LayoutSession } from './layout-session.ts';
import type { LayoutProgress, LayoutSteps } from './layout-steps.ts';
import { noteBodyGeometryChanged } from './note-body-geometry.ts';
import { previousBodyLayout } from './previous-body-pages.ts';
import { layoutNodeDigest } from './layout-cache.ts';
import {
  walkFootnoteReserves,
  type ReserveComputeRange,
  type ReserveComputeResult,
  type ReserveWalkRecord,
  type ReserveWalkRound,
} from './note-reserve-walk.ts';
import type { PageRecord, SemanticLayout } from './semantic-records.ts';
import type { DocumentSection } from './section-properties.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';

type Reserves = ReadonlyMap<number, number>;

/** Inputs that change every page's notes without changing the body. */
export interface ReserveSearchInputs {
  readonly footnotesPart: OoxmlPart | null;
  /** Everything else the notes read; compared item by item. */
  readonly others: readonly unknown[];
}

/**
 * The walk a pass made, for the next pass on the same session. It rides the session's notes
 * memo, so a host that puts a dropped pass back puts this back with the layout it describes.
 */
export interface ReserveSearchState {
  readonly record: ReserveWalkRecord;
  readonly inputs: ReserveSearchInputs;
  readonly limit: number;
  /** Some page of the walk took a cycle answer. */
  readonly exhausted: boolean;
}

export interface ReserveSearchOptions {
  readonly session: LayoutSession | undefined;
  /** The walk of the pass that published `session.previous`, if it ran one. */
  readonly state: ReserveSearchState | null;
  readonly part: OoxmlPart;
  /** The body blocks the pass lays out, in order. */
  readonly blocks: readonly OoxmlNode[];
  readonly inputs: ReserveSearchInputs;
  /** The pass's body block limit, or -1. */
  readonly limit: number;
  /** Body paragraph ids that cite each footnote id. */
  readonly citingParagraphs: (noteId: number) => readonly string[];
  /**
   * Lay out the body under `reserves`. `blockLimit` lays out only that many blocks; `follow`
   * reads each page's reserve where its content stood in the previous pass.
   */
  readonly body: (
    reserves: Reserves,
    blockLimit: number | undefined,
    follow: boolean
  ) => LayoutSteps<SemanticLayout>;
  /** After a `follow` run: the reserves its pages were laid out under. */
  readonly followedReserves: (given: Reserves) => Reserves;
  readonly compute: (
    layout: SemanticLayout,
    used: Reserves,
    allowOrphanDeferral: boolean,
    range: ReserveComputeRange
  ) => ReserveComputeResult;
  readonly carryKey: (carry: unknown) => string;
  readonly stopped: () => boolean;
}

export interface ReserveSearchResult {
  readonly layout: SemanticLayout;
  readonly reserves: Reserves;
  readonly exhausted: boolean;
  readonly state: ReserveSearchState;
}

function reservesEqual(a: Reserves, b: Reserves): boolean {
  if (a.size !== b.size) return false;
  for (const [index, height] of a) if (b.get(index) !== height) return false;
  return true;
}

function sameInputs(a: ReserveSearchInputs, b: ReserveSearchInputs): boolean {
  return a.others.length === b.others.length && a.others.every((value, i) => value === b.others[i]);
}

/** Where a page starts: its first block and offset, its geometry, and the notes it carries in. */
function pageStart(page: PageRecord, carry: string): string {
  const first = page.fragments[0];
  const at = !first
    ? '-'
    : first.kind === 'paragraph'
      ? `p:${first.paragraphId}:${first.range.start}:${first.fragmentIndex}`
      : first.kind === 'table'
        ? `t:${first.tableId}:${first.fragmentIndex}:${first.rows.map((row) => row.id).join(',')}`
        : 'other';
  const box = page.contentBox;
  return `${at}|${box.width}x${box.height}|${page.parityBlank ? 'b' : ''}|${carry}`;
}

function footnoteNodes(part: OoxmlPart | null): Map<string, OoxmlNode> {
  const notes = new Map<string, OoxmlNode>();
  if (!part) return notes;
  for (const child of part.root.children) {
    if (child.kind === 'textValue' || child.localName !== 'footnote') continue;
    const id = child.attributes.find(
      (attribute) => attribute.localName === 'id' && attribute.namespaceUri === WML_NAMESPACE_URI
    )?.value;
    if (id !== undefined) notes.set(id, child);
  }
  return notes;
}

/** Footnote ids whose story changed between two notes parts. */
function changedFootnotes(before: OoxmlPart | null, after: OoxmlPart | null): number[] | null {
  if (before === after) return [];
  if (!before || !after) return null;
  const old = footnoteNodes(before);
  const now = footnoteNodes(after);
  const changed = new Set<string>();
  for (const [id, node] of now) {
    const was = old.get(id);
    if (was !== node && (!was || layoutNodeDigest(was) !== layoutNodeDigest(node))) changed.add(id);
  }
  for (const id of old.keys()) if (!now.has(id)) changed.add(id);
  const ids: number[] = [];
  for (const id of changed) {
    const value = Number(id);
    // A separator or notice changes every note area.
    if (!Number.isInteger(value) || value <= 0) return null;
    ids.push(value);
  }
  return ids;
}

/** The first and last previous-layout page holding a fragment of one of `paragraphIds`. */
function pagesHolding(
  layout: SemanticLayout,
  paragraphIds: ReadonlySet<string>
): [number, number] | null {
  let first = -1;
  let lastPage = -1;
  layout.pages.forEach((page, index) => {
    const holds = page.fragments.some(
      (fragment) => fragment.kind === 'paragraph' && paragraphIds.has(fragment.paragraphId)
    );
    if (!holds) return;
    if (first < 0) first = index;
    lastPage = index;
  });
  return first < 0 ? null : [first, lastPage];
}

/**
 * The first page whose body differs from the previous layout, and the first previous page
 * from which every page is reused unchanged (Infinity when none is).
 */
function changedRange(probe: SemanticLayout, previous: SemanticLayout): [number, number] {
  const shared = Math.min(probe.pages.length, previous.pages.length);
  let first = 0;
  while (first < shared && probe.pages[first]!.fragments === previous.pages[first]!.fragments) {
    first += 1;
  }
  const delta = probe.pages.length - previous.pages.length;
  let from = previous.pages.length;
  while (from > 0) {
    const at = from - 1 + delta;
    if (at < first || probe.pages[at]?.fragments !== previous.pages[from - 1]!.fragments) break;
    from -= 1;
  }
  return [first, from >= previous.pages.length ? Number.POSITIVE_INFINITY : from];
}

/** Report only the pages the walk has decided, so a host shows no undecided page. */
function* decidedProgress<T>(steps: LayoutSteps<T>, decided: () => number): LayoutSteps<T> {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    const progress = next.value;
    if (!progress) {
      yield progress;
      continue;
    }
    const count = Math.min(decided(), progress.pages.length);
    const clamped: LayoutProgress = { ...progress, pages: progress.pages.slice(0, count) };
    yield clamped;
  }
}

/** Decide the footnote reserves for one pass and return its published body layout. */
export function* searchFootnoteReserves(
  options: ReserveSearchOptions
): LayoutSteps<ReserveSearchResult> {
  const { session, part, blocks, state } = options;
  const previousLayout = previousBodyLayout(session?.previous ?? null);
  const blockIndex = new Map<string, number>();
  blocks.forEach((block, index) => blockIndex.set(block.id, index));

  // The probe: the body under the previous answer. It is also the published layout when the
  // walk keeps that answer. When the edit moved pages and nothing after it lined up, a second
  // probe reads each page's reserve where its content stood, so the pages after the edit do.
  // That one only locates the change: the reserves its pages read are not one map.
  let probe: { layout: SemanticLayout; used: Reserves } | null = null;
  let startFloor = 0;
  let unchangedFrom = Number.POSITIVE_INFINITY;
  let probeLayout: SemanticLayout | null = null;
  let unchanged = false;
  const reuse = state && previousLayout && state.limit === options.limit ? state : undefined;
  if (reuse && sameInputs(reuse.inputs, options.inputs)) {
    const given = reuse.record.reserves;
    let layout = yield* options.body(given, undefined, false);
    probe = { layout, used: given };
    if (
      !Number.isFinite(changedRange(layout, previousLayout!)[1]) &&
      layout.pages.length !== previousLayout!.pages.length
    ) {
      layout = yield* options.body(given, undefined, true);
      options.followedReserves(given);
      probe = null;
    }
    probeLayout = layout;
    const notes = changedFootnotes(reuse.inputs.footnotesPart, options.inputs.footnotesPart);
    if (!noteBodyGeometryChanged(session, layout, part) && notes !== null) {
      let [first, from] = changedRange(layout, previousLayout!);
      unchanged =
        probe !== null &&
        notes.length === 0 &&
        first >= previousLayout!.pages.length &&
        layout.pages.length === previousLayout!.pages.length;
      const citing = new Set(notes.flatMap((id) => options.citingParagraphs(id)));
      const held = citing.size > 0 ? pagesHolding(previousLayout!, citing) : null;
      if (held) {
        first = Math.min(first, held[0]);
        from = Math.max(from, held[1] + 1);
      }
      // A page's answer reads the next page, or the one after a blank parity sheet.
      const reads = previousLayout!.pages[first - 1]?.parityBlank ? 2 : 1;
      startFloor = Math.max(0, Math.min(first - reads, reuse.record.decided));
      unchangedFrom = from;
    }
  } else if (session) {
    noteBodyGeometryChanged(session, previousLayout ?? { revision: 0, pages: [] }, part);
  }
  const restore = session ? snapshotLayoutSession(session) : null;

  // How many blocks a round lays out: through the first block of the page after `page` in
  // the latest layout that reaches it, and the whole body when none does.
  let reference: SemanticLayout | null = probeLayout ?? previousLayout;
  const blockLimitThrough = (page: number): number => {
    const next = reference?.pages[page + 1];
    for (const fragment of next?.fragments ?? []) {
      const id =
        fragment.kind === 'paragraph'
          ? fragment.paragraphId
          : fragment.kind === 'table'
            ? fragment.tableId
            : undefined;
      const index = id === undefined ? undefined : blockIndex.get(id);
      if (index !== undefined) return index + 1;
    }
    return blocks.length;
  };
  let decided = startFloor;
  function* round(reserves: Reserves, throughPage: number): LayoutSteps<ReserveWalkRound> {
    let limit = blockLimitThrough(throughPage + 1);
    for (;;) {
      const whole = limit >= blocks.length;
      const layout = yield* decidedProgress(
        options.body(reserves, whole ? undefined : limit, false),
        () => decided
      );
      reference = layout;
      if (whole || layout.pages.length >= throughPage + 2) return { layout, whole };
      limit = Math.min(blocks.length, limit * 2 + 16);
    }
  }

  const prefix = reuse?.record;
  // Nothing the notes read moved: the previous answer stands, and so does its layout.
  if (unchanged && probe && prefix?.complete && reuse) {
    return { layout: probe.layout, reserves: probe.used, exhausted: reuse.exhausted, state: reuse };
  }
  const walked = yield* walkFootnoteReserves({
    start: {
      reserves: prefix && startFloor > 0 ? prefix.reserves : new Map(),
      floor: startFloor,
      carry: (startFloor > 0 ? prefix?.carries[startFloor] : undefined) ?? new Map(),
      starts: startFloor > 0 ? (prefix?.starts ?? []) : [],
      carries: startFloor > 0 ? (prefix?.carries ?? []) : [],
    },
    ...(prefix && Number.isFinite(unchangedFrom)
      ? { previous: { record: prefix, unchangedFrom } }
      : {}),
    round,
    compute: (layout, used, deferral, range) => {
      decided = range.from;
      return options.compute(layout, used, deferral, range);
    },
    startOf: (page, carry) => pageStart(page, options.carryKey(carry)),
    stopped: options.stopped,
  });

  let layout: SemanticLayout;
  if (walked.last?.whole && walked.lastCurrent) {
    layout = walked.last.layout;
  } else if (probe && reservesEqual(probe.used, walked.reserves)) {
    restore?.();
    layout = probe.layout;
  } else {
    restore?.();
    decided = Number.POSITIVE_INFINITY;
    layout = yield* options.body(walked.reserves, undefined, false);
  }
  return {
    layout,
    reserves: walked.reserves,
    exhausted: walked.exhausted,
    state: {
      record: walked.record,
      inputs: options.inputs,
      limit: options.limit,
      exhausted: walked.exhausted,
    },
  };
}

/**
 * The blocks and sections a body run lays out: all of them, or the first
 * `noteRoundBlockLimit` for a round of the reserve search. A section the limit cuts keeps its
 * own properties; only its end moves.
 */
export function noteRoundBlocks<Block extends OoxmlElement>(
  _part: OoxmlPart,
  blocks: readonly Block[],
  sections: readonly DocumentSection[],
  options: { readonly noteRoundBlockLimit?: number }
): readonly [readonly Block[], readonly DocumentSection[]] {
  const limit = options.noteRoundBlockLimit;
  if (limit === undefined || limit >= blocks.length) return [blocks, sections];
  const end = Math.max(1, limit);
  const kept: DocumentSection[] = [];
  for (const section of sections) {
    if (section.blockStart >= end && kept.length > 0) break;
    kept.push(section.blockEndExclusive > end ? { ...section, blockEndExclusive: end } : section);
  }
  return [blocks.slice(0, end), kept];
}
