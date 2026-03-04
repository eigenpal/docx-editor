/**
 * Block-level "diff on save" revisionizer.
 *
 * Known limitations of the two-pointer alignment approach:
 * - Partially edited paragraphs whose text anchor changes are treated as
 *   delete+insert rather than in-place edit.
 * - Worst case is O(n * REALIGN_LOOKAHEAD) for block alignment.
 * - Text-only anchoring can produce false positives for repeated short paragraphs.
 * - This is a "diff on save" approach, not real-time tracking.
 */

import type {
  BlockContent,
  Deletion,
  Document,
  Hyperlink,
  Insertion,
  MoveFrom,
  MoveFromRangeEnd,
  MoveFromRangeStart,
  MoveTo,
  MoveToRangeEnd,
  MoveToRangeStart,
  Paragraph,
  ParagraphContent,
  Run,
  TableCell,
  TableRow,
  Table,
  TrackedChangeInfo,
} from '../../types/document';
import { revisionizeParagraphRuns, type ParagraphRevisionizeOptions } from './revisionizeParagraph';
import { createRevisionIdAllocator, type RevisionIdAllocator } from './revisionIds';
import { createTrackedChangeInfo, resolveRevisionMetadata } from './metadata';
import { extractRuns } from './utils';

/**
 * Maximum number of blocks to scan ahead when re-aligning the two-pointer
 * diff after a mismatch. Higher values catch more distant insertions/deletions
 * but increase worst-case cost from O(n) to O(n * REALIGN_LOOKAHEAD).
 * 64 covers most real-world documents where structural edits are localized.
 */
const REALIGN_LOOKAHEAD = 64;

export interface RevisionizeDocumentOptions extends ParagraphRevisionizeOptions {}

export function revisionizeDocument(
  previous: Document,
  current: Document,
  options: RevisionizeDocumentOptions = {}
): Document {
  const allocator = options.allocator ?? createRevisionIdAllocator(1);
  const paragraphOptions: ParagraphRevisionizeOptions = {
    ...options,
    allocator,
  };

  const previousBlocks = previous.package.document.content;
  const currentBlocks = current.package.document.content;

  const rawBlocks = alignBlocks(previousBlocks, currentBlocks);
  const nextBlocks = applyMoveDetection(rawBlocks, allocator, paragraphOptions);

  return {
    ...current,
    package: {
      ...current.package,
      document: {
        ...current.package.document,
        content: nextBlocks,
      },
    },
  };
}

/**
 * Intermediate representation produced by the two-pointer alignment pass.
 * Blocks are tagged so a subsequent move-detection pass can match deletions
 * against insertions.
 */
interface AlignedBlock {
  kind: 'paired' | 'inserted' | 'deleted';
  previous?: BlockContent;
  current?: BlockContent;
}

function alignBlocks(
  previousBlocks: BlockContent[],
  currentBlocks: BlockContent[]
): AlignedBlock[] {
  const aligned: AlignedBlock[] = [];
  let prevIndex = 0;
  let currIndex = 0;

  while (prevIndex < previousBlocks.length || currIndex < currentBlocks.length) {
    const prevBlock = previousBlocks[prevIndex];
    const currBlock = currentBlocks[currIndex];

    if (!prevBlock && currBlock) {
      aligned.push({ kind: 'inserted', current: currBlock });
      currIndex += 1;
      continue;
    }

    if (prevBlock && !currBlock) {
      aligned.push({ kind: 'deleted', previous: prevBlock });
      prevIndex += 1;
      continue;
    }

    if (!prevBlock || !currBlock) {
      break;
    }

    if (blocksAreEquivalent(prevBlock, currBlock)) {
      aligned.push({ kind: 'paired', previous: prevBlock, current: currBlock });
      prevIndex += 1;
      currIndex += 1;
      continue;
    }

    const nextCurrMatch = findMatchingBlockIndex(
      currentBlocks,
      currIndex + 1,
      prevBlock,
      REALIGN_LOOKAHEAD
    );
    const nextPrevMatch = findMatchingBlockIndex(
      previousBlocks,
      prevIndex + 1,
      currBlock,
      REALIGN_LOOKAHEAD
    );

    if (
      nextCurrMatch !== -1 &&
      (nextPrevMatch === -1 || nextCurrMatch - currIndex <= nextPrevMatch - prevIndex)
    ) {
      while (currIndex < nextCurrMatch) {
        aligned.push({ kind: 'inserted', current: currentBlocks[currIndex] });
        currIndex += 1;
      }
      continue;
    }

    if (nextPrevMatch !== -1) {
      while (prevIndex < nextPrevMatch) {
        aligned.push({ kind: 'deleted', previous: previousBlocks[prevIndex] });
        prevIndex += 1;
      }
      continue;
    }

    aligned.push({ kind: 'paired', previous: prevBlock, current: currBlock });
    prevIndex += 1;
    currIndex += 1;
  }

  return aligned;
}

/**
 * Detect moves among aligned blocks. When a deleted block and an inserted
 * block share the same text anchor, they form a move pair: the deletion
 * becomes a moveFrom and the insertion becomes a moveTo, linked by paired
 * w:moveFromRangeStart/End and w:moveToRangeStart/End markers with matching
 * range IDs (ECMA-376 §17.13.5.21–24).
 */
function applyMoveDetection(
  aligned: AlignedBlock[],
  allocator: RevisionIdAllocator,
  options: ParagraphRevisionizeOptions
): BlockContent[] {
  const deletions: { index: number; anchor: string; block: BlockContent }[] = [];
  const insertions: { index: number; anchor: string; block: BlockContent }[] = [];

  for (let i = 0; i < aligned.length; i++) {
    const entry = aligned[i];
    if (entry.kind === 'deleted' && entry.previous) {
      deletions.push({ index: i, anchor: getBlockAnchor(entry.previous), block: entry.previous });
    } else if (entry.kind === 'inserted' && entry.current) {
      insertions.push({ index: i, anchor: getBlockAnchor(entry.current), block: entry.current });
    }
  }

  const moveFromMeta = resolveRevisionMetadata(options.deletionMetadata, options.fallbackAuthor);
  const moveToMeta = resolveRevisionMetadata(options.insertionMetadata, options.fallbackAuthor);

  const movePairs: {
    deleteIdx: number;
    insertIdx: number;
    rangeId: number;
    changeInfo: TrackedChangeInfo;
    moveToInfo: TrackedChangeInfo;
  }[] = [];
  const usedDeletions = new Set<number>();
  const usedInsertions = new Set<number>();

  for (const del of deletions) {
    if (usedDeletions.has(del.index)) continue;
    if (!del.anchor) continue;
    for (const ins of insertions) {
      if (usedInsertions.has(ins.index)) continue;
      if (del.anchor === ins.anchor) {
        const rangeId = allocator.next();
        const sharedRevId = allocator.next();
        const changeInfo = createTrackedChangeInfo(sharedRevId, moveFromMeta);
        const moveToInfo = createTrackedChangeInfo(sharedRevId, moveToMeta);
        movePairs.push({
          deleteIdx: del.index,
          insertIdx: ins.index,
          rangeId,
          changeInfo,
          moveToInfo,
        });
        usedDeletions.add(del.index);
        usedInsertions.add(ins.index);
        break;
      }
    }
  }

  const moveFromMap = new Map<number, (typeof movePairs)[0]>();
  const moveToMap = new Map<number, (typeof movePairs)[0]>();
  for (const pair of movePairs) {
    moveFromMap.set(pair.deleteIdx, pair);
    moveToMap.set(pair.insertIdx, pair);
  }

  const result: BlockContent[] = [];

  for (let i = 0; i < aligned.length; i++) {
    const entry = aligned[i];

    if (entry.kind === 'paired') {
      appendPairedBlocks(result, entry.previous!, entry.current!, options);
      continue;
    }

    if (entry.kind === 'deleted') {
      const movePair = moveFromMap.get(i);
      if (movePair) {
        appendMoveBlock(result, entry.previous!, 'moveFrom', movePair.rangeId, movePair.changeInfo);
      } else {
        appendDeletedBlock(result, entry.previous!, options);
      }
      continue;
    }

    if (entry.kind === 'inserted') {
      const movePair = moveToMap.get(i);
      if (movePair) {
        appendMoveBlock(result, entry.current!, 'moveTo', movePair.rangeId, movePair.moveToInfo);
      } else {
        appendInsertedBlock(result, entry.current!, options);
      }
    }
  }

  return result;
}

function getBlockAnchor(block: BlockContent): string {
  if (block.type === 'paragraph') return getParagraphAnchor(block);
  if (block.type === 'table') return getTableAnchor(block);
  return '';
}

function appendPairedBlocks(
  result: BlockContent[],
  previous: BlockContent,
  current: BlockContent,
  options: RevisionizeDocumentOptions
): void {
  if (previous.type === 'paragraph' && current.type === 'paragraph') {
    result.push(revisionizeParagraphBlock(previous, current, options));
    return;
  }

  if (previous.type === 'table' && current.type === 'table') {
    result.push(revisionizeTableBlock(previous, current, options));
    return;
  }

  result.push(current);
}

function appendInsertedBlock(
  result: BlockContent[],
  block: BlockContent | undefined,
  options: RevisionizeDocumentOptions
): void {
  if (!block) return;
  if (block.type === 'paragraph') {
    result.push(revisionizeWholeParagraph(block, 'insertion', options));
    return;
  }
  if (block.type === 'table') {
    result.push(revisionizeWholeTable(block, 'insertion', options));
    return;
  }
  result.push(block);
}

function appendDeletedBlock(
  result: BlockContent[],
  block: BlockContent | undefined,
  options: RevisionizeDocumentOptions
): void {
  if (!block) return;
  if (block.type === 'paragraph') {
    result.push(revisionizeWholeParagraph(block, 'deletion', options));
    return;
  }
  if (block.type === 'table') {
    result.push(revisionizeWholeTable(block, 'deletion', options));
  }
}

function appendMoveBlock(
  result: BlockContent[],
  block: BlockContent,
  mode: 'moveFrom' | 'moveTo',
  rangeId: number,
  changeInfo: TrackedChangeInfo
): void {
  const rangeName = `move${rangeId}`;
  if (block.type === 'paragraph') {
    result.push(wrapParagraphInMove(block, mode, rangeId, rangeName, changeInfo));
    return;
  }
  if (block.type === 'table') {
    result.push(wrapTableInMove(block, mode, rangeId, rangeName, changeInfo));
  }
}

function collectLeafParagraphs(table: Table): Paragraph[] {
  const leaves: Paragraph[] = [];
  for (const row of table.rows) {
    for (const cell of row.cells) {
      for (const block of cell.content) {
        if (block.type === 'paragraph') {
          leaves.push(block);
        } else if (block.type === 'table') {
          leaves.push(...collectLeafParagraphs(block));
        }
      }
    }
  }
  return leaves;
}

function wrapTableInMove(
  table: Table,
  mode: 'moveFrom' | 'moveTo',
  rangeId: number,
  rangeName: string,
  changeInfo: TrackedChangeInfo
): Table {
  const leaves = collectLeafParagraphs(table);
  const first = leaves[0];
  const last = leaves[leaves.length - 1];
  const rangeStartType = mode === 'moveFrom' ? 'moveFromRangeStart' : 'moveToRangeStart';
  const rangeEndType = mode === 'moveFrom' ? 'moveFromRangeEnd' : 'moveToRangeEnd';

  function wrapPara(p: Paragraph): Paragraph {
    const moveContent = p.content.filter(
      (item): item is Run | Hyperlink => item.type === 'run' || item.type === 'hyperlink'
    );
    const wrapper: MoveFrom | MoveTo = { type: mode, info: changeInfo, content: moveContent };
    const items: ParagraphContent[] = [];
    if (p === first) {
      items.push({
        type: rangeStartType,
        id: rangeId,
        name: rangeName,
      } as MoveFromRangeStart | MoveToRangeStart);
    }
    items.push(wrapper);
    if (p === last) {
      items.push({ type: rangeEndType, id: rangeId } as MoveFromRangeEnd | MoveToRangeEnd);
    }
    return { ...p, content: items };
  }

  function wrapContent(t: Table): Table {
    const rows: TableRow[] = t.rows.map((row) => {
      const cells: TableCell[] = row.cells.map((cell) => {
        const content = cell.content.map((block) => {
          if (block.type === 'paragraph') return wrapPara(block);
          if (block.type === 'table') return wrapContent(block);
          return block;
        });
        return { ...cell, content: content as (Paragraph | Table)[] };
      });
      return { ...row, cells };
    });
    return { ...t, rows };
  }

  return wrapContent(table);
}

function wrapParagraphInMove(
  paragraph: Paragraph,
  mode: 'moveFrom' | 'moveTo',
  rangeId: number,
  rangeName: string,
  changeInfo: TrackedChangeInfo
): Paragraph {
  // Preserve runs and hyperlinks (with their link metadata) — do not flatten
  // hyperlink children into plain runs, which would discard href and related attrs.
  const moveContent = paragraph.content.filter(
    (item): item is Run | Hyperlink => item.type === 'run' || item.type === 'hyperlink'
  );
  const wrapper: MoveFrom | MoveTo = {
    type: mode,
    info: changeInfo,
    content: moveContent,
  };
  const rangeStartType = mode === 'moveFrom' ? 'moveFromRangeStart' : 'moveToRangeStart';
  const rangeEndType = mode === 'moveFrom' ? 'moveFromRangeEnd' : 'moveToRangeEnd';
  const content: ParagraphContent[] = [
    { type: rangeStartType, id: rangeId, name: rangeName } as MoveFromRangeStart | MoveToRangeStart,
    wrapper,
    { type: rangeEndType, id: rangeId } as MoveFromRangeEnd | MoveToRangeEnd,
  ];
  return { ...paragraph, content };
}

function revisionizeWholeParagraph(
  paragraph: Paragraph,
  mode: 'insertion' | 'deletion',
  options: RevisionizeDocumentOptions
): Paragraph {
  const runs = extractRuns(paragraph.content);
  const allocator = options.allocator ?? createRevisionIdAllocator(1);
  const insertionMeta = resolveRevisionMetadata(options.insertionMetadata, options.fallbackAuthor);
  const deletionMeta = resolveRevisionMetadata(options.deletionMetadata, options.fallbackAuthor);
  const meta = mode === 'insertion' ? insertionMeta : deletionMeta;
  const info = createTrackedChangeInfo(allocator.next(), meta);
  const wrapper: Insertion | Deletion = { type: mode, info, content: runs };
  return { ...paragraph, content: [wrapper] };
}

function revisionizeWholeTable(
  table: Table,
  mode: 'insertion' | 'deletion',
  options: RevisionizeDocumentOptions
): Table {
  const rows: TableRow[] = table.rows.map((row) => {
    const cells: TableCell[] = row.cells.map((cell) => {
      const content = cell.content.map((block) => {
        if (block.type === 'paragraph') {
          return revisionizeWholeParagraph(block, mode, options);
        }
        if (block.type === 'table') {
          return revisionizeWholeTable(block, mode, options);
        }
        return block;
      });
      return { ...cell, content: content as (Paragraph | Table)[] };
    });
    return { ...row, cells };
  });

  return { ...table, rows };
}

function findMatchingBlockIndex(
  blocks: BlockContent[],
  startIndex: number,
  target: BlockContent,
  lookahead: number
): number {
  const maxIndex = Math.min(blocks.length, startIndex + lookahead);
  for (let i = startIndex; i < maxIndex; i += 1) {
    if (blocksAreEquivalent(blocks[i], target)) {
      return i;
    }
  }
  return -1;
}

function blocksAreEquivalent(previous: BlockContent, current: BlockContent): boolean {
  if (previous.type !== current.type) {
    return false;
  }

  if (previous.type === 'paragraph' && current.type === 'paragraph') {
    return getParagraphAnchor(previous) === getParagraphAnchor(current);
  }

  if (previous.type === 'table' && current.type === 'table') {
    return getTableAnchor(previous) === getTableAnchor(current);
  }

  return false;
}

function getParagraphAnchor(paragraph: Paragraph): string {
  return `${paragraph.formatting?.styleId ?? ''}|${extractRuns(paragraph.content)
    .flatMap((run) =>
      run.content
        .filter((content): content is { type: 'text'; text: string } => content.type === 'text')
        .map((content) => content.text)
    )
    .join('')}`;
}

function getTableAnchor(table: Table): string {
  const rows = table.rows.map((row) =>
    row.cells
      .map((cell) =>
        cell.content
          .filter((content): content is Paragraph => content.type === 'paragraph')
          .map((paragraph) => getParagraphAnchor(paragraph))
          .join('||')
      )
      .join('|')
  );
  return `${table.formatting?.styleId ?? ''}|${rows.join('::')}`;
}

function revisionizeParagraphBlock(
  previous: Paragraph,
  current: Paragraph,
  options: RevisionizeDocumentOptions
): Paragraph {
  const previousRuns = extractRuns(previous.content);
  const currentRuns = extractRuns(current.content);
  const content = revisionizeParagraphRuns(previousRuns, currentRuns, options);

  return {
    ...current,
    content,
  };
}

function revisionizeTableBlock(
  previous: Table,
  current: Table,
  options: RevisionizeDocumentOptions
): Table {
  const rowCount = Math.max(previous.rows.length, current.rows.length);
  const rows: TableRow[] = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const previousRow = previous.rows[rowIndex];
    const currentRow = current.rows[rowIndex];

    if (!currentRow) {
      rows.push(revisionizeWholeRow(previousRow, 'deletion', options));
      continue;
    }

    if (!previousRow) {
      rows.push(revisionizeWholeRow(currentRow, 'insertion', options));
      continue;
    }

    rows.push({
      ...currentRow,
      cells: revisionizeTableCells(previousRow.cells, currentRow.cells, options),
    });
  }

  return {
    ...current,
    rows,
  };
}

function revisionizeWholeRow(
  row: TableRow,
  mode: 'insertion' | 'deletion',
  options: RevisionizeDocumentOptions
): TableRow {
  const cells: TableCell[] = row.cells.map((cell) => {
    const content = cell.content.map((block) => {
      if (block.type === 'paragraph') {
        return revisionizeWholeParagraph(block, mode, options);
      }
      if (block.type === 'table') {
        return revisionizeWholeTable(block, mode, options);
      }
      return block;
    });
    return { ...cell, content: content as (Paragraph | Table)[] };
  });
  return { ...row, cells };
}

function revisionizeTableCells(
  previousCells: TableCell[],
  currentCells: TableCell[],
  options: RevisionizeDocumentOptions
): TableCell[] {
  const cellCount = Math.max(previousCells.length, currentCells.length);
  const cells: TableCell[] = [];

  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const previousCell = previousCells[cellIndex];
    const currentCell = currentCells[cellIndex];

    if (!currentCell) {
      cells.push(revisionizeWholeCell(previousCell, 'deletion', options));
      continue;
    }

    if (!previousCell) {
      cells.push(revisionizeWholeCell(currentCell, 'insertion', options));
      continue;
    }

    cells.push({
      ...currentCell,
      content: revisionizeTableCellContent(previousCell.content, currentCell.content, options),
    });
  }

  return cells;
}

function revisionizeWholeCell(
  cell: TableCell,
  mode: 'insertion' | 'deletion',
  options: RevisionizeDocumentOptions
): TableCell {
  const content = cell.content.map((block) => {
    if (block.type === 'paragraph') {
      return revisionizeWholeParagraph(block, mode, options);
    }
    if (block.type === 'table') {
      return revisionizeWholeTable(block, mode, options);
    }
    return block;
  });
  return { ...cell, content: content as (Paragraph | Table)[] };
}

function revisionizeTableCellContent(
  previous: (Paragraph | Table)[],
  current: (Paragraph | Table)[],
  options: RevisionizeDocumentOptions
): (Paragraph | Table)[] {
  const revisedBlocks = revisionizeDocument(
    createDocumentFromBlocks(previous),
    createDocumentFromBlocks(current),
    options
  ).package.document.content;

  return revisedBlocks.filter(
    (block): block is Paragraph | Table => block.type === 'paragraph' || block.type === 'table'
  );
}

function createDocumentFromBlocks(blocks: BlockContent[]): Document {
  return {
    package: {
      document: {
        content: blocks,
      },
    },
  };
}
