// Textbox story layout.
//
// A text-box drawing (`wps:wsp` → `wps:txbx` → `w:txbxContent`) carries a STORY: ordinary
// paragraphs flowed inside the drawing's declared extent — same shape as a footnote story
// ({@link layoutNoteStory}), but bounded by the box instead of the page. The extent is
// authoritative: content that does not fit clips with a named fallback reason, never grows
// the box.
//
// PAGE / NUMPAGES / SECTIONPAGES fields inside the story project through the same
// `pageContext` path the host story uses, so a footer whose page number lives inside an
// anchored text box evaluates per page exactly like a direct footer field. Cached field
// result text is never trusted.
//
// Line / fragment ids are namespaced by drawing node id so the body's incremental
// convergence counter never moves because a textbox changed. All bounds are explicit:
// nesting depth, fragment count, and the extent clip all fail closed with reasons.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import { emuToPoints } from './drawing-layout.ts';
import { drawingResourceLayoutToken } from './inline-drawing-source.ts';
import { forEachStoryDrawing } from './semantic-record-queries.ts';
import type { FieldPageContext } from './field-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import {
  resolveStoryListItems,
  withNumberingStyleLinks,
  type ResolvedListItem,
} from './list-resolve.ts';
import type { NumberingIndex } from './numbering-index.ts';
import type { PendingLine } from './paragraph-flow.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';
import { flowBlocksInBox } from './semantic-table-layout.ts';
import type { BlockFragmentRecord, TextMeasurer } from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { textboxStoryBlocks } from './story-roots.ts';

/** Hard ceiling on textbox-in-textbox story descent (mirrors `MAX_TABLE_NESTING`'s role). */
export const MAX_TEXTBOX_STORY_NESTING = 4;

/** Hard ceiling on fragments emitted for one textbox story. */
export const MAX_TEXTBOX_STORY_FRAGMENTS = 256;

/**
 * Why textbox story layout stopped short.
 *
 * Every one is a BOUND rather than a bug: nesting depth, fragment counts and the extent all
 * come from a file. Falling back with a reason keeps the drawing rendered (clipped) instead
 * of failing the layout pass.
 */
export type TextboxStoryFallbackReason =
  | 'textbox-nesting-limit'
  | 'textbox-fragment-limit'
  /** Flowed content is taller than the extent; trailing fragments were dropped. */
  | 'textbox-height-clip';

/**
 * One text box's story laid out inside its extent, in content-box-relative coordinates.
 *
 * Fragments origin at the content box's top-left; paint places the content box at
 * `drawing origin + contentOffset` and clips to the extent.
 */
export interface TextboxStoryLayout {
  /** Content-box-relative fragments (origin at the content box's top-left). */
  readonly fragments: readonly BlockFragmentRecord[];
  /** Height the blocks flow to (points), before vertical anchoring. */
  readonly flowHeight: number;
  /** Offset of the content box inside the drawing extent: insets plus vertical anchoring. */
  readonly contentOffset: Readonly<{ x: number; y: number }>;
  /** Content box width (extent minus horizontal insets). */
  readonly contentWidth: number;
  /** Content box height (extent minus vertical insets). */
  readonly contentHeight: number;
  /** Solid fill of the hosting shape, painted behind the story; null for no fill. */
  readonly fillHex: string | null;
  /** Solid outline of the hosting shape; null for no outline. */
  readonly strokeHex: string | null;
  /** Outline width in points; 0 when absent. */
  readonly strokeWidthPt: number;
  /** True when layout hit a named bound and returned a truncated / empty story. */
  readonly fallbackReason?: TextboxStoryFallbackReason;
  /**
   * Resource identities of the drawings the clip DROPPED, in flow order.
   *
   * The furniture invalidation token walks laid-out records, and a dropped fragment leaves
   * none — while a `withPageContext` projection of the same story can wrap differently
   * (PAGE digits) and keep the drawing. Without this a picture clipped out of the baseline
   * but painted by a projection never reaches the session context, so its decode settling
   * moves nothing and the unchanged-pass early exit reuses the placeholder pages forever
   * (#467). Absent when the clip dropped no drawings, so the common story keys byte-for-byte
   * as before.
   */
  readonly clippedResourceToken?: string;
}

export interface TextboxStoryLayoutOptions {
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]>;
  readonly styleCascade?: StyleCascadeTable;
  readonly defaultTabStopPt?: number;
  /** Host story's page-field context; PAGE-family fields inside the story project against it. */
  readonly pageContext?: FieldPageContext;
  readonly displayMode?: RevisionDisplayMode;
  /** Document properties, for a document-property field inside the text-box story. */
  readonly documentProperties?: import('@docx-editor.dev/core/store').DocumentProperties;
  /** Story nesting depth; a textbox laid out from inside another textbox passes depth + 1. */
  readonly depth?: number;
  /**
   * `numbering.xml`, so a `w:numPr` paragraph in the box resolves a marker.
   *
   * Absent, the story lays out as before: no marker record, and no numbering indent merged
   * into the paragraph's own. Counters are PER BOX ({@link textboxStoryListItems}) — a text
   * box is its own story root, like a note, so its lists restart at `w:start` rather than
   * continuing the host story's.
   */
  readonly numberingIndex?: NumberingIndex;
  /**
   * Inline drawing context for the part the text box lives in.
   *
   * A picture inside `w:txbxContent` is an ordinary inline drawing of the HOST part — same
   * relationships, same resources — so the host's context is the right one. Scoped to inline
   * drawings: an anchored drawing inside a text box would need frame and exclusion semantics
   * against the box, which is a separate question.
   */
  readonly inlineDrawingLayout?: import('./drawing-layout.ts').InlineDrawingLayoutContext;
  /** Per-paragraph projection + resource token for the break cache key. */
  readonly drawingTokenForParagraph?: (
    paragraph: import('@docx-editor.dev/core/store').OoxmlNode
  ) => string;
}

/** Stable line-id namespace for one textbox story. */
export function textboxLineIdPrefix(drawingNodeId: string): string {
  return `txbx-${drawingNodeId}`;
}

interface TextboxStoryListResolve {
  readonly rawIndex: NumberingIndex;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly listItems: ReadonlyMap<string, ResolvedListItem> | undefined;
}

/**
 * Memoized per immutable `w:txbxContent` node, validated against the RAW inputs by identity.
 * Sound because any edit inside the box republishes the content node; a numbering or cascade
 * change keeps the node and misses on the input compare instead.
 */
const textboxStoryListResolves = new WeakMap<OoxmlNode, TextboxStoryListResolve>();

/**
 * Resolve every list paragraph of one text-box story, keyed by paragraph node id.
 *
 * Counters are created fresh per box — a text box is its own story root laid out
 * independently of its host (the {@link textboxStoryBlocks} rule), so its lists restart at
 * `w:start` the way a header's or a note's do, rather than continuing the host story's.
 * Returns undefined when numbering is absent or the box holds no list paragraphs.
 */
export function textboxStoryListItems(
  content: OoxmlNode,
  numberingIndex: NumberingIndex | undefined,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode = 'all-markup'
): ReadonlyMap<string, ResolvedListItem> | undefined {
  if (!numberingIndex || numberingIndex.nums.size === 0) return undefined;
  const memo = textboxStoryListResolves.get(content);
  if (
    memo &&
    memo.rawIndex === numberingIndex &&
    memo.styleCascade === styleCascade &&
    memo.displayMode === displayMode
  ) {
    return memo.listItems;
  }
  const linked = withNumberingStyleLinks(numberingIndex, styleCascade);
  const blocks = textboxStoryBlocks(content, displayMode);
  const resolved = resolveStoryListItems(blocks, linked, styleCascade);
  const listItems = resolved.size > 0 ? resolved : undefined;
  textboxStoryListResolves.set(content, {
    rawIndex: numberingIndex,
    styleCascade,
    displayMode,
    listItems,
  });
  return listItems;
}

/** Hard ceiling on nodes visited when discovering `w:txbxContent` under one block. */
const MAX_HOSTED_STORY_SCAN_NODES = 20_000;

interface HostedContentsScan {
  readonly contents: readonly OoxmlNode[];
  /** True when the budget stopped the walk before the whole subtree was seen. */
  readonly truncated: boolean;
}

const NO_HOSTED_CONTENTS: HostedContentsScan = Object.freeze({
  contents: Object.freeze([]),
  truncated: false,
});

/**
 * The `w:txbxContent` nodes a block hosts — a TREE fact, memoized per immutable block node.
 *
 * Found by name rather than through drawing projections, so an `mc:Fallback` twin of a live
 * box is included too; its list state mirrors the live copy's, which only widens the token
 * below, never wrongs it. No descent INTO a found content: a box inside a box does not lay
 * out (nested stories degrade to the placeholder path), so its list state paints nothing.
 */
const hostedTextboxContentsByBlock = new WeakMap<OoxmlNode, HostedContentsScan>();

function hostedTextboxContents(block: OoxmlNode): HostedContentsScan {
  const cached = hostedTextboxContentsByBlock.get(block);
  if (cached) return cached;
  const found: OoxmlNode[] = [];
  let visited = 0;
  let truncated = false;
  const stack: OoxmlNode[] = [block];
  while (stack.length > 0) {
    const node = stack.pop()!;
    visited += 1;
    // Defensive, like every other file-derived walk — but a stopped scan can MISS a box, and
    // an unseen box's list state must fail OPEN, not stale. The truncation flag is recorded
    // so the token below stops naming individual items and keys on the numbering index
    // itself: every numbering edit then re-lays the block, which wastes work on a hostile
    // file but never reuses a page showing an old marker.
    if (visited > MAX_HOSTED_STORY_SCAN_NODES) {
      truncated = true;
      break;
    }
    if (node.kind !== 'textValue' && node.localName === 'txbxContent') {
      found.push(node);
      continue;
    }
    if (!('children' in node)) continue;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }
  const scan: HostedContentsScan =
    found.length > 0 || truncated
      ? Object.freeze({ contents: Object.freeze(found), truncated })
      : NO_HOSTED_CONTENTS;
  hostedTextboxContentsByBlock.set(block, scan);
  return scan;
}

/**
 * Stable per-object identity of a numbering index, for the truncated-scan token arm.
 *
 * A truncated scan cannot name the items it missed, so its token names the INDEX instead:
 * any `numbering.xml` edit yields a new index object, a new id, and a changed key. Ids only
 * grow with distinct index objects ever tokenized this way — a handful per document life.
 */
let nextNumberingIndexTokenId = 1;
const numberingIndexTokenIds = new WeakMap<NumberingIndex, number>();

function numberingIndexTokenId(index: NumberingIndex): number {
  let id = numberingIndexTokenIds.get(index);
  if (id === undefined) {
    id = nextNumberingIndexTokenId;
    nextNumberingIndexTokenId += 1;
    numberingIndexTokenIds.set(index, id);
  }
  return id;
}

interface HostedListTokenMemo {
  readonly rawIndex: NumberingIndex;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly token: string;
}

const hostedListTokensByBlock = new WeakMap<OoxmlNode, HostedListTokenMemo>();

/**
 * Marker identity of every list item the text-box stories UNDER one block paint.
 *
 * The list sibling of the hosted-story arm of `drawingTokenForParagraph`, for the same
 * reason: a box's markers come from `numbering.xml`, a DIFFERENT part from the one the host
 * paragraph lives in, so a numbering edit moves neither the paragraph node nor its drawing
 * token — and a flow key without this reuses pages showing the old number inside the box.
 * Empty for the overwhelmingly common block with no text box, at the cost of one memoized
 * subtree scan per immutable block node.
 */
export function hostedTextboxListToken(
  block: OoxmlNode,
  numberingIndex: NumberingIndex | undefined,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode = 'all-markup'
): string {
  if (!numberingIndex || numberingIndex.nums.size === 0) return '';
  const scan = hostedTextboxContents(block);
  if (scan.contents.length === 0 && !scan.truncated) return '';
  const memo = hostedListTokensByBlock.get(block);
  if (
    memo &&
    memo.rawIndex === numberingIndex &&
    memo.styleCascade === styleCascade &&
    memo.displayMode === displayMode
  ) {
    return memo.token;
  }
  const parts: string[] = [];
  for (const content of scan.contents) {
    const items = textboxStoryListItems(content, numberingIndex, styleCascade, displayMode);
    if (!items) continue;
    for (const [paragraphId, item] of items) parts.push(`${paragraphId}=${item.cacheToken}`);
  }
  // A truncated scan may have MISSED a box, so it cannot vouch for "no list state": key on
  // the index identity instead, which fails open — every numbering edit moves the key.
  if (scan.truncated) parts.push(`truncated:${numberingIndexTokenId(numberingIndex)}`);
  // NUL-framed: `cacheToken` embeds `w:lvlText`, which a file can fill with any printable
  // separator, so a printable join would let two different hosted list states concatenate
  // to one token and hold a break key still across a numbering edit. XML text cannot carry
  // U+0000, so no file-derived token can forge a part boundary.
  const token = parts.length === 0 ? '' : `|txbxlist:${parts.join('\0')}`;
  hostedListTokensByBlock.set(block, {
    rawIndex: numberingIndex,
    styleCascade,
    displayMode,
    token,
  });
  return token;
}

/**
 * The `hostedListTokenForParagraph` slice of a `TableFlowDeps`, built in ONE place so the
 * lanes that lay hosted stories out (body tables, header/footer stories) cannot drift
 * apart on the (index, cascade, mode) call shape. Empty when there is no numbering to key,
 * which keeps those deps byte-identical to a lane that never folds hosted list state.
 */
export function hostedListTokenDeps(
  numberingIndex: NumberingIndex | undefined,
  styleCascade: StyleCascadeTable | undefined,
  displayMode?: RevisionDisplayMode
): { readonly hostedListTokenForParagraph?: (paragraph: OoxmlNode) => string } {
  if (!numberingIndex || numberingIndex.nums.size === 0) return {};
  return {
    hostedListTokenForParagraph: (paragraph) =>
      hostedTextboxListToken(paragraph, numberingIndex, styleCascade, displayMode),
  };
}

/**
 * Lay a drawing's textbox story out inside its extent.
 *
 * Returns null when the projection carries no textbox story. Never throws: bound hits
 * produce a truncated layout with a named {@link TextboxStoryFallbackReason}.
 */
export function layoutTextboxStory(
  projection: DrawingProjection,
  options: TextboxStoryLayoutOptions
): TextboxStoryLayout | null {
  const story = projection.textboxStory;
  if (!story) return null;

  const extentWidth = emuToPoints(projection.extentEmu.cx);
  const extentHeight = emuToPoints(projection.extentEmu.cy);
  const insetLeft = emuToPoints(story.insetsEmu.left);
  const insetRight = emuToPoints(story.insetsEmu.right);
  const insetTop = emuToPoints(story.insetsEmu.top);
  const insetBottom = emuToPoints(story.insetsEmu.bottom);
  const contentWidth = Math.max(1, extentWidth - insetLeft - insetRight);
  const contentHeight = Math.max(0, extentHeight - insetTop - insetBottom);
  const strokeWidthPt = emuToPoints(story.strokeWidthEmu);

  const chrome = {
    fillHex: story.fillHex,
    strokeHex: story.strokeHex,
    strokeWidthPt,
    contentWidth,
    contentHeight,
  };

  const depth = options.depth ?? 0;
  if (depth >= MAX_TEXTBOX_STORY_NESTING) {
    // No clipped-resource token here: past the ceiling nothing is flowed, so no projection
    // can paint these drawings either. If nested box rendering ever ships, this return must
    // name the story's resources too, or the #467 pattern recurs one level down.
    return {
      fragments: [],
      flowHeight: 0,
      contentOffset: { x: insetLeft, y: insetTop },
      ...chrome,
      fallbackReason: 'textbox-nesting-limit',
    };
  }

  const blocks: readonly OoxmlElement[] = textboxStoryBlocks(story.content, options.displayMode);
  const listItems = textboxStoryListItems(
    story.content,
    options.numberingIndex,
    options.styleCascade,
    options.displayMode
  );
  const prefix = textboxLineIdPrefix(projection.drawingNodeId);
  let lineCounter = 0;

  const flow = flowBlocksInBox(blocks, 0, contentWidth, 0, 0, {
    measurer: options.measurer,
    cache: options.cache,
    producer: `${options.producer}|txbx:${projection.drawingNodeId}`,
    nextLineId: () => `${prefix}-line-${lineCounter++}`,
    styleCascade: options.styleCascade,
    ...(listItems ? { listItems } : {}),
    ...(options.pageContext ? { pageContext: options.pageContext } : {}),
    ...(options.documentProperties ? { documentProperties: options.documentProperties } : {}),
    ...(options.defaultTabStopPt !== undefined
      ? { defaultTabStopPt: options.defaultTabStopPt }
      : {}),
    ...(options.displayMode ? { displayMode: options.displayMode } : {}),
    ...(options.inlineDrawingLayout ? { inlineDrawingLayout: options.inlineDrawingLayout } : {}),
    ...(options.drawingTokenForParagraph
      ? { drawingTokenForParagraph: options.drawingTokenForParagraph }
      : {}),
  });

  let fragments = flow.blocks;
  let flowHeight = flow.bottom;
  let fallbackReason: TextboxStoryFallbackReason | undefined;
  const clippedResourceTokens: string[] = [];

  if (fragments.length > MAX_TEXTBOX_STORY_FRAGMENTS) {
    collectDrawingResourceTokens(
      fragments.slice(MAX_TEXTBOX_STORY_FRAGMENTS),
      clippedResourceTokens
    );
    fragments = fragments.slice(0, MAX_TEXTBOX_STORY_FRAGMENTS);
    const last = fragments[fragments.length - 1];
    flowHeight = last ? last.box.y + last.box.height : 0;
    fallbackReason = 'textbox-fragment-limit';
  }

  // Word clips overflow at the box. Keep fragments that START inside the content height so a
  // partially visible line still paints (the container clips precisely); drop fully-below ones.
  if (flowHeight > contentHeight + 0.001) {
    const kept = fragments.filter((fragment) => fragment.box.y < contentHeight - 0.001);
    if (kept.length < fragments.length) {
      collectDrawingResourceTokens(
        fragments.filter((fragment) => fragment.box.y >= contentHeight - 0.001),
        clippedResourceTokens
      );
      fragments = kept;
      fallbackReason = fallbackReason ?? 'textbox-height-clip';
    }
  }

  // Vertical anchoring positions the flowed content inside the box; overflow pins to the top
  // (offsets never go negative, matching Word's clip-from-top behaviour).
  const slack = Math.max(0, contentHeight - flowHeight);
  const anchorOffset =
    story.verticalAnchor === 'center' ? slack / 2 : story.verticalAnchor === 'bottom' ? slack : 0;

  return {
    fragments,
    flowHeight,
    contentOffset: { x: insetLeft, y: insetTop + anchorOffset },
    ...chrome,
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(clippedResourceTokens.length > 0
      ? { clippedResourceToken: clippedResourceTokens.join('!') }
      : {}),
  };
}

/**
 * Resource tokens of the drawings in clip-dropped fragments.
 *
 * The SAME walk the furniture token uses over kept records, so a new drawing channel can
 * never reach one side of the painted-plus-clipped invariant and not the other.
 */
function collectDrawingResourceTokens(
  blocks: readonly BlockFragmentRecord[],
  tokens: string[]
): void {
  forEachStoryDrawing({ fragments: blocks }, (drawing) => {
    tokens.push(drawingResourceLayoutToken(drawing.resource));
  });
}
