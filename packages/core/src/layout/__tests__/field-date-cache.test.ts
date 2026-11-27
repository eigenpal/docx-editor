// A layout made for one field date never answers another: the header and footer memo of a shared
// furniture source and the paragraph cache without a producer both key on the date.
import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { openHeadlessDocument, readOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocumentFurnitureSource } from '../document-furniture-source.ts';
import { createDocumentLinkProjectors } from '../document-link-projector.ts';
import { createDocumentStyleDependencies } from '../document-style-deps.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { withFieldScope } from '../layout-steps.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const measurer = createFixedMeasurer(6, 14);
const MARCH = new Date(2026, 2, 5, 14, 7);
const APRIL = new Date(2026, 3, 1, 8, 0);

const dateField =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> DATE \\@ "dd/MM/yyyy" </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>01/01/2020</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

type Fragments = readonly { kind: string }[];
const textOf = (fragments: Fragments | undefined): string =>
  (fragments ?? [])
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? (fragment as { lines: readonly { spans: readonly { text: string }[] }[] }).lines.flatMap(
            (line) => line.spans.map((span) => span.text)
          )
        : []
    )
    .join('');

describe('field date cache keys', () => {
  test('a shared furniture source lays the footer out again for another date', () => {
    const loaded = openHeadlessDocument(
      zipSync({
        '[Content_Types].xml': strToU8(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '<Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
            '</Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="main" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="footer" Type="${R}/footer" Target="footer.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p/><w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`
        ),
        'word/footer.xml': strToU8(`<w:ftr xmlns:w="${W}"><w:p>${dateField}</w:p></w:ftr>`),
      })
    );
    if (!loaded.ok) throw new Error(loaded.reason);
    const view = loaded.view;
    const source = createDocumentFurnitureSource({
      view,
      measurer,
      producer: 'date-test',
      cache: createParagraphLayoutCache(),
      ...createDocumentStyleDependencies(view),
      linkProjectors: createDocumentLinkProjectors(view),
      displayMode: 'proposed',
    });
    const footer = (fieldDate: Date | undefined) =>
      withFieldScope({ fieldDate }, () =>
        textOf(source.furniture()!.footers.get('default')!.fragments)
      );
    expect(footer(MARCH)).toBe('05/03/2026');
    expect(footer(APRIL)).toBe('01/04/2026');
    expect(footer(undefined)).toBe('01/01/2020');
  });

  test('a session without a producer lays the body out again for another date', () => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p>${dateField}</w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const session = createLayoutSession();
    const body = (fieldDate: Date | undefined) =>
      layoutSemanticDocument(read.part, 1, { measurer, session, fieldDate }).pages.flatMap((page) =>
        textOf(page.fragments)
      );
    expect(body(MARCH)).toEqual(['05/03/2026']);
    expect(body(APRIL)).toEqual(['01/04/2026']);
    expect(body(undefined)).toEqual(['01/01/2020']);
  });
});
