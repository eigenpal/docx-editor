import { readOoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import type {
  BlockContent,
  Comment,
  Document as HeadlessDocument,
  DocumentBody,
  DocxInput,
  DocxPackage,
  Endnote,
  Footnote,
  Hyperlink,
  Insertion,
  Deletion,
  MoveFrom,
  MoveTo,
  Paragraph,
  ParagraphContent,
  ParseOptions,
  Run,
  Table,
  TrackedChangeContent,
  TrackedChangeInfo,
} from './types.ts';
import { makeRun } from './helpers.ts';
import { collectParagraphIds } from './anchors.ts';
import { attachHeadlessContext, cloneHeadlessContext, headlessContextOf } from './context.ts';
import { buildRevisionIndex, collectNoteParagraphIds } from './revision-bridge.ts';
import { cloneResolutionLog } from './resolution-log.ts';
import { HeadlessRepackRefusal } from './headless-errors.ts';
import { repackFromCanonicalContext } from './reconcile.ts';

type AnyNode = {
  readonly kind?: string;
  readonly localName?: string;
  readonly attributes?: readonly { readonly localName: string; readonly value: string }[];
  readonly children?: readonly AnyNode[];
  readonly text?: string;
};

function attr(node: AnyNode, localName: string): string | undefined {
  return node.attributes?.find((a) => a.localName === localName)?.value;
}

function revisionInfo(node: AnyNode): TrackedChangeInfo {
  return {
    id: Number.parseInt(attr(node, 'id') ?? '0', 10),
    author: attr(node, 'author') ?? '',
    date: attr(node, 'date'),
  };
}

function runsFromChildren(children: readonly AnyNode[] | undefined): Run[] {
  const runs: Run[] = [];
  for (const child of children ?? []) {
    if (child.kind === 'run') {
      const run = runFromNode(child);
      if (run) runs.push(run);
    } else if (child.kind === 'hyperlink') {
      for (const nested of child.children ?? []) {
        if (nested.kind === 'run') {
          const run = runFromNode(nested);
          if (run) runs.push(run);
        }
      }
    }
  }
  return runs;
}

function textValueOf(node: AnyNode): string {
  if (node.kind === 'textValue') return (node as { value?: string }).value ?? node.text ?? '';
  for (const child of node.children ?? []) {
    if (child.kind === 'textValue') return (child as { value?: string }).value ?? child.text ?? '';
  }
  return '';
}

function runFromNode(node: AnyNode): Run | null {
  const parts: Run['content'] = [];
  for (const child of node.children ?? []) {
    if (child.kind === 'runProperties') continue;
    if (child.kind === 'text' || child.kind === 'deletedText') {
      const text = textValueOf(child);
      parts.push({
        type: 'text',
        text,
        ...(/^\s|\s$/.test(text) ? { preserveSpace: true } : {}),
      });
    } else if (child.kind === 'tab' || child.localName === 'tab') {
      parts.push({ type: 'tab' });
    } else if (child.kind === 'hardBreak' || child.localName === 'br') {
      parts.push({ type: 'break', breakType: 'line' });
    }
  }
  if (parts.length === 0) return null;
  return { type: 'run', content: parts };
}

function trackedContentFromChildren(
  children: readonly AnyNode[] | undefined
): TrackedChangeContent[] {
  const content: TrackedChangeContent[] = [];
  for (const child of children ?? []) {
    if (child.kind === 'run') {
      const run = runFromNode(child);
      if (run) content.push(run);
      continue;
    }
    if (child.kind === 'hyperlink') {
      content.push({
        type: 'hyperlink',
        href: attr(child, 'id'),
        anchor: attr(child, 'anchor'),
        children: runsFromChildren(child.children),
      } satisfies Hyperlink);
      continue;
    }
    if (
      child.kind === 'revisionInsert' ||
      child.kind === 'revisionDelete' ||
      child.kind === 'revisionMoveFrom' ||
      child.kind === 'revisionMoveTo'
    ) {
      const mapped = revisionFromNode(child);
      if (mapped) content.push(mapped);
    }
  }
  return content;
}

function paragraphContentFromChildren(
  children: readonly AnyNode[] | undefined
): ParagraphContent[] {
  const content: ParagraphContent[] = [];
  for (const child of children ?? []) {
    if (child.kind === 'run') {
      const run = runFromNode(child);
      if (run) content.push(run);
      continue;
    }
    if (child.kind === 'hyperlink') {
      content.push({
        type: 'hyperlink',
        href: attr(child, 'id'),
        anchor: attr(child, 'anchor'),
        children: runsFromChildren(child.children),
      } satisfies Hyperlink);
      continue;
    }
    if (child.localName === 'commentRangeStart') {
      content.push({
        type: 'commentRangeStart',
        id: Number.parseInt(attr(child, 'id') ?? '0', 10),
      });
      continue;
    }
    if (child.localName === 'commentRangeEnd') {
      content.push({
        type: 'commentRangeEnd',
        id: Number.parseInt(attr(child, 'id') ?? '0', 10),
      });
      continue;
    }
    if (
      child.kind === 'revisionInsert' ||
      child.kind === 'revisionDelete' ||
      child.kind === 'revisionMoveFrom' ||
      child.kind === 'revisionMoveTo'
    ) {
      const mapped = revisionFromNode(child);
      if (mapped) content.push(mapped);
    }
  }
  return content;
}

function revisionFromNode(node: AnyNode): Insertion | Deletion | MoveFrom | MoveTo | null {
  const info = revisionInfo(node);
  const inner = trackedContentFromChildren(node.children);
  switch (node.kind) {
    case 'revisionInsert':
      return { type: 'insertion', info, content: inner };
    case 'revisionDelete':
      return { type: 'deletion', info, content: inner };
    case 'revisionMoveFrom':
      return { type: 'moveFrom', info, content: inner };
    case 'revisionMoveTo':
      return { type: 'moveTo', info, content: inner };
    default:
      return null;
  }
}

function paragraphFromNode(node: AnyNode): Paragraph {
  const pPr = node.children?.find((c) => c.kind === 'paragraphProperties');
  const pStyle = pPr?.children?.find((c) => c.localName === 'pStyle');
  const styleId = pStyle ? attr(pStyle, 'val') : undefined;
  return {
    type: 'paragraph',
    paraId: attr(node, 'paraId'),
    formatting: styleId ? { styleId } : undefined,
    content: paragraphContentFromChildren(node.children),
  };
}

function tableFromNode(node: AnyNode): Table {
  const rows = (node.children ?? [])
    .filter((c) => c.kind === 'tableRow')
    .map((row) => ({
      cells: (row.children ?? [])
        .filter((c) => c.kind === 'tableCell')
        .map((cell) => ({
          content: (cell.children ?? [])
            .filter((c) => c.kind === 'paragraph')
            .map((p) => paragraphFromNode(p)),
        })),
    }));
  return { type: 'table', rows };
}

function blocksFromStory(root: AnyNode): BlockContent[] {
  const body = root.children?.find((c) => c.kind === 'body');
  if (!body) return [];
  const blocks: BlockContent[] = [];
  for (const child of body.children ?? []) {
    if (child.kind === 'paragraph') blocks.push(paragraphFromNode(child));
    else if (child.kind === 'table') blocks.push(tableFromNode(child));
  }
  return blocks;
}

function commentsFromPart(part: OoxmlPart | undefined): Comment[] {
  if (!part) return [];
  const root = part.root as AnyNode;
  return (root.children ?? [])
    .filter((c) => c.kind === 'comment')
    .map((node) => ({
      id: Number.parseInt(attr(node, 'id') ?? '0', 10),
      author: attr(node, 'author') ?? '',
      date: attr(node, 'date'),
      parentId: attr(node, 'parentId') ? Number.parseInt(attr(node, 'parentId')!, 10) : undefined,
      done: attr(node, 'done') === '1' || attr(node, 'done') === 'true',
      content: (node.children ?? [])
        .filter((c) => c.kind === 'paragraph')
        .map((p) => paragraphFromNode(p)),
    }));
}

function notesFromPart(
  part: OoxmlPart | undefined,
  noteType: 'footnote' | 'endnote'
): Footnote[] | Endnote[] {
  if (!part) return [];
  const root = part.root as AnyNode;
  const localName = noteType === 'footnote' ? 'footnote' : 'endnote';
  return (root.children ?? [])
    .filter((c) => c.localName === localName)
    .map((node) => ({
      id: Number.parseInt(attr(node, 'id') ?? '0', 10),
      content: (node.children ?? [])
        .filter((c) => c.kind === 'paragraph')
        .map((p) => paragraphFromNode(p)),
    }));
}

export function packageToLegacyDoc(
  pkg: import('../store/package/ooxml-package.ts').OoxmlPackage,
  originalBuffer?: ArrayBuffer
): HeadlessDocument {
  const main = pkg.parts.get('/word/document.xml');
  const commentsPart = pkg.parts.get('/word/comments.xml');
  const footnotesPart = pkg.parts.get('/word/footnotes.xml');
  const endnotesPart = pkg.parts.get('/word/endnotes.xml');
  const body: DocumentBody = {
    content: main ? blocksFromStory(main.root as AnyNode) : [],
    comments: commentsFromPart(commentsPart),
  };
  const legacyPackage: DocxPackage = {
    document: body,
    footnotes: notesFromPart(footnotesPart, 'footnote') as Footnote[],
    endnotes: notesFromPart(endnotesPart, 'endnote') as Endnote[],
  };
  const doc: HeadlessDocument = { package: legacyPackage, originalBuffer };
  if (main) {
    const noteParagraphIds = collectNoteParagraphIds(pkg);
    attachHeadlessContext(doc, {
      package: pkg,
      baseline: structuredClone(legacyPackage),
      paragraphIds: collectParagraphIds(main),
      revisionIndex: buildRevisionIndex(pkg),
      noteParagraphIds,
    });
  }
  return doc;
}

export async function parseDocx(
  input: DocxInput,
  _options?: ParseOptions
): Promise<HeadlessDocument> {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const originalBuffer =
    input instanceof ArrayBuffer
      ? input
      : (input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer);
  return packageToLegacyDoc(loaded.package, originalBuffer);
}

export async function repackDocx(doc: HeadlessDocument): Promise<ArrayBuffer> {
  if (!doc.originalBuffer) {
    throw new Error(
      'Cannot repack: no original DOCX buffer was provided. Use parseDocx() or pass originalBuffer to the constructor.'
    );
  }
  const ctx = headlessContextOf(doc);
  if (!ctx) {
    throw new HeadlessRepackRefusal(
      'missing-context',
      'Cannot repack: document was not opened via parseDocx() — no canonical context retained.'
    );
  }
  const result = repackFromCanonicalContext(ctx, doc.package, doc.originalBuffer, doc);
  if (result instanceof HeadlessRepackRefusal) throw result;
  return result;
}

/** @internal Preserve canonical context when cloning legacy documents (DocxReviewer). */
export function cloneDocumentPreservingContext(source: HeadlessDocument): HeadlessDocument {
  const ctx = headlessContextOf(source);
  const { originalBuffer, ...rest } = source;
  const cloned = structuredClone(rest) as HeadlessDocument;
  if (originalBuffer) cloned.originalBuffer = originalBuffer;
  if (ctx) attachHeadlessContext(cloned, cloneHeadlessContext(ctx));
  cloneResolutionLog(source, cloned);
  return cloned;
}

export function createEmptyDocumentBody(paragraphText = ''): DocumentBody {
  return {
    content: [{ type: 'paragraph', content: paragraphText ? [makeRun(paragraphText)] : [] }],
    comments: [],
  };
}

export { HeadlessRepackRefusal } from './headless-errors.ts';
