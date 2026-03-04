import { describe, expect, test } from 'bun:test';
import type { Document } from '../../types/document';
import {
  createAllocatorAfterDocument,
  createRevisionIdAllocator,
  inferMaxRevisionId,
  normalizeStartRevisionId,
} from './revisionIds';

describe('revisionIds', () => {
  test('normalizeStartRevisionId clamps invalid values to 1', () => {
    expect(normalizeStartRevisionId(Number.NaN)).toBe(1);
    expect(normalizeStartRevisionId(-5)).toBe(1);
    expect(normalizeStartRevisionId(0)).toBe(1);
    expect(normalizeStartRevisionId(3.9)).toBe(3);
  });

  test('allocator increments sequentially', () => {
    const allocator = createRevisionIdAllocator(7);
    expect(allocator.peek()).toBe(7);
    expect(allocator.next()).toBe(7);
    expect(allocator.next()).toBe(8);
    expect(allocator.peek()).toBe(9);
  });

  test('allocator reserves contiguous ranges', () => {
    const allocator = createRevisionIdAllocator(10);
    expect(allocator.reserve(3)).toEqual([10, 11, 12]);
    expect(allocator.next()).toBe(13);
  });

  test('inferMaxRevisionId returns 0 when document has no tracked revisions', () => {
    const document: Document = {
      package: {
        document: {
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'run', content: [{ type: 'text', text: 'x' }] }],
            },
          ],
        },
      },
    };

    expect(inferMaxRevisionId(document)).toBe(0);
  });

  test('inferMaxRevisionId scans insertion/deletion/move/property and structural changes', () => {
    const document: Document = {
      package: {
        document: {
          content: [
            {
              type: 'paragraph',
              propertyChanges: [
                {
                  type: 'paragraphPropertyChange',
                  info: { id: 4, author: 'A' },
                },
              ],
              content: [
                {
                  type: 'insertion',
                  info: { id: 7, author: 'A' },
                  content: [
                    {
                      type: 'run',
                      propertyChanges: [
                        {
                          type: 'runPropertyChange',
                          info: { id: 11, author: 'B' },
                        },
                      ],
                      content: [{ type: 'text', text: 'ins' }],
                    },
                  ],
                },
                {
                  type: 'moveTo',
                  info: { id: 15, author: 'C' },
                  content: [{ type: 'run', content: [{ type: 'text', text: 'moved' }] }],
                },
              ],
            },
            {
              type: 'table',
              propertyChanges: [
                {
                  type: 'tablePropertyChange',
                  info: { id: 16, author: 'D' },
                },
              ],
              rows: [
                {
                  type: 'tableRow',
                  structuralChange: {
                    type: 'tableRowInsertion',
                    info: { id: 19, author: 'E' },
                  },
                  cells: [
                    {
                      type: 'tableCell',
                      structuralChange: {
                        type: 'tableCellMerge',
                        info: { id: 23, author: 'F' },
                      },
                      content: [{ type: 'paragraph', content: [] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    };

    expect(inferMaxRevisionId(document)).toBe(23);
  });

  test('createAllocatorAfterDocument starts after max discovered id', () => {
    const document: Document = {
      package: {
        document: {
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'deletion',
                  info: { id: 42, author: 'A' },
                  content: [{ type: 'run', content: [{ type: 'text', text: 'x' }] }],
                },
              ],
            },
          ],
        },
      },
    };

    const allocator = createAllocatorAfterDocument(document);
    expect(allocator.next()).toBe(43);
  });
});
