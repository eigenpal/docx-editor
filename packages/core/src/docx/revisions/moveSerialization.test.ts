import { describe, expect, test } from 'bun:test';
import type { Document, Paragraph, Run } from '../../types/document';
import { parseParagraph } from '../paragraphParser';
import { serializeParagraph } from '../serializer/paragraphSerializer';
import { parseXmlDocument, type XmlElement } from '../xmlParser';
import { fromProseDoc } from '../../prosemirror/conversion/fromProseDoc';
import { toProseDoc } from '../../prosemirror/conversion/toProseDoc';

function textRun(text: string): Run {
  return {
    type: 'run',
    content: [{ type: 'text', text }],
  };
}

describe('move serialization and parsing', () => {
  test('serializeParagraph emits moveFrom/moveTo wrappers with moveFrom delText payload', () => {
    const paragraph: Paragraph = {
      type: 'paragraph',
      content: [
        {
          type: 'moveFrom',
          info: { id: 7, author: 'Reviewer' },
          content: [textRun('Old text')],
        },
        {
          type: 'moveTo',
          info: { id: 7, author: 'Reviewer' },
          content: [textRun('New text')],
        },
      ],
    };

    const xml = serializeParagraph(paragraph);

    expect(xml).toContain('<w:moveFrom w:id="7" w:author="Reviewer">');
    expect(xml).toContain('<w:moveTo w:id="7" w:author="Reviewer">');
    expect(xml).toContain('<w:delText>Old text</w:delText>');
    expect(xml).toContain('<w:t>New text</w:t>');
  });

  test('parseParagraph reads moveFrom/moveTo wrappers back into paragraph content', () => {
    const paragraphXml = `
      <w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:moveFrom w:id="9" w:author="Reviewer A">
          <w:r><w:delText>Moved away</w:delText></w:r>
        </w:moveFrom>
        <w:moveTo w:id="9" w:author="Reviewer A">
          <w:r><w:t>Moved here</w:t></w:r>
        </w:moveTo>
      </w:p>
    `;
    const root = parseXmlDocument(paragraphXml) as XmlElement | null;
    expect(root).not.toBeNull();
    if (!root) return;

    const paragraph = parseParagraph(root, null, null, null, null, null);

    expect(paragraph.content[0].type).toBe('moveFrom');
    expect(paragraph.content[1].type).toBe('moveTo');

    const moveFrom = paragraph.content[0];
    const moveTo = paragraph.content[1];
    if (moveFrom.type !== 'moveFrom' || moveTo.type !== 'moveTo') return;

    expect(moveFrom.info.id).toBe(9);
    expect(moveTo.info.id).toBe(9);
    expect(moveFrom.content[0].type).toBe('run');
    expect(moveTo.content[0].type).toBe('run');
    if (moveFrom.content[0].type !== 'run' || moveTo.content[0].type !== 'run') return;

    expect(moveFrom.content[0].content[0].type).toBe('text');
    expect(moveTo.content[0].content[0].type).toBe('text');
    if (moveFrom.content[0].content[0].type !== 'text') return;
    if (moveTo.content[0].content[0].type !== 'text') return;
    expect(moveFrom.content[0].content[0].text).toBe('Moved away');
    expect(moveTo.content[0].content[0].text).toBe('Moved here');
  });

  test('serializeParagraph emits moveFromRangeStart/End and moveToRangeStart/End markers', () => {
    const paragraph: Paragraph = {
      type: 'paragraph',
      content: [
        {
          type: 'moveFromRangeStart',
          id: 42,
          name: 'move42',
        },
        {
          type: 'moveFrom',
          info: { id: 43, author: 'Reviewer' },
          content: [textRun('Moved away')],
        },
        {
          type: 'moveFromRangeEnd',
          id: 42,
        },
      ],
    };

    const xml = serializeParagraph(paragraph);

    expect(xml).toContain('<w:moveFromRangeStart w:id="42" w:name="move42"/>');
    expect(xml).toContain('<w:moveFromRangeEnd w:id="42"/>');
    expect(xml).toContain('<w:moveFrom w:id="43" w:author="Reviewer">');
    expect(xml).toContain('<w:delText>Moved away</w:delText>');
  });

  test('parseParagraph reads moveFromRangeStart/End markers', () => {
    const paragraphXml = `
      <w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:moveFromRangeStart w:id="50" w:name="move50"/>
        <w:moveFrom w:id="51" w:author="Reviewer">
          <w:r><w:delText>Source text</w:delText></w:r>
        </w:moveFrom>
        <w:moveFromRangeEnd w:id="50"/>
      </w:p>
    `;
    const root = parseXmlDocument(paragraphXml) as XmlElement | null;
    expect(root).not.toBeNull();
    if (!root) return;

    const paragraph = parseParagraph(root, null, null, null, null, null);

    const rangeStart = paragraph.content.find((c) => c.type === 'moveFromRangeStart');
    const rangeEnd = paragraph.content.find((c) => c.type === 'moveFromRangeEnd');
    const moveFrom = paragraph.content.find((c) => c.type === 'moveFrom');

    expect(rangeStart).toBeDefined();
    expect(rangeEnd).toBeDefined();
    expect(moveFrom).toBeDefined();

    if (rangeStart?.type !== 'moveFromRangeStart') return;
    expect(rangeStart.id).toBe(50);
    expect(rangeStart.name).toBe('move50');

    if (rangeEnd?.type !== 'moveFromRangeEnd') return;
    expect(rangeEnd.id).toBe(50);
  });

  test('parseParagraph reads moveToRangeStart/End markers', () => {
    const paragraphXml = `
      <w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:moveToRangeStart w:id="60" w:name="move60"/>
        <w:moveTo w:id="61" w:author="Reviewer">
          <w:r><w:t>Destination text</w:t></w:r>
        </w:moveTo>
        <w:moveToRangeEnd w:id="60"/>
      </w:p>
    `;
    const root = parseXmlDocument(paragraphXml) as XmlElement | null;
    expect(root).not.toBeNull();
    if (!root) return;

    const paragraph = parseParagraph(root, null, null, null, null, null);

    const rangeStart = paragraph.content.find((c) => c.type === 'moveToRangeStart');
    const rangeEnd = paragraph.content.find((c) => c.type === 'moveToRangeEnd');
    const moveTo = paragraph.content.find((c) => c.type === 'moveTo');

    expect(rangeStart).toBeDefined();
    expect(rangeEnd).toBeDefined();
    expect(moveTo).toBeDefined();

    if (rangeStart?.type !== 'moveToRangeStart') return;
    expect(rangeStart.id).toBe(60);
    expect(rangeStart.name).toBe('move60');

    if (rangeEnd?.type !== 'moveToRangeEnd') return;
    expect(rangeEnd.id).toBe(60);
  });

  test('ProseMirror conversion preserves move wrappers when paired revision ids are present', () => {
    const document: Document = {
      package: {
        document: {
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'moveFrom',
                  info: { id: 15, author: 'Reviewer B' },
                  content: [textRun('Source')],
                },
                {
                  type: 'moveTo',
                  info: { id: 15, author: 'Reviewer B' },
                  content: [textRun('Destination')],
                },
              ],
            },
          ],
        },
      },
    };

    const pmDoc = toProseDoc(document);
    const roundTripped = fromProseDoc(pmDoc, document);
    const paragraph = roundTripped.package.document.content[0];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type !== 'paragraph') return;

    const hasMoveFrom = paragraph.content.some((item) => item.type === 'moveFrom');
    const hasMoveTo = paragraph.content.some((item) => item.type === 'moveTo');
    expect(hasMoveFrom).toBe(true);
    expect(hasMoveTo).toBe(true);
  });
});
