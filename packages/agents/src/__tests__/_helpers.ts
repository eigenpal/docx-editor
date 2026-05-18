import type {
  Paragraph,
  Run,
  Table,
  Hyperlink,
  DocumentBody,
  Document,
  Insertion,
  Deletion,
  MoveFrom,
  MoveTo,
  Comment,
  ParagraphContent,
} from '@eigenpal/docx-editor-core/headless';
import { DocxReviewer } from '../DocxReviewer';
import type { ContentBlock } from '../types';

export function makeRun(text: string): Run {
  return { type: 'run', content: [{ type: 'text', text }] } as Run;
}

export function makeParagraph(text: string, styleId?: string): Paragraph {
  return {
    type: 'paragraph',
    content: [makeRun(text)] as ParagraphContent[],
    formatting: styleId ? { styleId } : {},
  } as Paragraph;
}

export function makeInsertion(text: string, id: number, author: string): Insertion {
  return {
    type: 'insertion',
    info: { id, author, date: '2024-01-01T00:00:00Z' },
    content: [makeRun(text)],
  };
}

export function makeDeletion(text: string, id: number, author: string): Deletion {
  return {
    type: 'deletion',
    info: { id, author, date: '2024-01-01T00:00:00Z' },
    content: [makeRun(text)],
  };
}

export function makeMoveFrom(text: string, id: number, author: string): MoveFrom {
  return {
    type: 'moveFrom',
    info: { id, author, date: '2024-01-01T00:00:00Z' },
    content: [makeRun(text)],
  };
}

export function makeMoveTo(text: string, id: number, author: string): MoveTo {
  return {
    type: 'moveTo',
    info: { id, author, date: '2024-01-01T00:00:00Z' },
    content: [makeRun(text)],
  };
}

export function makeHyperlink(text: string, href = 'https://example.com'): Hyperlink {
  return { type: 'hyperlink', href, children: [makeRun(text)] } as Hyperlink;
}

export function makeParagraphFrom(content: ParagraphContent[]): Paragraph {
  return { type: 'paragraph', content, formatting: {} } as Paragraph;
}

export function makeTable(cells: string[][]): Table {
  return {
    type: 'table',
    rows: cells.map((row) => ({
      cells: row.map((text) => ({
        content: [makeParagraph(text)],
      })),
    })),
  } as unknown as Table;
}

export function makeDoc(content: (Paragraph | Table)[], comments?: Comment[]): Document {
  return {
    package: {
      document: {
        content,
        comments,
      } as DocumentBody,
    },
  } as Document;
}

export function makeReviewer(content: (Paragraph | Table)[], comments?: Comment[]): DocxReviewer {
  return new DocxReviewer(makeDoc(content, comments));
}

/** Helper to access .text on ContentBlock (narrowing past TableBlock) */
export function textOf(block: ContentBlock): string {
  if ('text' in block) return block.text;
  throw new Error(`Block type ${block.type} has no text`);
}
