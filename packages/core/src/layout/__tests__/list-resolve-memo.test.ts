// The `withResolvedListItems` memo: identical raw inputs return the same item map and
// linked index, so a no-change layout flush skips the sequential full-story counter walk;
// any input moving by identity recomputes.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { buildNumberingIndex } from '../numbering-index.ts';
import { withResolvedListItems } from '../list-resolve.ts';
import { storyBlocks } from '../story-roots.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadNumbering(body: string) {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${body}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}

const DECIMAL = `
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
`;

function loadBodyPart() {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      '<w:r><w:t>one</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      '<w:r><w:t>two</w:t></w:r></w:p>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

describe('withResolvedListItems memo', () => {
  test('identical raw inputs return the same item map and linked index', () => {
    const numberingIndex = loadNumbering(DECIMAL);
    const blocks = storyBlocks(loadBodyPart());
    const first = withResolvedListItems({ numberingIndex }, blocks);
    const second = withResolvedListItems({ numberingIndex }, blocks);
    expect(first.listItems).toBeDefined();
    expect(second.listItems).toBe(first.listItems!);
    expect(second.numberingIndex).toBe(first.numberingIndex);
    expect(first.listItems!.size).toBe(2);
  });

  test('a different numbering index or block list recomputes', () => {
    const numberingIndex = loadNumbering(DECIMAL);
    const blocks = storyBlocks(loadBodyPart());
    const first = withResolvedListItems({ numberingIndex }, blocks);

    const freshIndex = loadNumbering(DECIMAL);
    const byIndex = withResolvedListItems({ numberingIndex: freshIndex }, blocks);
    expect(byIndex.listItems).not.toBe(first.listItems!);

    const freshBlocks = storyBlocks(loadBodyPart());
    const byBlocks = withResolvedListItems({ numberingIndex }, freshBlocks);
    expect(byBlocks.listItems).not.toBe(first.listItems!);
    expect(byBlocks.listItems!.size).toBe(first.listItems!.size);
  });

  test('a caller-supplied item map bypasses the memo untouched', () => {
    const numberingIndex = loadNumbering(DECIMAL);
    const blocks = storyBlocks(loadBodyPart());
    const supplied = new Map();
    const result = withResolvedListItems({ numberingIndex, listItems: supplied }, blocks);
    expect(result.listItems).toBe(supplied);
  });

  test('with a style cascade: repeated resolves stay identity-stable, edits stay correct', () => {
    const stylesXml =
      `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:styleId="ListNum">' +
      '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      '</w:style></w:styles>';
    const stylesResult = readOoxmlPart(stylesXml, {
      name: '/word/styles.xml',
      contentType: 'app/xml',
    });
    if (!stylesResult.ok) throw new Error(stylesResult.reason);
    const styleCascade = buildStyleCascadeTable(stylesResult.part.root);
    const numberingIndex = loadNumbering(DECIMAL);

    // Numbering arrives through the STYLE, so the per-paragraph prelude must run the
    // cascade to find it — the exact path the prelude memo shortcuts.
    const styledDoc = () => {
      const result = readOoxmlPart(
        `<w:document xmlns:w="${W}"><w:body>` +
          '<w:p><w:pPr><w:pStyle w:val="ListNum"/></w:pPr><w:r><w:t>one</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:pStyle w:val="ListNum"/></w:pPr><w:r><w:t>two</w:t></w:r></w:p>' +
          '</w:body></w:document>',
        { name: '/word/document.xml', contentType: 'app/xml' }
      );
      if (!result.ok) throw new Error(result.reason);
      return result.part;
    };

    const blocks = storyBlocks(styledDoc());
    const first = withResolvedListItems({ numberingIndex, styleCascade }, blocks);
    expect(first.listItems).toBeDefined();
    expect(first.listItems!.size).toBe(2);
    const markers = [...first.listItems!.values()].map((item) => item.markerText);
    expect(markers).toEqual(['1.', '2.']);

    // Same inputs: the outer memo returns the same map and the same linked index.
    const second = withResolvedListItems({ numberingIndex, styleCascade }, blocks);
    expect(second.listItems).toBe(first.listItems!);
    expect(second.numberingIndex).toBe(first.numberingIndex);

    // A simulated edit (fresh part → fresh blocks) recomputes to EQUAL content; the
    // per-paragraph preludes are keyed on node identity, so fresh nodes re-cascade.
    const editedBlocks = storyBlocks(styledDoc());
    const third = withResolvedListItems({ numberingIndex, styleCascade }, editedBlocks);
    expect(third.listItems).not.toBe(first.listItems!);
    expect([...third.listItems!.values()].map((item) => item.markerText)).toEqual(['1.', '2.']);
    expect(third.numberingIndex).toBe(first.numberingIndex);
  });
});
