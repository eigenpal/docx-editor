/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Documents the object-model tests run against, and the runtimes that open them.
//
// Real DOCX bytes and the real headless host, never a stub: what these tests are for is that
// `context.document.body.paragraphs` reaches the canonical tree and comes back with what the
// document actually says. A fake host would let the model agree with itself.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createServer } from '../../../runtime/server.ts';
import type { DocxEditorServerRuntime } from '../../../runtime/runtime.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

export function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** A paragraph. An empty one is a bare `<w:p/>`, which is what Word writes for a blank line. */
export const p = (text: string): string =>
  text.length === 0 ? '<w:p/>' : `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** A paragraph carrying the identity Word writes, so nothing has to be minted for it. */
export const pWithId = (text: string, paraId: string): string =>
  `<w:p w14:paraId="${paraId}" w14:textId="${paraId}"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

export const cell = (...blocks: string[]): string => `<w:tc>${blocks.join('')}</w:tc>`;
export const row = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
export const table = (...rows: string[]): string => `<w:tbl>${rows.join('')}</w:tbl>`;

/** Two paragraphs: the default for anything that wants a collection with more than one item. */
export const TWO_PARAGRAPHS = docx(`${p('alpha')}${p('beta')}`);

/** A body whose paragraphs are not all at the top level, which is the ordinary case in Word. */
export const TABLE_DOCUMENT = docx(
  `${p('before')}${table(row(cell(p('in cell')), cell(p('other cell'))))}${p('after')}`
);

/** A table inside a table cell — the paragraph walk has to descend all the way. */
export const NESTED_TABLE_DOCUMENT = docx(
  `${p('outer')}${table(row(cell(table(row(cell(p('deep')))))))}`
);

/** A body with no paragraph at all. Legal OOXML, and nothing may pretend otherwise. */
export const EMPTY_BODY = docx('');

const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const HEADER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const NOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * A document whose header, footer and footnote carry paragraphs of their own.
 *
 * The main story must not include them and must not find their text — this slice publishes ONE
 * story, and a model that flattened the others into it would report a document nobody can see and
 * then write into the wrong part. The fixture is here so that claim is tested rather than assumed.
 */
export const WITH_FURNITURE: Uint8Array = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rId7" Type="${HEADER_REL}" Target="header1.xml"/>` +
      `<Relationship Id="rId8" Type="${FOOTER_REL}" Target="footer1.xml"/>` +
      `<Relationship Id="rId9" Type="${NOTES_REL}" Target="footnotes.xml"/>` +
      '</Relationships>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${OFFICE_REL}"><w:body>` +
      '<w:p><w:r><w:t>in the body</w:t></w:r>' +
      '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="2"/></w:r></w:p>' +
      '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/>' +
      '<w:footerReference w:type="default" r:id="rId8"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/></w:sectPr>' +
      '</w:body></w:document>'
  ),
  'word/header1.xml': strToU8(
    `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>in the header</w:t></w:r></w:p></w:hdr>`
  ),
  'word/footer1.xml': strToU8(
    `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>in the footer</w:t></w:r></w:p></w:ftr>`
  ),
  'word/footnotes.xml': strToU8(
    `<w:footnotes xmlns:w="${W}">` +
      '<w:footnote w:id="2"><w:p><w:r><w:t>in the footnote</w:t></w:r></w:p></w:footnote>' +
      '</w:footnotes>'
  ),
});

/** Valid, absent, and invalid file-authored dates on comments, replies, and revisions. */
export const WITH_REVIEW_DATE_CASES: Uint8Array = (() => {
  const comment = (id: string, parentId: string | undefined, date: string | undefined): string =>
    `<w:comment w:id="${id}" w:author="Reviewer" w:initials="R"` +
    (parentId === undefined ? '' : ` w16cid:parentId="${parentId}"`) +
    (date === undefined ? '' : ` w:date="${date}"`) +
    `><w:p><w:r><w:t>comment ${id}</w:t></w:r></w:p></w:comment>`;
  const anchored = (id: string): string =>
    `<w:p><w:commentRangeStart w:id="${id}"/><w:r><w:t>anchor ${id}</w:t></w:r>` +
    `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`;
  const revision = (id: string, date: string | undefined): string =>
    `<w:p><w:ins w:id="${id}" w:author="Reviewer"` +
    (date === undefined ? '' : ` w:date="${date}"`) +
    `><w:r><w:t>revision ${id}</w:t></w:r></w:ins></w:p>`;

  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdComments" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        anchored('1') +
        anchored('3') +
        anchored('5') +
        revision('11', '2026-03-01T10:00:00Z') +
        revision('12', undefined) +
        revision('13', 'not-a-date') +
        '</w:body></w:document>'
    ),
    'word/comments.xml': strToU8(
      `<w:comments xmlns:w="${W}" xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid">` +
        comment('1', undefined, '2026-01-01T10:00:00Z') +
        comment('2', '1', '2026-01-02T10:00:00Z') +
        comment('3', undefined, undefined) +
        comment('4', '3', undefined) +
        comment('5', undefined, 'not-a-date') +
        comment('6', '5', 'also-not-a-date') +
        '</w:comments>'
    ),
  });
})();

/**
 * Bookmarks in two stories, including a repeated name in the main story.
 *
 * `w:id` and bookmark names are story-scoped. Reusing both in the header is intentional: a
 * story-owned accessor must neither flatten that bookmark into the main body nor confuse the two
 * ranges.
 */
export const WITH_BOOKMARKED_STORIES: Uint8Array = (() => {
  const parts = unzipSync(WITH_FURNITURE);
  const main = strFromU8(parts['word/document.xml'] as Uint8Array).replace(
    '<w:r><w:t>in the body</w:t></w:r>',
    '<w:bookmarkStart w:id="1" w:name="First"/><w:r><w:t>first</w:t></w:r>' +
      '<w:bookmarkEnd w:id="1"/>' +
      '<w:bookmarkStart w:id="2" w:name="Duplicate"/><w:r><w:t>kept</w:t></w:r>' +
      '<w:bookmarkEnd w:id="2"/>' +
      '<w:bookmarkStart w:id="3" w:name="Duplicate"/><w:r><w:t>ignored</w:t></w:r>' +
      '<w:bookmarkEnd w:id="3"/>'
  );
  const header = strFromU8(parts['word/header1.xml'] as Uint8Array).replace(
    '<w:r><w:t>in the header</w:t></w:r>',
    '<w:bookmarkStart w:id="1" w:name="Duplicate"/><w:r><w:t>header</w:t></w:r>' +
      '<w:bookmarkEnd w:id="1"/>'
  );
  return zipSync({
    ...parts,
    'word/document.xml': strToU8(main),
    'word/header1.xml': strToU8(header),
  });
})();

/**
 * A document awkward enough to compare two hosts over: a style cascade, a table with cell
 * paragraphs, inline furniture (a tab and a break), and section properties.
 *
 * Two plain paragraphs would let every parity assertion pass while proving almost nothing — the
 * places where a bespoke read drifts from the canonical one are exactly the ones here.
 */
export const REPRESENTATIVE: Uint8Array = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
      '<w:p w14:paraId="0A0B0C0D"><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>Quarterly report</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Prepared by </w:t></w:r>' +
      '<w:r><w:rPr><w:i/></w:rPr><w:t>the team</w:t></w:r></w:p>' +
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>Total</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>1200</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:t>notes</w:t><w:tab/><w:t>and</w:t><w:br/><w:t>more</w:t></w:r></w:p>' +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
      '</w:body></w:document>'
  ),
  'word/styles.xml': strToU8(
    `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
      '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>' +
      '<w:rPr><w:sz w:val="32"/></w:rPr></w:style>' +
      '</w:styles>'
  ),
});

export function serverRuntime(
  bytes: Uint8Array = TWO_PARAGRAPHS
): Promise<DocxEditorServerRuntime> {
  return createServer(bytes);
}

/** Save what a runtime holds and open it again, so an assertion is about the document. */
export async function reopen(runtime: DocxEditorServerRuntime): Promise<DocxEditorServerRuntime> {
  return createServer(await runtime.save());
}

/** The saved `word/document.xml`, for the assertions that are about markup rather than text. */
export async function mainXmlOf(runtime: DocxEditorServerRuntime): Promise<string> {
  const parts = unzipSync(await runtime.save());
  return strFromU8(parts['word/document.xml'] as Uint8Array);
}

/**
 * A formatting read, widened to admit the `null` it can answer.
 *
 * `Font#bold`, `Paragraph#leftIndent` and `Body#style` are declared with upstream's own
 * non-nullable types on purpose — see the "A NULL A DECLARATION CANNOT SAY" note in
 * `compat/docxeditor/declarations.ts`: widening them would stop them matching the reference they
 * are measured against, and upstream declares and behaves the same way. The runtime still answers
 * `null` where the characters or paragraphs read disagree, or where nothing authors the value, and
 * the tests below are ABOUT that `null`. Saying so once here beats a cast at every call site.
 */
export function orNull<T>(read: T): T | null {
  return read;
}
