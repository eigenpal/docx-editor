import { describe, expect, test } from 'bun:test';
import type { Document, Paragraph, Run, Table } from '../../types/document';
import { createRevisionIdAllocator } from './revisionIds';
import { revisionizeDocument } from './revisionizeDocument';

function textRun(text: string, formatting?: Run['formatting']): Run {
  return {
    type: 'run',
    ...(formatting ? { formatting } : {}),
    content: [{ type: 'text', text }],
  };
}

function paragraph(text: string): Paragraph {
  return {
    type: 'paragraph',
    content: [textRun(text)],
  };
}

function singleCellTable(text: string): Table {
  return {
    type: 'table',
    rows: [
      {
        type: 'tableRow',
        cells: [
          {
            type: 'tableCell',
            content: [paragraph(text)],
          },
        ],
      },
    ],
  };
}

function documentFromParagraphs(...paragraphs: Paragraph[]): Document {
  return {
    package: {
      document: {
        content: paragraphs,
      },
    },
  };
}

function paragraphText(paragraph: Paragraph): string {
  return paragraph.content
    .filter((item): item is Run => item.type === 'run')
    .flatMap((run) =>
      run.content
        .filter((content): content is { type: 'text'; text: string } => content.type === 'text')
        .map((content) => content.text)
    )
    .join('');
}

function hasTrackedContent(paragraph: Paragraph): boolean {
  return paragraph.content.some(
    (item) =>
      item.type === 'insertion' ||
      item.type === 'deletion' ||
      item.type === 'moveFrom' ||
      item.type === 'moveTo'
  );
}

describe('revisionizeDocument', () => {
  test('adds insertion wrappers for inserted text in matching paragraphs', () => {
    const previous = documentFromParagraphs(paragraph('Alpha Beta'));
    const current = documentFromParagraphs(paragraph('Alpha Gamma Beta'));
    const allocator = createRevisionIdAllocator(10);

    const result = revisionizeDocument(previous, current, {
      allocator,
      insertionMetadata: { author: 'Reviewer A' },
    });

    const firstParagraph = result.package.document.content[0];
    expect(firstParagraph.type).toBe('paragraph');
    if (firstParagraph.type === 'paragraph') {
      const insertions = firstParagraph.content.filter((item) => item.type === 'insertion');
      expect(insertions).toHaveLength(1);
      expect(insertions[0].info.id).toBe(10);
      expect(insertions[0].info.author).toBe('Reviewer A');
    }
  });

  test('adds deletion wrappers when paragraph content is removed', () => {
    const previous = documentFromParagraphs(paragraph('Keep'), paragraph('Remove me'));
    const current = documentFromParagraphs(paragraph('Keep'));
    const allocator = createRevisionIdAllocator(20);

    const result = revisionizeDocument(previous, current, { allocator });

    expect(result.package.document.content).toHaveLength(2);
    const secondParagraph = result.package.document.content[1];
    expect(secondParagraph.type).toBe('paragraph');
    if (secondParagraph.type === 'paragraph') {
      const deletions = secondParagraph.content.filter((item) => item.type === 'deletion');
      expect(deletions).toHaveLength(1);
      expect(deletions[0].info.id).toBe(20);
    }
  });

  test('adds insertion wrappers for newly added paragraphs', () => {
    const previous = documentFromParagraphs(paragraph('Keep'));
    const current = documentFromParagraphs(paragraph('Keep'), paragraph('Added line'));
    const allocator = createRevisionIdAllocator(30);

    const result = revisionizeDocument(previous, current, { allocator });

    expect(result.package.document.content).toHaveLength(2);
    const secondParagraph = result.package.document.content[1];
    expect(secondParagraph.type).toBe('paragraph');
    if (secondParagraph.type === 'paragraph') {
      const insertions = secondParagraph.content.filter((item) => item.type === 'insertion');
      expect(insertions).toHaveLength(1);
      expect(insertions[0].info.id).toBe(30);
    }
  });

  test('realigns after paragraph split so unchanged trailing paragraphs stay unchanged', () => {
    const previous = documentFromParagraphs(
      paragraph('Alpha Beta'),
      paragraph('Keep one'),
      paragraph('Keep two')
    );
    const current = documentFromParagraphs(
      paragraph('Alpha'),
      paragraph('Beta'),
      paragraph('Keep one'),
      paragraph('Keep two')
    );
    const allocator = createRevisionIdAllocator(40);

    const result = revisionizeDocument(previous, current, { allocator });

    expect(result.package.document.content).toHaveLength(4);

    const thirdParagraph = result.package.document.content[2];
    const fourthParagraph = result.package.document.content[3];
    expect(thirdParagraph.type).toBe('paragraph');
    expect(fourthParagraph.type).toBe('paragraph');
    if (thirdParagraph.type !== 'paragraph' || fourthParagraph.type !== 'paragraph') return;

    expect(paragraphText(thirdParagraph)).toBe('Keep one');
    expect(paragraphText(fourthParagraph)).toBe('Keep two');
    expect(hasTrackedContent(thirdParagraph)).toBe(false);
    expect(hasTrackedContent(fourthParagraph)).toBe(false);
  });

  test('detects moved paragraphs and emits moveFrom/moveTo with range markers', () => {
    const previous = documentFromParagraphs(
      paragraph('First'),
      paragraph('Second'),
      paragraph('Third')
    );
    const current = documentFromParagraphs(
      paragraph('Second'),
      paragraph('Third'),
      paragraph('First')
    );
    const allocator = createRevisionIdAllocator(100);

    const result = revisionizeDocument(previous, current, {
      allocator,
      insertionMetadata: { author: 'Mover' },
      deletionMetadata: { author: 'Mover' },
    });

    const blocks = result.package.document.content;

    const hasMoveFrom = blocks.some(
      (block) =>
        block.type === 'paragraph' && block.content.some((item) => item.type === 'moveFrom')
    );
    const hasMoveTo = blocks.some(
      (block) => block.type === 'paragraph' && block.content.some((item) => item.type === 'moveTo')
    );
    const hasMoveFromRange = blocks.some(
      (block) =>
        block.type === 'paragraph' &&
        block.content.some((item) => item.type === 'moveFromRangeStart')
    );
    const hasMoveToRange = blocks.some(
      (block) =>
        block.type === 'paragraph' && block.content.some((item) => item.type === 'moveToRangeStart')
    );

    expect(hasMoveFrom).toBe(true);
    expect(hasMoveTo).toBe(true);
    expect(hasMoveFromRange).toBe(true);
    expect(hasMoveToRange).toBe(true);
  });

  test('move range IDs match between moveFrom and moveTo paragraphs', () => {
    const previous = documentFromParagraphs(paragraph('Alpha'), paragraph('Beta'));
    const current = documentFromParagraphs(paragraph('Beta'), paragraph('Alpha'));
    const allocator = createRevisionIdAllocator(200);

    const result = revisionizeDocument(previous, current, { allocator });
    const blocks = result.package.document.content;

    const moveFromRangeIds = new Set<number>();
    const moveToRangeIds = new Set<number>();

    for (const block of blocks) {
      if (block.type !== 'paragraph') continue;
      for (const item of block.content) {
        if (item.type === 'moveFromRangeStart') moveFromRangeIds.add(item.id);
        if (item.type === 'moveToRangeStart') moveToRangeIds.add(item.id);
      }
    }

    expect(moveFromRangeIds.size).toBeGreaterThan(0);
    for (const id of moveFromRangeIds) {
      expect(moveToRangeIds.has(id)).toBe(true);
    }
  });

  test('non-moved deletions and insertions remain as del/ins not move', () => {
    const previous = documentFromParagraphs(paragraph('Keep'), paragraph('Old unique'));
    const current = documentFromParagraphs(paragraph('Keep'), paragraph('New unique'));
    const allocator = createRevisionIdAllocator(300);

    const result = revisionizeDocument(previous, current, { allocator });
    const blocks = result.package.document.content;

    const hasMoveFrom = blocks.some(
      (block) =>
        block.type === 'paragraph' && block.content.some((item) => item.type === 'moveFrom')
    );
    const hasMoveTo = blocks.some(
      (block) => block.type === 'paragraph' && block.content.some((item) => item.type === 'moveTo')
    );

    expect(hasMoveFrom).toBe(false);
    expect(hasMoveTo).toBe(false);
  });

  test('adds insertion wrappers for inserted text inside table cells', () => {
    const previous: Document = {
      package: {
        document: {
          content: [singleCellTable('Alpha Beta')],
        },
      },
    };
    const current: Document = {
      package: {
        document: {
          content: [singleCellTable('Alpha Gamma Beta')],
        },
      },
    };
    const allocator = createRevisionIdAllocator(50);

    const result = revisionizeDocument(previous, current, {
      allocator,
      insertionMetadata: { author: 'Table Reviewer' },
    });

    const firstBlock = result.package.document.content[0];
    expect(firstBlock?.type).toBe('table');
    if (!firstBlock || firstBlock.type !== 'table') return;

    const firstCellParagraph = firstBlock.rows[0]?.cells[0]?.content[0];
    expect(firstCellParagraph?.type).toBe('paragraph');
    if (!firstCellParagraph || firstCellParagraph.type !== 'paragraph') return;

    const insertions = firstCellParagraph.content.filter((item) => item.type === 'insertion');
    expect(insertions).toHaveLength(1);
    expect(insertions[0].info.id).toBe(50);
    expect(insertions[0].info.author).toBe('Table Reviewer');
  });
});
