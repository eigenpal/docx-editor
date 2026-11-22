// `w:numId w:val="0"` removes a paragraph's numbering (§17.9.18). The removal still ranks
// where a numbering level would, and resets the leading indent and the first-line offset of
// every tier below it: a paragraph that removes its numbering starts at the margin even when
// its style indents it. The trailing indent and the paragraph's own `w:ind` are unchanged.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { buildNumberingIndex } from '../numbering-index.ts';
import { resolveStoryListItems } from '../list-resolve.ts';
import {
  buildStyleCascadeTable,
  resolveParagraphLayoutInputs,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ZERO = '<w:numPr><w:numId w:val="0"/></w:numPr>';

function read(xml: string) {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function style(id: string, pPr: string, basedOn = 'Normal'): string {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:basedOn w:val="${basedOn}"/><w:pPr>${pPr}</w:pPr></w:style>`;
}

function styleTable(defaults = '', normal = ''): StyleCascadeTable {
  return buildStyleCascadeTable(
    read(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:pPrDefault><w:pPr>${defaults}</w:pPr></w:pPrDefault></w:docDefaults>` +
        `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr>${normal}</w:pPr></w:style>` +
        style('Indented', '<w:ind w:left="720"/>') +
        style('Numbered', '<w:numPr><w:numId w:val="1"/></w:numPr>', 'Indented') +
        style('Hanging', '<w:ind w:left="1440" w:hanging="720"/>') +
        style('FirstLine', '<w:ind w:left="1440" w:firstLine="720"/>') +
        style('BothSides', '<w:ind w:left="720" w:right="2880"/>') +
        style('Start', '<w:ind w:start="1440"/>') +
        style('StyleZero', ZERO, 'Indented') +
        style('StyleZeroOwnIndent', `${ZERO}<w:ind w:left="1440"/>`, 'Indented') +
        '</w:styles>'
    ).root
  );
}

const NUMBERING = buildNumberingIndex(
  read(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/>` +
      '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="1080" w:hanging="360"/></w:pPr>' +
      '</w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
  ).root
);

const STYLES = styleTable();

/** Layout inputs of one paragraph with `pPr`, as the story resolver hands them over. */
function inputs(pPr: string, styles = STYLES, cellStyle?: TableCellStyleFormatting) {
  const part = read(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>`
  );
  const blocks = part.root.children[0]!.children as OoxmlElement[];
  const item = resolveStoryListItems(blocks, NUMBERING, styles).get(blocks[0]!.id);
  return resolveParagraphLayoutInputs(
    blocks[0]!,
    468,
    styles,
    item,
    cellStyle,
    cellStyle !== undefined
  );
}

describe('a direct numId 0 resets the inherited leading indent', () => {
  test('a style indent without numbering', () => {
    expect(inputs('<w:pStyle w:val="Indented"/>').indent.left).toBe(36);
    const removed = inputs(`<w:pStyle w:val="Indented"/>${ZERO}`);
    expect(removed.indent.left).toBe(0);
    expect(removed.listItem).toBeUndefined();
  });

  test('a numbered style, with or without a stated level', () => {
    expect(inputs('<w:pStyle w:val="Numbered"/>').listItem?.indent.left).toBe(54);
    for (const numPr of [ZERO, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>']) {
      const removed = inputs(`<w:pStyle w:val="Numbered"/>${numPr}`);
      expect(removed.listItem).toBeUndefined();
      expect(removed.indent.left).toBe(0);
    }
  });

  test('the first-line offset resets with it, the trailing indent does not', () => {
    expect(inputs(`<w:pStyle w:val="Hanging"/>${ZERO}`).indent).toEqual({
      left: 0,
      right: 0,
      hanging: 0,
      firstLine: 0,
    });
    expect(inputs(`<w:pStyle w:val="FirstLine"/>${ZERO}`).indent).toMatchObject({
      left: 0,
      firstLine: 0,
    });
    expect(inputs(`<w:pStyle w:val="BothSides"/>${ZERO}`).indent).toMatchObject({
      left: 0,
      right: 144,
    });
    expect(inputs(`<w:pStyle w:val="Start"/>${ZERO}`).indent.left).toBe(0);
  });

  test('indents from the default paragraph style and the document defaults', () => {
    expect(inputs(ZERO, styleTable('', '<w:ind w:left="360"/>')).indent.left).toBe(0);
    expect(inputs(ZERO, styleTable('<w:ind w:left="540"/>')).indent.left).toBe(0);
  });

  test('an indent from the table style of the cell', () => {
    const cellStyle: TableCellStyleFormatting = {
      paragraphProperties: [{ localName: 'ind', attributes: { left: '720' } }],
      paragraphPropertyNodes: [],
      runProperties: [],
    };
    expect(inputs('', STYLES, cellStyle).indent.left).toBe(36);
    expect(inputs(ZERO, STYLES, cellStyle).indent.left).toBe(0);
  });

  test('character-unit indents reset with the twips', () => {
    const chars = inputs(
      `<w:pStyle w:val="Indented"/>${ZERO}`,
      styleTable('<w:ind w:leftChars="400" w:firstLineChars="200"/>')
    ).props.filter((property) => property.localName === 'ind');
    expect(chars.at(-1)?.attributes).toMatchObject({ leftChars: '0', firstLineChars: '0' });
  });

  test('a right-to-left paragraph resets its leading side, the right', () => {
    expect(inputs('<w:pStyle w:val="Hanging"/><w:bidi/>').indent.right).toBe(72);
    expect(inputs(`<w:pStyle w:val="Hanging"/>${ZERO}<w:bidi/>`).indent).toMatchObject({
      left: 0,
      right: 0,
      hanging: 0,
    });
  });
});

describe('the paragraph own w:ind still applies', () => {
  test('a stated leading indent', () => {
    expect(inputs(`<w:pStyle w:val="Numbered"/>${ZERO}<w:ind w:left="360"/>`).indent.left).toBe(18);
  });

  test('a stated offset or trailing indent leaves the reset leading indent', () => {
    expect(
      inputs(`<w:pStyle w:val="Hanging"/>${ZERO}<w:ind w:hanging="360"/>`).indent
    ).toMatchObject({ left: 0, hanging: 18 });
    expect(
      inputs(`<w:pStyle w:val="BothSides"/>${ZERO}<w:ind w:right="1440"/>`).indent
    ).toMatchObject({ left: 0, right: 72 });
  });
});

describe('a style numId 0 ranks below that style', () => {
  test('it resets its bases but keeps its own indent', () => {
    expect(inputs('<w:pStyle w:val="StyleZero"/>').indent.left).toBe(0);
    expect(inputs('<w:pStyle w:val="StyleZeroOwnIndent"/>').indent.left).toBe(72);
  });

  test('a direct numPr that states only a level does not move the removal', () => {
    const levelOnly = '<w:numPr><w:ilvl w:val="0"/></w:numPr>';
    expect(inputs(`<w:pStyle w:val="StyleZero"/>${levelOnly}`).indent.left).toBe(0);
    expect(inputs(`<w:pStyle w:val="StyleZeroOwnIndent"/>${levelOnly}`).indent.left).toBe(72);
  });
});

describe('controls keep their indent', () => {
  test('no numPr, a numPr without numId, an empty numId, and a numbered list item', () => {
    expect(inputs('<w:pStyle w:val="Indented"/>').indent.left).toBe(36);
    expect(
      inputs('<w:pStyle w:val="Indented"/><w:numPr><w:ilvl w:val="1"/></w:numPr>').indent.left
    ).toBe(36);
    expect(
      inputs('<w:pStyle w:val="Indented"/><w:numPr><w:numId w:val=""/></w:numPr>').indent.left
    ).toBe(36);
    const listed = inputs(
      '<w:pStyle w:val="Indented"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
    );
    expect(listed.listItem?.indent).toMatchObject({ left: 54, hanging: 18 });
    expect(listed.indent.left).toBe(54);
  });

  test('a direct numId re-enables numbering over a style numId 0', () => {
    const listed = inputs(
      '<w:pStyle w:val="StyleZero"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
    );
    expect(listed.listItem).toBeDefined();
    expect(listed.indent.left).toBe(54);
  });
});
