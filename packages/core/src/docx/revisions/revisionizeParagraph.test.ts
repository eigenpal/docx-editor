import { describe, expect, test } from 'bun:test';
import type { Run } from '../../types/document';
import { createRevisionIdAllocator } from './revisionIds';
import { revisionizeParagraphRuns } from './revisionizeParagraph';

function textRun(text: string, formatting?: Run['formatting']): Run {
  return {
    type: 'run',
    ...(formatting ? { formatting } : {}),
    content: [{ type: 'text', text }],
  };
}

describe('revisionizeParagraphRuns', () => {
  test('returns plain runs when there are no text changes', () => {
    const previous = [textRun('Hello world')];
    const current = [textRun('Hello world')];

    const result = revisionizeParagraphRuns(previous, current);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('run');
    if (result[0].type === 'run') {
      expect(result[0].content[0].type).toBe('text');
      if (result[0].content[0].type === 'text') {
        expect(result[0].content[0].text).toBe('Hello world');
      }
    }
  });

  test('wraps inserted text in insertion tracked changes', () => {
    const allocator = createRevisionIdAllocator(5);
    const previous = [textRun('Alpha Beta')];
    const current = [textRun('Alpha Gamma Beta')];

    const result = revisionizeParagraphRuns(previous, current, {
      allocator,
      insertionMetadata: { author: 'Reviewer A', date: '2026-02-22T12:00:00Z' },
    });

    const insertions = result.filter((item) => item.type === 'insertion');
    expect(insertions).toHaveLength(1);
    expect(insertions[0].info.id).toBe(5);
    expect(insertions[0].info.author).toBe('Reviewer A');
    const insertedText = insertions[0].content
      .flatMap((run) => (run.type === 'run' ? run.content : []))
      .filter((content) => content.type === 'text')
      .map((content) => content.text)
      .join('');
    expect(insertedText.length).toBeGreaterThan(0);
  });

  test('wraps deleted text in deletion tracked changes', () => {
    const allocator = createRevisionIdAllocator(20);
    const previous = [textRun('Alpha Gamma Beta')];
    const current = [textRun('Alpha Beta')];

    const result = revisionizeParagraphRuns(previous, current, {
      allocator,
      deletionMetadata: { author: 'Reviewer B', date: '2026-02-22T12:30:00Z' },
    });

    const deletions = result.filter((item) => item.type === 'deletion');
    expect(deletions).toHaveLength(1);
    expect(deletions[0].info.id).toBe(20);
    expect(deletions[0].info.author).toBe('Reviewer B');
  });

  test('uses one tracked wrapper for adjacent insert chunks with different formatting', () => {
    const allocator = createRevisionIdAllocator(100);
    const previous = [textRun('A C')];
    const current = [textRun('A '), textRun('B', { bold: true }), textRun(' C')];

    const result = revisionizeParagraphRuns(previous, current, { allocator });
    const insertions = result.filter((item) => item.type === 'insertion');

    expect(insertions).toHaveLength(1);
    expect(insertions[0].info.id).toBe(100);
    expect(insertions[0].content.length).toBeGreaterThan(1);
  });
});
