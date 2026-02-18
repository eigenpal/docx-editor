import { describe, test, expect } from 'bun:test';
import type { Document, Paragraph } from '../types/document';
import { parseXmlDocument } from './xmlParser';
import { parseParagraph } from './paragraphParser';
import { serializeParagraph } from './serializer/paragraphSerializer';
import { toProseDoc, fromProseDoc } from '../prosemirror/conversion';

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('tracked changes parsing and serialization', () => {
  test('parses deleted text from w:delText', () => {
    const xml = `<w:p xmlns:w="${NS}">
      <w:del w:id="7" w:author="Alice" w:date="2026-01-01T00:00:00Z">
        <w:r><w:delText>Deleted clause</w:delText></w:r>
      </w:del>
    </w:p>`;

    const p = parseXmlDocument(xml);
    expect(p).toBeTruthy();
    const paragraph = parseParagraph(p!, null, null, null, null, null);

    expect(paragraph.content).toHaveLength(1);
    const del = paragraph.content[0];
    expect(del.type).toBe('deletion');
    if (del.type !== 'deletion') return;

    expect(del.info.id).toBe(7);
    expect(del.info.author).toBe('Alice');
    expect(del.content).toHaveLength(1);
    expect(del.content[0].type).toBe('run');
    if (del.content[0].type !== 'run') return;
    expect(del.content[0].content[0]).toEqual({ type: 'text', text: 'Deleted clause' });
  });

  test('parses moveTo with move range metadata', () => {
    const xml = `<w:p xmlns:w="${NS}">
      <w:moveToRangeStart w:id="59" w:author="Alice" w:date="2026-01-02T00:00:00Z" w:name="move6"/>
      <w:moveTo w:id="60" w:author="Alice" w:date="2026-01-02T00:00:00Z">
        <w:r><w:t>moved text</w:t></w:r>
      </w:moveTo>
      <w:moveToRangeEnd w:id="59"/>
    </w:p>`;

    const p = parseXmlDocument(xml);
    expect(p).toBeTruthy();
    const paragraph = parseParagraph(p!, null, null, null, null, null);

    expect(paragraph.content).toHaveLength(1);
    const moveTo = paragraph.content[0];
    expect(moveTo.type).toBe('moveTo');
    if (moveTo.type !== 'moveTo') return;

    expect(moveTo.info.id).toBe(60);
    expect(moveTo.range?.id).toBe(59);
    expect(moveTo.range?.name).toBe('move6');
    expect(moveTo.range?.author).toBe('Alice');
    expect(moveTo.range?.date).toBe('2026-01-02T00:00:00Z');
  });

  test('serializes deletion text using w:delText', () => {
    const paragraph: Paragraph = {
      type: 'paragraph',
      content: [
        {
          type: 'deletion',
          info: { id: 7, author: 'Alice', date: '2026-01-01T00:00:00Z' },
          content: [{ type: 'run', content: [{ type: 'text', text: 'Deleted clause' }] }],
        },
      ],
    };

    const xml = serializeParagraph(paragraph);
    expect(xml).toContain('<w:del ');
    expect(xml).toContain('<w:delText>Deleted clause</w:delText>');
    expect(xml).not.toContain('<w:t>Deleted clause</w:t>');
  });

  test('serializes moveFrom with range markers', () => {
    const paragraph: Paragraph = {
      type: 'paragraph',
      content: [
        {
          type: 'moveFrom',
          info: { id: 182, author: 'Alice', date: '2026-01-02T00:00:00Z' },
          range: { id: 181, name: 'move6', author: 'Alice', date: '2026-01-02T00:00:00Z' },
          content: [{ type: 'run', content: [{ type: 'text', text: 'moved text' }] }],
        },
      ],
    };

    const xml = serializeParagraph(paragraph);
    expect(xml).toContain('<w:moveFromRangeStart w:id="181"');
    expect(xml).toContain('<w:moveFrom ');
    expect(xml).toContain('<w:t>moved text</w:t>');
    expect(xml).toContain('<w:moveFromRangeEnd w:id="181"/>');
  });

  test('serializes one move range pair for adjacent wrappers with same range id', () => {
    const paragraph: Paragraph = {
      type: 'paragraph',
      content: [
        {
          type: 'moveTo',
          info: { id: 60, author: 'Alice', date: '2026-01-02T00:00:00Z' },
          range: { id: 59, name: 'move6', author: 'Alice', date: '2026-01-02T00:00:00Z' },
          content: [{ type: 'run', content: [{ type: 'text', text: 'part one' }] }],
        },
        {
          type: 'moveTo',
          info: { id: 61, author: 'Alice', date: '2026-01-02T00:00:00Z' },
          range: { id: 59, name: 'move6', author: 'Alice', date: '2026-01-02T00:00:00Z' },
          content: [{ type: 'run', content: [{ type: 'text', text: 'part two' }] }],
        },
      ],
    };

    const xml = serializeParagraph(paragraph);
    const startCount = (xml.match(/<w:moveToRangeStart\b/g) || []).length;
    const endCount = (xml.match(/<w:moveToRangeEnd\b/g) || []).length;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });
});

describe('tracked changes ProseMirror round-trip', () => {
  test('round-trips move revisions through toProseDoc/fromProseDoc', () => {
    const base: Document = {
      package: {
        document: {
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'moveTo',
                  info: { id: 300, author: 'Alice', date: '2026-01-03T00:00:00Z' },
                  range: {
                    id: 299,
                    name: 'move9',
                    author: 'Alice',
                    date: '2026-01-03T00:00:00Z',
                  },
                  content: [{ type: 'run', content: [{ type: 'text', text: 'Moved once' }] }],
                },
              ],
            },
          ],
        },
      },
    };

    const pm = toProseDoc(base);
    const roundTripped = fromProseDoc(pm, base);
    const paragraph = roundTripped.package.document.content[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type !== 'paragraph') return;

    const move = paragraph.content[0];
    expect(move.type).toBe('moveTo');
    if (move.type !== 'moveTo') return;

    expect(move.info.id).toBe(300);
    expect(move.range?.id).toBe(299);
    expect(move.range?.name).toBe('move9');
    expect(move.content[0].type).toBe('run');
    if (move.content[0].type !== 'run') return;
    expect(move.content[0].content[0]).toEqual({ type: 'text', text: 'Moved once' });
  });
});
