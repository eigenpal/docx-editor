// Vertical placement for top-level `w:tblpPr` tables.

import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import type { BlockFragmentRecord, TableFragmentRecord } from './semantic-records.ts';
import { readTableStructure, type TableFloatPosition } from './semantic-table.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

type PositionedTableFragment = TableFragmentRecord & { readonly outOfFlow: true };

type PositionableBlock =
  | { readonly kind: 'table'; readonly table: OoxmlElement }
  | {
      readonly kind: 'paragraph';
      readonly paragraph: OoxmlElement;
      readonly props: readonly OoxmlProperty[];
    };

export interface PositionedTableAnchor {
  readonly table: OoxmlElement;
  readonly sourceIndex: number;
  readonly anchorId: string;
}

export interface PositionedTableAnchorSignal {
  readonly anchorId: string;
  readonly column: number;
  readonly fragmentIndex: number;
}

const anchorsByParagraphMemo = new WeakMap<
  readonly PositionedTableAnchor[],
  ReadonlyMap<string, readonly PositionedTableAnchor[]>
>();

function anchorsByParagraph(
  positionedTables: readonly PositionedTableAnchor[]
): ReadonlyMap<string, readonly PositionedTableAnchor[]> {
  const memo = anchorsByParagraphMemo.get(positionedTables);
  if (memo) return memo;
  const mutable = new Map<string, PositionedTableAnchor[]>();
  for (const positioned of positionedTables) {
    const entries = mutable.get(positioned.anchorId) ?? [];
    entries.push(positioned);
    mutable.set(positioned.anchorId, entries);
  }
  anchorsByParagraphMemo.set(positionedTables, mutable);
  return mutable;
}

/** Resolve each sheet-positioned table to the next regular paragraph in document order. */
export function positionedTableAnchors(
  blocks: readonly PositionableBlock[],
  contentWidth: number,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode,
  authorFilter: RevisionAuthorFilter | undefined
): PositionedTableAnchor[] {
  const result: PositionedTableAnchor[] = [];
  let nextParagraphId: string | undefined;
  for (let sourceIndex = blocks.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
    const block = blocks[sourceIndex]!;
    if (
      block.kind === 'paragraph' &&
      !block.props.some((property) => property.localName === 'framePr')
    ) {
      nextParagraphId = block.paragraph.id;
      continue;
    }
    if (block.kind !== 'table') continue;
    const float = readTableStructure(
      block.table,
      contentWidth,
      0,
      styleCascade,
      displayMode,
      authorFilter
    )?.float;
    if (!float || float.vertAnchor === 'text' || float.ySpec === 'inline') continue;
    if (!nextParagraphId) continue;
    result.push({
      table: block.table,
      sourceIndex,
      anchorId: nextParagraphId,
    });
  }
  return result.reverse();
}

function sameStrings(left: readonly string[] | undefined, right: readonly string[]): boolean {
  const values = left ?? [];
  return values.length === right.length && values.every((value, index) => value === right[index]);
}

function sameAnchorSignals(
  left: readonly PositionedTableAnchorSignal[] | undefined,
  right: readonly PositionedTableAnchorSignal[]
): boolean {
  const values = left ?? [];
  return (
    values.length === right.length &&
    values.every(
      (value, index) =>
        value.anchorId === right[index]!.anchorId &&
        value.column === right[index]!.column &&
        value.fragmentIndex === right[index]!.fragmentIndex
    )
  );
}

interface PositionedTableCheckpointState {
  readonly pendingPositionedTableTokens?: readonly string[];
  readonly positionedTableAnchorSignals?: readonly PositionedTableAnchorSignal[];
}

/** Capture, restore, and compare the deferred-table portion of a flow checkpoint. */
export function positionedTableFlow(
  positionedTables: readonly PositionedTableAnchor[],
  flowKeys: readonly string[]
) {
  const tokenById = new Map<string, string>();
  const idByToken = new Map<string, string>();
  const anchorIds = new Set<string>();
  for (const positioned of positionedTables) {
    const token = JSON.stringify([positioned.table.id, flowKeys[positioned.sourceIndex]]);
    tokenById.set(positioned.table.id, token);
    idByToken.set(token, positioned.table.id);
    anchorIds.add(positioned.anchorId);
  }
  const tokensOf = (pendingIds: ReadonlySet<string>): string[] =>
    [...pendingIds].flatMap((id) => {
      const token = tokenById.get(id);
      return token ? [token] : [];
    });
  return {
    note(
      signals: PositionedTableAnchorSignal[],
      anchorId: string,
      column: number,
      fragmentIndex: number
    ): void {
      if (anchorIds.has(anchorId)) signals.push({ anchorId, column, fragmentIndex });
    },
    checkpoint(pendingIds: ReadonlySet<string>, signals: readonly PositionedTableAnchorSignal[]) {
      return {
        pendingPositionedTableTokens: tokensOf(pendingIds),
        positionedTableAnchorSignals: [...signals],
      };
    },
    restore(
      checkpoint: PositionedTableCheckpointState,
      pendingIds: Set<string>,
      signals: PositionedTableAnchorSignal[]
    ): void {
      pendingIds.clear();
      for (const token of checkpoint.pendingPositionedTableTokens ?? []) {
        const id = idByToken.get(token);
        if (id) pendingIds.add(id);
      }
      signals.splice(0, signals.length, ...(checkpoint.positionedTableAnchorSignals ?? []));
    },
    same(
      priorTokens: readonly string[] | undefined,
      priorSignals: readonly PositionedTableAnchorSignal[] | undefined,
      pendingIds: ReadonlySet<string>,
      signals: readonly PositionedTableAnchorSignal[]
    ): boolean {
      return (
        sameStrings(priorTokens, tokensOf(pendingIds)) && sameAnchorSignals(priorSignals, signals)
      );
    },
  };
}

/** Paint tables whose logical anchor paragraph has reached the page being closed. */
export function publishPositionedTablesOnPage(
  positionedTables: readonly PositionedTableAnchor[],
  outstandingIds: Set<string>,
  pageFragments: BlockFragmentRecord[],
  anchorSignals: PositionedTableAnchorSignal[],
  placeTable: (table: OoxmlElement, column: number) => void
): void {
  const byParagraph = anchorsByParagraph(positionedTables);
  let insertedFragments = 0;
  for (const signal of anchorSignals) {
    const positionedForAnchor = byParagraph.get(signal.anchorId);
    if (!positionedForAnchor) continue;
    const insertionIndex = signal.fragmentIndex + insertedFragments;
    const publishedAt = pageFragments.length;
    for (const positioned of positionedForAnchor) {
      if (!outstandingIds.has(positioned.table.id)) continue;
      placeTable(positioned.table, signal.column);
      outstandingIds.delete(positioned.table.id);
    }
    const fragments = pageFragments.splice(publishedAt);
    pageFragments.splice(insertionIndex, 0, ...fragments);
    insertedFragments += fragments.length;
  }
  anchorSignals.length = 0;
}

/** True when a table paints on its anchor sheet without consuming body flow. */
export function isOutOfFlowTableFragment(
  fragment: BlockFragmentRecord
): fragment is PositionedTableFragment {
  return fragment.kind === 'table' && (fragment as PositionedTableFragment).outOfFlow === true;
}

/** One vertical anchor box, in page-content coordinates. */
export interface TableVerticalAnchorFrame {
  readonly top: number;
  readonly height: number;
}

/** The three boxes `w:vertAnchor` can name, resolved for the page being laid out. */
export interface TableVerticalAnchorFrames {
  readonly text: TableVerticalAnchorFrame;
  readonly margin: TableVerticalAnchorFrame;
  readonly page: TableVerticalAnchorFrame;
}

/** The page facts needed to resolve table vertical anchor frames. */
export interface BodyTableVerticalFrameInput {
  readonly pageHeight: number;
  readonly contentInsetTop: number;
  readonly contentHeight: number;
  readonly marginBottom: number;
}

export function bodyTableVerticalAnchorFrames(
  input: BodyTableVerticalFrameInput,
  cursorY: number,
  marginTop: number
): TableVerticalAnchorFrames {
  return {
    text: { top: cursorY, height: Math.max(0, input.contentHeight - cursorY) },
    margin: {
      top: marginTop - input.contentInsetTop,
      height: Math.max(0, input.pageHeight - marginTop - input.marginBottom),
    },
    page: { top: -input.contentInsetTop, height: input.pageHeight },
  };
}

/** True when the current region holds body-flow content. */
export function hasFlowFragments(
  fragments: readonly BlockFragmentRecord[],
  start: number
): boolean {
  for (let index = start; index < fragments.length; index += 1) {
    const fragment = fragments[index]!;
    if (!isOutOfFlowTableFragment(fragment)) return true;
  }
  return false;
}

/**
 * Resolve a floated table's top edge in page-content coordinates.
 *
 * A vertical alignment supersedes `w:tblpY`. `inside` and `outside` use top and bottom until
 * mirrored page margins are modelled. The clamp keeps the leading edge on the sheet.
 */
export function tableFloatOriginY(
  float: TableFloatPosition,
  tableHeightPt: number,
  frames: TableVerticalAnchorFrames
): number {
  const frame = frames[float.vertAnchor];
  const slack = frame.height - tableHeightPt;
  let y: number;
  if (float.ySpec === 'center') y = frame.top + slack / 2;
  else if (float.ySpec === 'bottom' || float.ySpec === 'outside') y = frame.top + slack;
  else if (float.ySpec) y = frame.top;
  else y = frame.top + float.yPt;
  if (!Number.isFinite(y)) return frame.top;
  const pageBottom = frames.page.top + frames.page.height;
  return Math.max(frames.page.top, Math.min(y, pageBottom));
}
