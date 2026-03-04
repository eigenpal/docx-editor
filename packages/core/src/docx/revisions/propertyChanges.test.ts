import { describe, expect, test } from 'bun:test';
import type { Paragraph, Run } from '../../types/document';
import { parseParagraph } from '../paragraphParser';
import { serializeParagraph } from '../serializer/paragraphSerializer';
import { parseXmlDocument, type XmlElement } from '../xmlParser';
import {
  detectParagraphPropertyChanges,
  detectRunPropertyChanges,
  withDetectedParagraphPropertyChanges,
  withDetectedRunPropertyChanges,
} from './propertyChanges';
import { createRevisionIdAllocator } from './revisionIds';

function textRun(text: string, formatting?: Run['formatting']): Run {
  return {
    type: 'run',
    ...(formatting ? { formatting } : {}),
    content: [{ type: 'text', text }],
  };
}

describe('propertyChanges revision helpers', () => {
  test('detectRunPropertyChanges produces a revision entry when run formatting changes', () => {
    const allocator = createRevisionIdAllocator(10);
    const previous = textRun('Hello', { bold: false });
    const current = textRun('Hello', { bold: true });

    const changes = detectRunPropertyChanges(previous, current, {
      allocator,
      metadata: { author: 'Reviewer', date: '2026-02-22T10:00:00Z' },
      rsid: '00ABCDEF',
    });

    expect(changes).toHaveLength(1);
    expect(changes?.[0]).toEqual({
      type: 'runPropertyChange',
      info: {
        id: 10,
        author: 'Reviewer',
        date: '2026-02-22T10:00:00.000Z',
        rsid: '00ABCDEF',
      },
      previousFormatting: { bold: false },
      currentFormatting: { bold: true },
    });
  });

  test('detectParagraphPropertyChanges returns undefined for identical formatting', () => {
    const previous: Paragraph = {
      type: 'paragraph',
      formatting: { alignment: 'left' },
      content: [],
    };
    const current: Paragraph = {
      type: 'paragraph',
      formatting: { alignment: 'left' },
      content: [],
    };

    const changes = detectParagraphPropertyChanges(previous, current);
    expect(changes).toBeUndefined();
  });

  test('withDetected* helpers attach property changes to current nodes', () => {
    const allocator = createRevisionIdAllocator(20);
    const previousRun = textRun('x', { italic: false });
    const currentRun = textRun('x', { italic: true });
    const previousParagraph: Paragraph = {
      type: 'paragraph',
      formatting: { alignment: 'left' },
      content: [],
    };
    const currentParagraph: Paragraph = {
      type: 'paragraph',
      formatting: { alignment: 'center' },
      content: [],
    };

    const runWithChanges = withDetectedRunPropertyChanges(previousRun, currentRun, {
      allocator,
      metadata: { author: 'Reviewer', date: '2026-02-22T11:00:00Z' },
    });
    const paragraphWithChanges = withDetectedParagraphPropertyChanges(
      previousParagraph,
      currentParagraph,
      {
        allocator,
        metadata: { author: 'Reviewer', date: '2026-02-22T11:00:00Z' },
      }
    );

    expect(runWithChanges.propertyChanges).toHaveLength(1);
    expect(paragraphWithChanges.propertyChanges).toHaveLength(1);
    expect(runWithChanges.propertyChanges?.[0].info.id).toBe(20);
    expect(paragraphWithChanges.propertyChanges?.[0].info.id).toBe(21);
  });
});

describe('propertyChanges parser/serializer round trip', () => {
  test('round-trips paragraph and run property changes through OOXML', () => {
    const paragraph: Paragraph = {
      type: 'paragraph',
      formatting: { alignment: 'center' },
      propertyChanges: [
        {
          type: 'paragraphPropertyChange',
          info: {
            id: 31,
            author: 'Reviewer',
            date: '2026-02-22T12:00:00Z',
            rsid: '00112233',
          },
          previousFormatting: { alignment: 'left' },
          currentFormatting: { alignment: 'center' },
        },
      ],
      content: [
        {
          type: 'run',
          formatting: { bold: true },
          propertyChanges: [
            {
              type: 'runPropertyChange',
              info: {
                id: 32,
                author: 'Reviewer',
                date: '2026-02-22T12:05:00Z',
                rsid: '00445566',
              },
              previousFormatting: { bold: false },
              currentFormatting: { bold: true },
            },
          ],
          content: [{ type: 'text', text: 'Tracked' }],
        },
      ],
    };

    const xml = serializeParagraph(paragraph);
    expect(xml).toContain('<w:pPrChange w:id="31" w:author="Reviewer"');
    expect(xml).toContain('w:rsid="00112233"');
    expect(xml).toContain('<w:rPrChange w:id="32" w:author="Reviewer"');
    expect(xml).toContain('w:rsid="00445566"');

    const root = parseXmlDocument(
      `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${xml.replace(/^<w:p[^>]*>|<\/w:p>$/g, '')}</w:p>`
    ) as XmlElement | null;
    expect(root).not.toBeNull();
    if (!root) return;

    const parsed = parseParagraph(root, null, null, null, null, null);
    expect(parsed.propertyChanges).toHaveLength(1);
    const paragraphChange = parsed.propertyChanges?.[0];
    expect(paragraphChange?.type).toBe('paragraphPropertyChange');
    expect(paragraphChange?.info.id).toBe(31);
    expect(paragraphChange?.info.author).toBe('Reviewer');
    expect(paragraphChange?.info.rsid).toBe('00112233');
    expect(paragraphChange?.previousFormatting?.alignment).toBe('left');
    expect(paragraphChange?.currentFormatting?.alignment).toBe('center');

    const firstContent = parsed.content[0];
    expect(firstContent?.type).toBe('run');
    if (!firstContent || firstContent.type !== 'run') return;

    expect(firstContent.propertyChanges).toHaveLength(1);
    const runChange = firstContent.propertyChanges?.[0];
    expect(runChange?.type).toBe('runPropertyChange');
    expect(runChange?.info.id).toBe(32);
    expect(runChange?.info.author).toBe('Reviewer');
    expect(runChange?.info.rsid).toBe('00445566');
    expect(runChange?.previousFormatting?.bold).toBe(false);
    expect(runChange?.currentFormatting?.bold).toBe(true);
  });
});
