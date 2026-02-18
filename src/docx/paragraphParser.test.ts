import { describe, test, expect } from 'bun:test';
import type { NumberingMap } from './numberingParser';
import type { ListLevel, NumberingDefinitions, Style } from '../types/document';
import { parseXmlDocument, type XmlElement } from './xmlParser';
import { parseParagraph } from './paragraphParser';
import { serializeParagraph } from './serializer/paragraphSerializer';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function parseParagraphElement(xml: string): XmlElement {
  const root = parseXmlDocument(xml);
  if (!root) {
    throw new Error('Failed to parse XML');
  }
  return root;
}

function createNumberingMap(
  levelsByNumId: Record<number, Record<number, ListLevel>>
): NumberingMap {
  const definitions: NumberingDefinitions = { abstractNums: [], nums: [] };

  return {
    definitions,
    getLevel(numId: number, ilvl: number): ListLevel | null {
      return levelsByNumId[numId]?.[ilvl] ?? null;
    },
    getAbstract(): null {
      return null;
    },
    hasNumbering(numId: number): boolean {
      return levelsByNumId[numId] !== undefined;
    },
  };
}

describe('parseParagraph numbering defaults', () => {
  test('does not inline numbering-level hanging indent into paragraph formatting', () => {
    const p = parseParagraphElement(`
      <w:p xmlns:w="${W_NS}">
        <w:pPr>
          <w:numPr>
            <w:ilvl w:val="0"/>
            <w:numId w:val="10"/>
          </w:numPr>
          <w:ind w:left="3240"/>
        </w:pPr>
        <w:r><w:t>List item</w:t></w:r>
      </w:p>
    `);

    const numbering = createNumberingMap({
      10: {
        0: {
          ilvl: 0,
          numFmt: 'decimal',
          lvlText: '%1.',
          pPr: {
            indentLeft: 3240,
            indentFirstLine: -720,
            hangingIndent: true,
          },
        },
      },
    });

    const paragraph = parseParagraph(p, null, null, numbering, null, null);

    expect(paragraph.formatting?.indentLeft).toBe(3240);
    expect(paragraph.formatting?.indentFirstLine).toBeUndefined();
    expect(paragraph.formatting?.hangingIndent).toBeUndefined();
    expect(paragraph.listRendering?.numId).toBe(10);
  });

  test('uses style numPr for list rendering without storing it as inline pPr', () => {
    const p = parseParagraphElement(`
      <w:p xmlns:w="${W_NS}">
        <w:pPr>
          <w:pStyle w:val="ListStyle"/>
        </w:pPr>
        <w:r><w:t>Styled list item</w:t></w:r>
      </w:p>
    `);

    const listStyle: Style = {
      styleId: 'ListStyle',
      type: 'paragraph',
      pPr: {
        numPr: {
          numId: 42,
          ilvl: 1,
        },
      },
    };
    const styles = new Map<string, Style>([['ListStyle', listStyle]]);
    const numbering = createNumberingMap({
      42: {
        1: {
          ilvl: 1,
          numFmt: 'decimal',
          lvlText: '%2.',
        },
      },
    });

    const paragraph = parseParagraph(p, styles, null, numbering, null, null);

    expect(paragraph.listRendering?.numId).toBe(42);
    expect(paragraph.listRendering?.level).toBe(1);
    expect(paragraph.formatting?.styleId).toBe('ListStyle');
    expect(paragraph.formatting?.numPr).toBeUndefined();
  });

  test('keeps code-only complex fields without adding separator runs', () => {
    const p = parseParagraphElement(`
      <w:p xmlns:w="${W_NS}">
        <w:r><w:fldChar w:fldCharType="begin"/></w:r>
        <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
        <w:r><w:fldChar w:fldCharType="end"/></w:r>
      </w:p>
    `);

    const paragraph = parseParagraph(p, null, null, null, null, null);
    const xml = serializeParagraph(paragraph);

    expect(xml).toContain('w:fldCharType="begin"');
    expect(xml).toContain('w:fldCharType="end"');
    expect(xml).not.toContain('w:fldCharType="separate"');
  });
});
