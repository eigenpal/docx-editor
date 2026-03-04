import { describe, expect, test } from 'bun:test';
import type { Paragraph } from '../../types/document';
import { serializeParagraph } from './paragraphSerializer';

describe('serializeParagraph tracked-change hardening', () => {
  test('serializes deletion runs using delText and delInstrText', () => {
    const paragraph: Paragraph = {
      type: 'paragraph',
      content: [
        {
          type: 'deletion',
          info: { id: 11, author: 'Reviewer', date: '2026-02-22T10:00:00Z' },
          content: [
            {
              type: 'run',
              content: [
                { type: 'text', text: 'Removed' },
                { type: 'instrText', text: ' MERGEFIELD name ' },
              ],
            },
          ],
        },
      ],
    };

    const xml = serializeParagraph(paragraph);

    expect(xml).toContain('<w:del w:id="11" w:author="Reviewer" w:date="2026-02-22T10:00:00Z">');
    expect(xml).toContain('<w:delText>Removed</w:delText>');
    expect(xml).toContain(
      '<w:delInstrText xml:space="preserve"> MERGEFIELD name </w:delInstrText>'
    );
    expect(xml).not.toContain('<w:t>Removed</w:t>');
    expect(xml).not.toContain('<w:instrText xml:space="preserve"> MERGEFIELD name </w:instrText>');
  });

  test('normalizes invalid tracked-change metadata while serializing', () => {
    const paragraph: Paragraph = {
      type: 'paragraph',
      content: [
        {
          type: 'insertion',
          info: { id: -5, author: '   ', date: '   ' },
          content: [
            {
              type: 'run',
              content: [{ type: 'text', text: 'Added' }],
            },
          ],
        },
      ],
    };

    const xml = serializeParagraph(paragraph);

    expect(xml).toContain('<w:ins w:id="0" w:author="Unknown">');
    expect(xml).not.toContain('w:date=');
  });
});
