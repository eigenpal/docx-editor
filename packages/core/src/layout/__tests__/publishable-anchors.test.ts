// An anchor after an explicit page break belongs with the text after the break: the fragment
// that ends at the break does not publish it.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { publishableAnchors } from '../body-flow-helpers.ts';
import type { PendingLine } from '../paragraph-flow.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

const drawing =
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
  'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset>' +
  '</wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset>' +
  '</wp:positionV><wp:extent cx="914400" cy="914400"/><wp:wrapNone/><wp:docPr id="1" name="A"/>' +
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
  '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"/>' +
  '</a:graphic></wp:anchor></w:drawing></w:r>';

function paragraph(content: string): OoxmlElement {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}"><w:body><w:p>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  const body = result.part.root.children.find(
    (node): node is OoxmlElement => node.kind !== 'textValue' && node.localName === 'body'
  )!;
  return body.children.find((node): node is OoxmlElement => node.kind === 'paragraph')!;
}

const line = (start: number, end: number, pageBreakAfter?: boolean) =>
  ({ start, end, ...(pageBreakAfter ? { pageBreakAfter } : {}) }) as unknown as PendingLine;
const published = (end: number) => [{ range: { end } }];

test('a fragment that ends at a page break leaves a later anchor to the next fragment', () => {
  const p = paragraph(`<w:r><w:br w:type="page"/></w:r>${drawing}<w:r><w:t>After</w:t></w:r>`);
  const lines = [line(0, 1, true), line(1, 7)];
  expect(publishableAnchors(p, lines, published(1))).toBeNull();
  expect(publishableAnchors(p, lines, published(7))).toEqual([1]);
});

test('an anchor before the break publishes with the first fragment', () => {
  const p = paragraph(`${drawing}<w:r><w:t>A</w:t><w:br w:type="page"/><w:t>B</w:t></w:r>`);
  const lines = [line(0, 3, true), line(3, 4)];
  expect(publishableAnchors(p, lines, published(3))).toEqual([0]);
});

test('a fragment cut by the page bottom keeps the paragraph origin', () => {
  const p = paragraph(`<w:r><w:t>Long text</w:t></w:r>${drawing}`);
  const lines = [line(0, 5), line(5, 10)];
  expect(publishableAnchors(p, lines, published(5))).toEqual([9]);
});
