import type { BlockContent, Document, ParagraphContent } from '../../types/document';

export interface RevisionIdAllocator {
  next(): number;
  peek(): number;
  reserve(count: number): number[];
}

class IncrementingRevisionIdAllocator implements RevisionIdAllocator {
  private current: number;

  constructor(startAt: number) {
    this.current = normalizeStartRevisionId(startAt);
  }

  next(): number {
    const id = this.current;
    this.current += 1;
    return id;
  }

  peek(): number {
    return this.current;
  }

  reserve(count: number): number[] {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('reserve count must be a non-negative integer');
    }
    const ids: number[] = [];
    for (let i = 0; i < count; i += 1) {
      ids.push(this.next());
    }
    return ids;
  }
}

export function normalizeStartRevisionId(startAt: number): number {
  if (!Number.isFinite(startAt)) {
    return 1;
  }
  const normalized = Math.floor(startAt);
  return normalized >= 1 ? normalized : 1;
}

export function createRevisionIdAllocator(startAt = 1): RevisionIdAllocator {
  return new IncrementingRevisionIdAllocator(startAt);
}

export function inferMaxRevisionId(document: Document): number {
  let maxId = 0;

  for (const block of document.package.document.content) {
    maxId = Math.max(maxId, collectBlockMaxRevisionId(block));
  }

  return maxId;
}

export function createAllocatorAfterDocument(document: Document): RevisionIdAllocator {
  return createRevisionIdAllocator(inferMaxRevisionId(document) + 1);
}

function collectBlockMaxRevisionId(block: BlockContent): number {
  if (block.type === 'paragraph') {
    return collectParagraphContentMaxRevisionId(block.content);
  }

  if (block.type === 'table') {
    let maxId = collectRevisionIdFromChangeInfo(block.propertyChanges);
    for (const row of block.rows) {
      maxId = Math.max(maxId, collectRevisionIdFromChangeInfo(row.propertyChanges));
      maxId = Math.max(maxId, row.structuralChange?.info.id ?? 0);
      for (const cell of row.cells) {
        maxId = Math.max(maxId, collectRevisionIdFromChangeInfo(cell.propertyChanges));
        maxId = Math.max(maxId, cell.structuralChange?.info.id ?? 0);
        for (const nestedBlock of cell.content) {
          maxId = Math.max(maxId, collectBlockMaxRevisionId(nestedBlock));
        }
      }
    }
    return maxId;
  }

  return 0;
}

function collectParagraphContentMaxRevisionId(contents: ParagraphContent[]): number {
  let maxId = 0;

  for (const content of contents) {
    if (
      content.type === 'insertion' ||
      content.type === 'deletion' ||
      content.type === 'moveFrom' ||
      content.type === 'moveTo'
    ) {
      maxId = Math.max(maxId, content.info.id);
      for (const child of content.content) {
        if (child.type === 'run') {
          maxId = Math.max(maxId, collectRevisionIdFromChangeInfo(child.propertyChanges));
        }
      }
      continue;
    }

    if (
      content.type === 'moveFromRangeStart' ||
      content.type === 'moveFromRangeEnd' ||
      content.type === 'moveToRangeStart' ||
      content.type === 'moveToRangeEnd'
    ) {
      maxId = Math.max(maxId, content.id);
      continue;
    }

    if (content.type === 'run') {
      maxId = Math.max(maxId, collectRevisionIdFromChangeInfo(content.propertyChanges));
      continue;
    }

    if (content.type === 'hyperlink') {
      for (const child of content.children) {
        if (child.type === 'run') {
          maxId = Math.max(maxId, collectRevisionIdFromChangeInfo(child.propertyChanges));
        }
      }
      continue;
    }
  }

  return maxId;
}

function collectRevisionIdFromChangeInfo(
  changes: Array<{ info: { id: number } }> | undefined
): number {
  if (!changes || changes.length === 0) {
    return 0;
  }
  return changes.reduce((maxId, change) => Math.max(maxId, change.info.id), 0);
}
