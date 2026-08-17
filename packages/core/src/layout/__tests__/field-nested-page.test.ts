// A complex PAGE-family field nested inside a complex outer field evaluates per sheet.
//
// `STYLEREF` wrapping `PAGE` is ordinary in a running header. The outer field's cached result
// used to concatenate the inner field's saved digits verbatim, so every sheet painted the
// producer's last saved number — and detection missed the inner field too, so the story's
// page-context key stayed empty and ONE layout served every sheet. Both halves are pinned
// here, mirroring the `w:fldSimple` semantics in `field-simple-result.ts`.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  readOoxmlPackage,
  readOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  detectStoryPageFields,
  MAX_FIELD_INSTRUCTION_CHARS,
  piecesOfParagraph,
} from '../field-projection.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { createFixedMeasurer } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function partOf(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphOf(body: string): OoxmlNode {
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind === 'paragraph') return node;
    if (node.kind === 'textValue') return undefined;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return undefined;
  };
  const paragraph = find(partOf(body).root);
  if (!paragraph) throw new Error('no paragraph');
  return paragraph;
}

/** One complex field: begin / instrText / separate / cached result / end, one run each. */
function complexField(instr: string, cached: string): string {
  return (
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    (cached.length > 0 ? `<w:r><w:t xml:space="preserve">${cached}</w:t></w:r>` : '') +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`
  );
}

/** A complex STYLEREF whose cached result holds `content` (runs and nested fields). */
function outerField(content: string): string {
  return (
    `<w:p>` +
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText> STYLEREF "Heading 1" </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    content +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
    `</w:p>`
  );
}

const textRun = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

const NESTED_PAGE = outerField(textRun('Chapter p. ') + complexField(' PAGE ', '7') + textRun('!'));

describe('a complex PAGE nested inside a complex outer field', () => {
  test('evaluates per sheet inside the outer cached result', () => {
    const paragraph = paragraphOf(NESTED_PAGE);
    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 3, pageCount: 9 });
    expect(pieces.map((piece) => piece.text)).toEqual(['Chapter p. 3!']);
    // Still one atomic model unit; the inner field donates display text only.
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
    expect(
      piecesOfParagraph(paragraph, [], { pageNumber: 8, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('Chapter p. 8!');
  });

  test('without a page context the cached digits stay verbatim', () => {
    expect(
      piecesOfParagraph(paragraphOf(NESTED_PAGE))
        .map((piece) => piece.text)
        .join('')
    ).toBe('Chapter p. 7!');
  });

  test('is detected so the story requests a per-sheet context at all', () => {
    expect(detectStoryPageFields(partOf(NESTED_PAGE).root)).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('inner NUMPAGES and SECTIONPAGES evaluate and are detected', () => {
    const numbers = outerField(
      complexField(' NUMPAGES ', '99') + textRun('/') + complexField(' SECTIONPAGES ', '88')
    );
    expect(
      piecesOfParagraph(paragraphOf(numbers), [], {
        pageNumber: 3,
        pageCount: 26,
        sectionPageCount: 8,
      })
        .map((piece) => piece.text)
        .join('')
    ).toBe('26/8');
    expect(detectStoryPageFields(partOf(numbers).root)).toEqual({
      hasPage: false,
      hasNumPages: true,
      hasSectionPages: true,
    });
  });

  test('an inner non-page field keeps its cached text verbatim', () => {
    const ref = outerField(textRun('see ') + complexField(' REF _Ref9 ', 'Section 4'));
    expect(
      piecesOfParagraph(paragraphOf(ref), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('see Section 4');
  });

  test('nesting past MAX_FIELD_NESTING stays inert and verbatim', () => {
    // Levels 1..5: the fifth begin exceeds the cap, the whole outer field demotes, and no
    // level evaluates. The deep PAGE's digits stay ordinary addressable text.
    const depth5 = outerField(
      textRun('A') +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText> REF b </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        complexField(' PAGE ', '7') +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        textRun('Z')
    );
    const pieces = piecesOfParagraph(paragraphOf(depth5), [], { pageNumber: 3, pageCount: 9 });
    expect(pieces.map((piece) => piece.text).join('')).toBe('A7Z');
    expect(pieces.every((piece) => !piece.projected)).toBe(true);
    expect(detectStoryPageFields(partOf(depth5).root)).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
  });

  test('an oversize inner instruction leaves that level inert and its sibling live', () => {
    const oversize = ` PAGE ${'X'.repeat(MAX_FIELD_INSTRUCTION_CHARS + 1)} `;
    const mixed = outerField(
      textRun('p. ') + complexField(oversize, '7') + textRun('-') + complexField(' PAGE ', '9')
    );
    expect(
      piecesOfParagraph(paragraphOf(mixed), [], { pageNumber: 3, pageCount: 9 })
        .map((piece) => piece.text)
        .join('')
    ).toBe('p. 7-3');
    expect(detectStoryPageFields(partOf(mixed).root).hasPage).toBe(true);
  });
});

describe('a header/footer story with a complex-nested PAGE', () => {
  test('lays out per-sheet digits end-to-end', () => {
    const measurer = createFixedMeasurer(6, 14);
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
      ),
      'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${NESTED_PAGE}</w:ftr>`),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p>` +
          `<w:sectPr><w:footerReference w:type="default" r:id="rId1"/></w:sectPr>` +
          '</w:body></w:document>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const footer = [...loaded.package.parts.values()].find((part) =>
      part.name.includes('footer1')
    )!;
    const baseline = layoutHeaderFooterStory(footer, 400, measurer, 'test');
    // Detection must report the nested PAGE, or one layout serves every sheet.
    expect(baseline.pageFieldNeeds).toEqual({
      hasPage: true,
      hasNumPages: false,
      hasSectionPages: false,
    });
    const textOf = (story: typeof baseline): string =>
      story.fragments
        .flatMap((fragment) =>
          fragment.kind === 'paragraph'
            ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
            : []
        )
        .join('');
    expect(textOf(baseline)).toBe('Chapter p. 7!');
    const page2 = baseline.withPageContext({ pageNumber: 2, pageCount: 26 });
    const page9 = baseline.withPageContext({ pageNumber: 9, pageCount: 26 });
    expect(textOf(page2)).toBe('Chapter p. 2!');
    expect(textOf(page9)).toBe('Chapter p. 9!');
    expect(page9).not.toBe(page2);
    expect(baseline.withPageContext({ pageNumber: 2, pageCount: 26 })).toBe(page2);
  });
});
