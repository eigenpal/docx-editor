import { describe, expect, test } from 'bun:test';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../prosemirror/schema';
import { toFlowBlocks } from './toFlowBlocks';

function createParagraph(children: PMNode[]): PMNode {
  return schema.nodes.paragraph.create(null, children);
}

function getFirstTextRun(doc: PMNode) {
  const blocks = toFlowBlocks(doc);
  const paragraph = blocks.find((block) => block.kind === 'paragraph');
  expect(paragraph).toBeDefined();

  const run =
    paragraph?.kind === 'paragraph' ? paragraph.runs.find((item) => item.kind === 'text') : null;
  expect(run).toBeDefined();
  if (!run || run.kind !== 'text') {
    throw new Error('Expected first text run');
  }
  return run;
}

describe('toFlowBlocks tracked changes', () => {
  test('renders insertion marks with tracked metadata and insertion styling', () => {
    const insertion = schema.marks.insertion.create({
      revisionId: 42,
      author: 'Alice',
      date: '2026-02-19T12:00:00Z',
    });

    const doc = schema.nodes.doc.create(null, [
      createParagraph([schema.text('Inserted', [insertion])]),
    ]);
    const run = getFirstTextRun(doc);

    expect(run.trackedChange?.type).toBe('insertion');
    expect(run.trackedChange?.revisionId).toBe(42);
    expect(run.color).toBe('#2e7d32');
    expect(run.underline).toBeTruthy();
  });

  test('renders deletion marks with tracked metadata and deletion styling', () => {
    const deletion = schema.marks.deletion.create({
      revisionId: 84,
      author: 'Bob',
      date: '2026-02-19T13:00:00Z',
    });

    const doc = schema.nodes.doc.create(null, [
      createParagraph([schema.text('Deleted', [deletion])]),
    ]);
    const run = getFirstTextRun(doc);

    expect(run.trackedChange?.type).toBe('deletion');
    expect(run.trackedChange?.revisionId).toBe(84);
    expect(run.color).toBe('#c62828');
    expect(run.strike).toBe(true);
  });
});
