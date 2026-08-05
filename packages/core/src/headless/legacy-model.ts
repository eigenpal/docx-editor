import type {
  BlockContent,
  Comment,
  Deletion,
  DocumentBody,
  DocxPackage,
  Insertion,
  MoveFrom,
  MoveTo,
  ParagraphContent,
  TrackedChangeContent,
} from './types.ts';
import { getHyperlinkText, getRunText } from './helpers.ts';

export type TrackedChangeItem = Insertion | Deletion | MoveFrom | MoveTo;

export function isTrackedChangeItem(item: ParagraphContent): item is TrackedChangeItem {
  return (
    item.type === 'insertion' ||
    item.type === 'deletion' ||
    item.type === 'moveFrom' ||
    item.type === 'moveTo'
  );
}

export function trackedChangeText(content: readonly TrackedChangeContent[] | undefined): string {
  if (!content) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (item.type === 'run') parts.push(getRunText(item));
    else if (item.type === 'hyperlink') parts.push(getHyperlinkText(item));
    else if ('content' in item && Array.isArray(item.content)) {
      parts.push(trackedChangeText(item.content));
    }
  }
  return parts.join('');
}

/** Structural fingerprint — block/table shape only (comments and inline markers ignored). */
export function legacyStructureFingerprint(body: DocumentBody): string {
  const blocks = body.content.map((block) => {
    if (block.type === 'paragraph') return 'p';
    const rows = block.rows.map((row) => row.cells.map((cell) => cell.content.length).join(','));
    return `t:${rows.join('|')}`;
  });
  return JSON.stringify({ blocks });
}

export function packagesStructurallyEqual(a: DocxPackage, b: DocxPackage): boolean {
  return legacyStructureFingerprint(a.document) === legacyStructureFingerprint(b.document);
}

export function packagesDeepEqual(a: DocxPackage, b: DocxPackage): boolean {
  return JSON.stringify(normalizePackage(a)) === JSON.stringify(normalizePackage(b));
}

function normalizePackage(pkg: DocxPackage): unknown {
  return {
    document: pkg.document,
    footnotes: pkg.footnotes ?? [],
    endnotes: pkg.endnotes ?? [],
  };
}

export function flattenParagraphs(body: DocumentBody): BlockContent[] {
  const out: BlockContent[] = [];
  for (const block of body.content) {
    if (block.type === 'paragraph') out.push(block);
    else {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const cellBlock of cell.content) out.push(cellBlock);
        }
      }
    }
  }
  return out;
}

export function commentDelta(
  before: readonly Comment[] | undefined,
  after: readonly Comment[] | undefined
): readonly Comment[] {
  const prev = new Map((before ?? []).map((c) => [c.id, c]));
  const added: Comment[] = [];
  for (const comment of after ?? []) {
    if (!prev.has(comment.id)) added.push(comment);
  }
  return added;
}
