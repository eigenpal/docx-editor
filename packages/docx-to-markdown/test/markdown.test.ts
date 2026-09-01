import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { openDocumentForExport, type ExportDocumentSource } from '@docx-editor.dev/core/export';
import {
  openHeadlessDocument,
  relationshipTargetIn,
  type HeadlessDocumentView,
} from '@docx-editor.dev/core/store';
import {
  exportMarkdownFrom,
  exportMarkdownLayout,
  type MarkdownExportOptions,
  type MarkdownExportResult,
} from '../src/markdown.ts';

async function exportMarkdown(
  source: ExportDocumentSource,
  options: MarkdownExportOptions = {}
): Promise<MarkdownExportResult> {
  const opened = openDocumentForExport(source, options);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    return await exportMarkdownFrom(opened.session, options);
  } finally {
    opened.session.dispose();
  }
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

interface ExtraParts {
  readonly contentTypes?: string;
  readonly documentRelationships?: string;
  readonly entries?: Readonly<Record<string, Uint8Array>>;
}

function docx(body: string, numbering?: string, extra: ExtraParts = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (numbering
          ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
          : '') +
        (extra.contentTypes ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (numbering) {
    entries['word/numbering.xml'] = strToU8(numbering);
  }
  if (numbering || extra.documentRelationships) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">` +
        (numbering
          ? `<Relationship Id="rNum" Type="${R}/numbering" Target="numbering.xml"/>`
          : '') +
        (extra.documentRelationships ?? '') +
        '</Relationships>'
    );
  }
  Object.assign(entries, extra.entries ?? {});
  return zipSync(entries);
}

const inlineDrawingContent =
  '<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
  '<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="pic" descr="Diagram"/>' +
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="pic"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rImage"/></pic:blipFill><pic:spPr/></pic:pic>' +
  '</a:graphicData></a:graphic></wp:inline></w:drawing>';
const inlineDrawing = `<w:p><w:r>${inlineDrawingContent}</w:r></w:p>`;

function png(): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  bytes.set([0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0, 0, 0], 16);
  return bytes;
}

function imageDocx(): Uint8Array {
  return docx(inlineDrawing, undefined, {
    contentTypes: '<Default Extension="png" ContentType="image/png"/>',
    documentRelationships: `<Relationship Id="rImage" Type="${R}/image" Target="media/image.png"/>`,
    entries: { 'word/media/image.png': png() },
  });
}

function manyImageDocx(count: number): Uint8Array {
  const body = Array.from({ length: count }, (_, index) =>
    inlineDrawing
      .replaceAll('rImage', `rImage${index}`)
      .replace('id="1" name="pic"', `id="${index + 1}" name="pic"`)
  ).join('');
  const entries: Record<string, Uint8Array> = {};
  const relationships: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const bytes = png();
    bytes[32] = index;
    entries[`word/media/image-${index}.png`] = bytes;
    relationships.push(
      `<Relationship Id="rImage${index}" Type="${R}/image" Target="media/image-${index}.png"/>`
    );
  }
  return docx(body, undefined, {
    contentTypes: '<Default Extension="png" ContentType="image/png"/>',
    documentRelationships: relationships.join(''),
    entries,
  });
}

describe('record-only Markdown export', () => {
  test('translates an immutable layout after its producer session is disposed', async () => {
    const opened = openDocumentForExport(docx('<w:p><w:r><w:t>Detached</w:t></w:r></w:p>'));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const layout = await opened.session.layout();
    opened.session.dispose();

    expect(Object.isFrozen(layout)).toBe(true);
    expect(exportMarkdownLayout(layout).markdown).toBe('Detached');
  });

  test('translates preprocessed images from a detached layout after disposal', async () => {
    const opened = openDocumentForExport(imageDocx());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const layout = await opened.session.layout();
    const paragraph = layout.pages[0]?.fragments[0];
    expect(paragraph?.kind).toBe('paragraph');
    if (paragraph?.kind !== 'paragraph') return;
    const drawing = paragraph.lines.flatMap((line) => line.drawings ?? [])[0]!;
    expect(opened.session.validatedImageBytes(drawing)?.[0]).toBe(0x89);
    const urls = new WeakMap<object, string>([[drawing, 'https://cdn.example/detached.png']]);
    opened.session.dispose();

    const rendered = exportMarkdownLayout(layout, {
      image: (candidate) => {
        const url = urls.get(candidate);
        return url ? { url } : { skip: true };
      },
    });
    expect(rendered.markdown).toContain('![Diagram](https://cdn.example/detached.png)');
  });

  test('translates real OMML through the published equation fallback', async () => {
    const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
    const result = await exportMarkdown(
      docx(
        `<w:p><w:r><w:t>Formula: </w:t></w:r><m:oMath xmlns:m="${M}">` +
          '<m:r><m:t>x &lt; y</m:t></m:r></m:oMath></w:p>'
      )
    );

    expect(result.markdown).toBe('Formula: x &lt; y');
    expect(result.markdown).not.toContain('\uFFFC');
  });

  test('publishes resolved paragraph semantics and translates marks, hard breaks, and hostile text', async () => {
    const bytes = docx(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/><w:jc w:val="center"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>' +
        '<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Strong</w:t><w:br/><w:t>Next</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>&lt;script&gt; *x* [y] #z</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Not a heading</w:t><w:br/><w:t>===</w:t></w:r></w:p>'
    );
    const opened = openDocumentForExport(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      const layout = await opened.session.layout();
      const heading = layout.pages[0]!.fragments[0];
      expect(heading?.kind).toBe('paragraph');
      if (heading?.kind === 'paragraph') {
        expect({
          styleId: heading.styleId,
          outlineLevel: heading.outlineLevel,
          alignment: heading.alignment,
        }).toEqual({ styleId: 'Heading1', outlineLevel: 0, alignment: 'center' });
      }
      const result = await exportMarkdownFrom(opened.session);
      expect(result.markdown).toContain('# Title');
      expect(result.markdown).toContain('***Strong***  \n***Next***');
      expect(result.markdown).toContain('&lt;script&gt; \\*x\\* \\[y\\] \\#z');
      expect(result.markdown).toContain('Not a heading  \n\\=\\=\\=');
      expect(result.pages).toHaveLength(layout.pages.length);
      expect(result.pages[0]!.number).toBe(1);
    } finally {
      opened.session.dispose();
    }
  });

  test('uses published list ordinals and table header/alignment records', async () => {
    const numbering =
      `<w:numbering xmlns:w="${W}">` +
      '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
    const list = (text: string) =>
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const table =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
      '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr/><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:tcPr/><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>A|B</w:t></w:r></w:p></w:tc><w:tc><w:tcPr/><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const result = await exportMarkdown(docx(list('One') + list('Two') + table, numbering));
    expect(result.markdown).toContain('1. One\n\n2. Two');
    expect(result.markdown).toContain('| Name | Value |');
    expect(result.markdown).toContain('| :---: | --- |');
    expect(result.markdown).toContain('| A\\|B | 2 |');
  });

  test('does not turn preserved paragraph spacing or table-cell outlines into GFM blocks', async () => {
    const table =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>' +
      '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Cell heading</w:t></w:r></w:p>' +
      '</w:tc></w:tr></w:tbl>';
    const result = await exportMarkdown(
      docx('<w:p><w:r><w:t xml:space="preserve">    ordinary text</w:t></w:r></w:p>' + table)
    );
    expect(result.markdown).toStartWith('&nbsp;&nbsp;&nbsp;&nbsp;ordinary text');
    expect(result.markdown).toContain('| Cell heading |');
    expect(result.markdown).not.toContain('| # Cell heading |');
  });

  test('keeps stateful inline styles valid across adjacent and overlapping Word runs', async () => {
    const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
    const result = await exportMarkdown(
      docx(
        '<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>A</w:t></w:r>' +
          '<w:r><w:rPr><w:i/></w:rPr><w:t>B</w:t></w:r></w:p>' +
          '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>C</w:t></w:r>' +
          '<w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>D</w:t></w:r></w:p>' +
          '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>M</w:t></w:r>' +
          '<w:r><w:rPr><w:i/></w:rPr><w:t>N</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>O</w:t></w:r>' +
          '<w:r><w:rPr><w:i/><w:strike/></w:rPr><w:t>P</w:t></w:r></w:p>' +
          '<w:p><w:r><w:rPr><w:strike/></w:rPr><w:t>E</w:t></w:r>' +
          '<w:r><w:rPr><w:dstrike/></w:rPr><w:t>F</w:t></w:r>' +
          '<w:del w:id="1" w:author="A"><w:r><w:delText>G</w:delText></w:r></w:del></w:p>' +
          '<w:p><w:hyperlink r:id="rStyle"><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>H</w:t></w:r>' +
          '<w:r><w:rPr><w:i/></w:rPr><w:t>I</w:t></w:r></w:hyperlink>' +
          '<w:r><w:rPr><w:i/></w:rPr><w:t>J</w:t></w:r></w:p>' +
          `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>K</w:t></w:r><m:oMath xmlns:m="${M}">` +
          '<m:r><m:t>q</m:t></m:r></m:oMath>' +
          '<w:r><w:rPr><w:i/></w:rPr><w:t>L</w:t></w:r></w:p>',
        undefined,
        {
          documentRelationships: `<Relationship Id="rStyle" Type="${R}/hyperlink" Target="https://example.com/style" TargetMode="External"/>`,
        }
      ),
      { displayMode: 'all-markup' }
    );
    expect(result.markdown).toBe(
      '***A**B*\n\n*C**D***\n\n*MN*\n\nO*~~P~~*\n\n~~EFG~~\n\n' +
        '[***H**I*](https://example.com/style)*J*\n\n*K*q*L*'
    );
    expect(micromark(result.markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] })).toBe(
      '<p><em><strong>A</strong>B</em></p>\n' +
        '<p><em>C<strong>D</strong></em></p>\n' +
        '<p><em>MN</em></p>\n' +
        '<p>O<em><del>P</del></em></p>\n' +
        '<p><del>EFG</del></p>\n' +
        '<p><a href="https://example.com/style"><em><strong>H</strong>I</em></a><em>J</em></p>\n' +
        '<p><em>K</em>q<em>L</em></p>'
    );
  });

  test('uses semantic tags when punctuation makes GFM style delimiters unsafe', async () => {
    const run = (text: string, properties = '') =>
      `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t>${text}</w:t></w:r>`;
    const result = await exportMarkdown(
      docx(
        '<w:p>' +
          run('a') +
          run('!x', '<w:i/>') +
          '</w:p>' +
          '<w:p>' +
          run('x!', '<w:i/>') +
          run('a') +
          '</w:p>' +
          '<w:p>' +
          run('a') +
          run('!x', '<w:b/>') +
          '</w:p>' +
          '<w:p>' +
          run('x!', '<w:b/>') +
          run('a') +
          '</w:p>' +
          '<w:p>' +
          run('a') +
          run('!x', '<w:strike/>') +
          '</w:p>' +
          '<w:p>' +
          run('x!', '<w:strike/>') +
          run('a') +
          '</w:p>'
      )
    );

    expect(result.markdown).toBe(
      'a<em>\\!x</em>\n\n<em>x\\!</em>a\n\n' +
        'a<strong>\\!x</strong>\n\n<strong>x\\!</strong>a\n\n' +
        'a<del>\\!x</del>\n\n<del>x\\!</del>a'
    );
    expect(
      micromark(result.markdown, {
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()],
        allowDangerousHtml: true,
      })
    ).toBe(
      '<p>a<em>!x</em></p>\n' +
        '<p><em>x!</em>a</p>\n' +
        '<p>a<strong>!x</strong></p>\n' +
        '<p><strong>x!</strong>a</p>\n' +
        '<p>a<del>!x</del></p>\n' +
        '<p><del>x!</del>a</p>'
    );
  });

  test('retains one inline style state across layout-created line fragments', async () => {
    const text = 'x'.repeat(500);
    const result = await exportMarkdown(
      docx(`<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>${text}</w:t></w:r></w:p>`)
    );
    expect(result.markdown).toBe(`*${text}*`);
    expect(micromark(result.markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] })).toBe(
      `<p><em>${text}</em></p>`
    );
  });

  test('keeps note and drawing atoms outside neighboring inline style delimiters', async () => {
    const footnotes =
      `<w:footnotes xmlns:w="${W}">` +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>Note</w:t></w:r></w:p></w:footnote>' +
      '</w:footnotes>';
    const result = await exportMarkdown(
      docx(
        '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>C</w:t></w:r>' +
          '<w:r><w:footnoteReference w:id="1"/></w:r>' +
          '<w:r><w:rPr><w:i/></w:rPr><w:t>D</w:t></w:r></w:p>' +
          '<w:p><w:del w:id="2" w:author="A"><w:r><w:delText>E</w:delText></w:r></w:del>' +
          `<w:del w:id="3" w:author="A"><w:r>${inlineDrawingContent}</w:r></w:del>` +
          '<w:del w:id="4" w:author="A"><w:r><w:delText>F</w:delText></w:r></w:del></w:p>',
        undefined,
        {
          contentTypes:
            '<Default Extension="png" ContentType="image/png"/>' +
            '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
          documentRelationships:
            `<Relationship Id="rImage" Type="${R}/image" Target="media/image.png"/>` +
            `<Relationship Id="rFn" Type="${R}/footnotes" Target="footnotes.xml"/>`,
          entries: {
            'word/media/image.png': png(),
            'word/footnotes.xml': strToU8(footnotes),
          },
        }
      ),
      {
        displayMode: 'all-markup',
        image: () => ({ url: 'https://cdn.example/diagram.png' }),
      }
    );
    expect(result.markdown).toContain('*C*[^1]*D*');
    expect(result.markdown).toContain(
      '~~E~~<del>![Diagram](https://cdn.example/diagram.png)</del>~~F~~'
    );
    const html = micromark(result.markdown, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
      allowDangerousHtml: true,
    });
    expect(html).toContain('<em>C</em><sup>');
    expect(html).toContain('</sup><em>D</em>');
    expect(html).toContain(
      '<p><del>E</del><del><img src="https://cdn.example/diagram.png" alt="Diagram" /></del><del>F</del></p>'
    );
  });

  test('reuses one settled layout and returns typed refusals for bad bytes', async () => {
    const opened = openDocumentForExport(docx('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>'));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const first = await opened.session.layout();
    const second = await opened.session.layout();
    expect(second).toBe(first);
    opened.session.dispose();

    const refused = openDocumentForExport(new Uint8Array([1, 2, 3]));
    expect(refused.ok).toBe(false);
    expect(() => openDocumentForExport(docx('<w:p/>'), { resourceTimeoutMs: Number.NaN })).toThrow(
      RangeError
    );
  });

  test('one consumer cannot mutate the shared layout seen by Markdown or a PDF-style walk', async () => {
    const opened = openDocumentForExport(
      docx('<w:p><w:r><w:t>Hello immutable exporters</w:t></w:r></w:p>')
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      const first = await opened.session.layout();
      const firstParagraph = first.pages[0]?.fragments[0];
      expect(firstParagraph?.kind).toBe('paragraph');
      if (firstParagraph?.kind !== 'paragraph') return;
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.pages)).toBe(true);
      expect(Object.isFrozen(firstParagraph.lines[0]!.spans[0]!)).toBe(true);

      expect(() => (first.pages as unknown[]).splice(0, 1)).toThrow();
      expect(() =>
        Object.assign(firstParagraph.lines[0]!.spans[0]!, { text: 'poisoned' })
      ).toThrow();

      const markdown = await exportMarkdownFrom(opened.session);
      expect(markdown.markdown).toBe('Hello immutable exporters');

      // A second adapter consuming records directly sees the same intact, stable snapshot.
      const second = await opened.session.layout();
      expect(second).toBe(first);
      const pdfStyleText = second.pages
        .flatMap((page) => page.fragments)
        .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
        .flatMap((line) => line.spans)
        .map((span) => span.text)
        .join('');
      expect(pdfStyleText).toBe('Hello immutable exporters');
    } finally {
      opened.session.dispose();
    }
  });

  test('refreshes links and document-property fields across body, header, and notes revisions', async () => {
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> AUTHOR </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const linked = (label: string) =>
      `<w:hyperlink r:id="rLink"><w:r><w:t>${label}</w:t></w:r></w:hyperlink>`;
    const header = `<w:hdr xmlns:w="${W}" xmlns:r="${R}"><w:p>${field}${linked('header')}</w:p></w:hdr>`;
    const footnotes =
      `<w:footnotes xmlns:w="${W}" xmlns:r="${R}">` +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>' +
      field +
      linked('note') +
      '</w:p></w:footnote></w:footnotes>';
    const externalRels = `<Relationships xmlns="${REL}"><Relationship Id="rLink" Type="${R}/hyperlink" Target="https://a.example" TargetMode="External"/></Relationships>`;
    const bytes = docx(
      `<w:p>${field}${linked('body')}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/></w:sectPr>',
      undefined,
      {
        contentTypes:
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
        documentRelationships:
          `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
          `<Relationship Id="rLink" Type="${R}/hyperlink" Target="https://a.example" TargetMode="External"/>`,
        entries: {
          'word/header1.xml': strToU8(header),
          'word/footnotes.xml': strToU8(footnotes),
          'word/_rels/header1.xml.rels': strToU8(externalRels),
          'word/_rels/footnotes.xml.rels': strToU8(externalRels),
        },
      }
    );
    const opened = openHeadlessDocument(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    let revision = 0;
    let creator = 'Ada';
    let pkg = opened.view.currentPackage();
    const live: HeadlessDocumentView = {
      ...opened.view,
      currentPackage: () => pkg,
      packageRevision: () => revision,
      documentProperties: () => ({ creator }),
      relationshipTarget: (id) => relationshipTargetIn(pkg, pkg.mainDocumentPart, id),
    };
    const session = openDocumentForExport(live);
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    try {
      const first = await exportMarkdownFrom(session.session);
      expect(first.markdown).toContain('Ada[body](https://a.example)');
      expect(first.markdown).toContain('[^1]: Ada[note](https://a.example)');
      expect(first.pages[0]?.headerMarkdown).toContain('Ada[header](https://a.example)');

      creator = 'Grace';
      pkg = Object.freeze({
        ...pkg,
        externalTargets: pkg.externalTargets.map((target) => ({
          ...target,
          rawTarget:
            target.rawTarget === 'https://a.example' ? 'https://b.example' : target.rawTarget,
        })),
      });
      revision += 1;
      const second = await exportMarkdownFrom(session.session);
      expect(second.markdown).toContain('Grace[body](https://b.example)');
      expect(second.markdown).toContain('[^1]: Grace[note](https://b.example)');
      expect(second.pages[0]?.headerMarkdown).toContain('Grace[header](https://b.example)');

      // Change only the header relationship projection. Body geometry, body fields, and the
      // authored header part stay identical, so this catches stale whole-page furniture reuse.
      pkg = Object.freeze({
        ...pkg,
        externalTargets: pkg.externalTargets.map((target) =>
          target.ownerPart === '/word/header1.xml'
            ? { ...target, rawTarget: 'https://c.example' }
            : target
        ),
      });
      revision += 1;
      const third = await exportMarkdownFrom(session.session);
      expect(third.markdown).toContain('Grace[body](https://b.example)');
      expect(third.markdown).toContain('[^1]: Grace[note](https://b.example)');
      expect(third.pages[0]?.headerMarkdown).toContain('Grace[header](https://c.example)');
    } finally {
      session.session.dispose();
    }
  });

  test('escapes GFM controls, preserves valid mark boundaries, maps style-only headings, and removes form feeds', async () => {
    const result = await exportMarkdown(
      docx(
        '<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Fallback heading</w:t></w:r></w:p>' +
          '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> bold </w:t></w:r>' +
          '<w:r><w:t>~~hostile~~</w:t><w:br w:type="page"/><w:t>after</w:t></w:r></w:p>'
      )
    );
    expect(result.markdown).toContain('### Fallback heading');
    expect(result.markdown).toContain('**bold** ');
    expect(result.markdown).toContain('\\~\\~hostile\\~\\~');
    expect(result.markdown).not.toContain('\f');

    const explicitlyBody = await exportMarkdown(
      docx(
        '<w:p><w:pPr><w:pStyle w:val="Heading3"/><w:outlineLvl w:val="9"/></w:pPr><w:r><w:t>Body despite style</w:t></w:r></w:p>'
      )
    );
    expect(explicitlyBody.markdown).toBe('Body despite style');
  });

  test('keeps authored hard breaks inside ATX headings', async () => {
    const result = await exportMarkdown(
      docx(
        '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr>' +
          '<w:r><w:rPr><w:b/></w:rPr><w:t>Line one</w:t><w:br/><w:t>Line two</w:t></w:r></w:p>'
      )
    );
    expect(result.markdown).toBe('# **Line** **one**<br>**Line** **two**');
    expect(
      micromark(result.markdown, {
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()],
        allowDangerousHtml: true,
      })
    ).toBe(
      '<h1><strong>Line</strong> <strong>one</strong><br><strong>Line</strong> <strong>two</strong></h1>'
    );
  });

  test('uses sanitized external links and leaves internal, refused, and unresolved links inert', async () => {
    const body =
      '<w:p><w:hyperlink r:id="rWeb"><w:r><w:t>safe</w:t></w:r></w:hyperlink>' +
      '<w:hyperlink r:id="rEncoded"><w:r><w:t>encoded</w:t></w:r></w:hyperlink>' +
      '<w:hyperlink r:id="rSlash"><w:r><w:t>slash</w:t></w:r></w:hyperlink>' +
      '<w:hyperlink r:id="rBad"><w:r><w:t>bad</w:t></w:r></w:hyperlink>' +
      '<w:hyperlink w:anchor="bookmark"><w:r><w:t>inside</w:t></w:r></w:hyperlink>' +
      '<w:hyperlink r:id="missing"><w:r><w:t>missing</w:t></w:r></w:hyperlink></w:p>' +
      '<w:p><w:hyperlink r:id="rWhitespace"><w:r><w:t xml:space="preserve">  </w:t></w:r></w:hyperlink></w:p>';
    const result = await exportMarkdown(
      docx(body, undefined, {
        documentRelationships:
          `<Relationship Id="rWeb" Type="${R}/hyperlink" Target="https://example.com/a_(b)" TargetMode="External"/>` +
          `<Relationship Id="rEncoded" Type="${R}/hyperlink" Target="https://example.com/my%20file.pdf" TargetMode="External"/>` +
          `<Relationship Id="rSlash" Type="${R}/hyperlink" Target="https://example.com/a\\b" TargetMode="External"/>` +
          `<Relationship Id="rWhitespace" Type="${R}/hyperlink" Target="https://example.com/space" TargetMode="External"/>` +
          `<Relationship Id="rBad" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>`,
      })
    );
    expect(result.markdown).toContain('[safe](https://example.com/a_%28b%29)');
    expect(result.markdown).toContain('[encoded](https://example.com/my%20file.pdf)');
    expect(result.markdown).toContain('[slash](https://example.com/a%5Cb)');
    expect(result.markdown).toContain('[  ](https://example.com/space)');
    expect(result.markdown).toContain('badinside missing'.replace(' ', ''));
    expect(result.markdown).not.toContain('javascript:');
    const html = micromark(result.markdown, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
    expect(html).toContain('<a href="https://example.com/a%5Cb">slash</a>');
    expect(html).toContain('<a href="https://example.com/space">  </a>');
  });

  test('projects sanitized hyperlinks and HYPERLINK fields in header stories', async () => {
    const header =
      `<w:hdr xmlns:w="${W}" xmlns:r="${R}"><w:p>` +
      '<w:hyperlink r:id="rGood"><w:r><w:t>good</w:t></w:r></w:hyperlink>' +
      '<w:hyperlink r:id="rBad"><w:r><w:t>bad</w:t></w:r></w:hyperlink>' +
      '<w:hyperlink w:anchor="inside"><w:r><w:t>inside</w:t></w:r></w:hyperlink>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> HYPERLINK "https://field.example/path" </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>field</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>';
    const headerRels =
      `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rGood" Type="${R}/hyperlink" Target="https://example.com/a_(b)" TargetMode="External"/>` +
      `<Relationship Id="rBad" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>` +
      '</Relationships>';
    const result = await exportMarkdown(
      docx(
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rHeader"/></w:sectPr>',
        undefined,
        {
          contentTypes:
            '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
          documentRelationships: `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>`,
          entries: {
            'word/header1.xml': strToU8(header),
            'word/_rels/header1.xml.rels': strToU8(headerRels),
          },
        }
      )
    );
    const projected = result.pages[0]?.headerMarkdown ?? '';
    expect(projected).toContain('[good](https://example.com/a_%28b%29)');
    expect(projected).toContain('bad');
    expect(projected).not.toContain('javascript:');
    expect(projected).toContain('inside');
    expect(projected).toContain('[field](https://field.example/path)');
  });

  test('publishes table-style row header semantics with direct off taking precedence', async () => {
    const styles =
      `<w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="Headers">` +
      '<w:tblStylePr w:type="firstRow"><w:trPr><w:tblHeader/></w:trPr></w:tblStylePr>' +
      '</w:style></w:styles>';
    const row = (text: string, properties = '') =>
      `<w:tr>${properties}<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`;
    const table =
      '<w:tbl><w:tblPr><w:tblStyle w:val="Headers"/><w:tblLook w:firstRow="1"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
      row('Styled header') +
      row('Direct body', '<w:trPr><w:tblHeader w:val="off"/></w:trPr>') +
      '</w:tbl>';
    const opened = openDocumentForExport(
      docx(table, undefined, {
        contentTypes:
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
        documentRelationships: `<Relationship Id="rStyles" Type="${R}/styles" Target="styles.xml"/>`,
        entries: { 'word/styles.xml': strToU8(styles) },
      })
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      const record = (await opened.session.layout()).pages[0]?.fragments[0];
      expect(record?.kind).toBe('table');
      if (record?.kind !== 'table') return;
      expect(record.rows.map((candidate) => candidate.isHeaderRow)).toEqual([true, false]);
    } finally {
      opened.session.dispose();
    }
  });

  test('strikes tracked deletions only in all-markup and respects resolved revision projections', async () => {
    const bytes = docx(
      '<w:p><w:del w:id="1" w:author="A"><w:r><w:delText>Old</w:delText></w:r></w:del>' +
        '<w:ins w:id="2" w:author="A"><w:r><w:t>New</w:t></w:r></w:ins></w:p>'
    );
    const original = await exportMarkdown(bytes, { displayMode: 'original' });
    const proposed = await exportMarkdown(bytes, { displayMode: 'proposed' });
    const markup = await exportMarkdown(bytes, { displayMode: 'all-markup' });
    expect(original.markdown).toBe('Old');
    expect(proposed.markdown).toBe('New');
    expect(markup.markdown).toBe('~~Old~~New');
  });

  test('applies the requested revision projection to note stories as well as the body', async () => {
    const notePart =
      `<w:footnotes xmlns:w="${W}">` +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>' +
      '<w:del w:id="1" w:author="A"><w:r><w:delText>Old note</w:delText></w:r></w:del>' +
      '<w:ins w:id="2" w:author="A"><w:r><w:t>New note</w:t></w:r></w:ins>' +
      '</w:p></w:footnote></w:footnotes>';
    const bytes = docx(
      '<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p><w:sectPr/>',
      undefined,
      {
        contentTypes:
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
        documentRelationships: `<Relationship Id="rFn" Type="${R}/footnotes" Target="footnotes.xml"/>`,
        entries: { 'word/footnotes.xml': strToU8(notePart) },
      }
    );

    expect((await exportMarkdown(bytes, { displayMode: 'original' })).markdown).toContain(
      '[^1]: Old note'
    );
    expect((await exportMarkdown(bytes, { displayMode: 'proposed' })).markdown).toContain(
      '[^1]: New note'
    );
    const markupNote = (await exportMarkdown(bytes, { displayMode: 'all-markup' })).markdown;
    expect(markupNote).toContain('[^1]: ~~Old~~ ~~note~~New note');
  });

  test('waits for image quiescence, bounds a stalled decoder, and returns defensive media copies', async () => {
    const controller = new AbortController();
    let cancelledDecodeLifetime: AbortSignal | undefined;
    let markDecodeStarted!: () => void;
    const decodeStarted = new Promise<void>((resolve) => {
      markDecodeStarted = resolve;
    });
    const cancelled = openDocumentForExport(imageDocx(), {
      signal: controller.signal,
      imageDecodePort: {
        decode: (_bytes, _mime, _limits, signal) => {
          cancelledDecodeLifetime = signal;
          markDecodeStarted();
          return new Promise(() => {});
        },
      },
      resourceTimeoutMs: 500,
    });
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      const pending = cancelled.session.layout();
      await decodeStarted;
      controller.abort('job-cancelled');
      await expect(pending).rejects.toMatchObject({ code: 'aborted' });
      expect(cancelledDecodeLifetime?.aborted).toBe(true);
      await expect(cancelled.session.layout()).rejects.toMatchObject({ code: 'aborted' });
      cancelled.session.dispose();
    }

    let decodeLifetime: AbortSignal | undefined;
    const stalled = openDocumentForExport(imageDocx(), {
      imageDecodePort: {
        decode: (_bytes, _mime, _limits, signal) => {
          decodeLifetime = signal;
          return new Promise(() => {});
        },
      },
      resourceTimeoutMs: 10,
    });
    expect(stalled.ok).toBe(true);
    if (stalled.ok) {
      await expect(stalled.session.layout()).rejects.toMatchObject({ code: 'timedOut' });
      expect(decodeLifetime?.aborted).toBe(false);
      stalled.session.dispose();
      expect(decodeLifetime?.aborted).toBe(true);
    }

    const opened = openDocumentForExport(imageDocx());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      const layout = await opened.session.layout();
      const paragraph = layout.pages[0]?.fragments[0];
      expect(paragraph?.kind).toBe('paragraph');
      if (paragraph?.kind !== 'paragraph') return;
      const drawing = paragraph.lines.flatMap((line) => line.drawings ?? [])[0]!;
      const first = opened.session.validatedImageBytes(drawing)!;
      first[0] = 0;
      const second = opened.session.validatedImageBytes(drawing)!;
      expect(second[0]).toBe(0x89);
      const rendered = await exportMarkdownFrom(opened.session, {
        image: () => ({ url: 'https://cdn.example/image\\folder (1).png' }),
      });
      expect(rendered.markdown).toContain(
        '![Diagram](https://cdn.example/image%5Cfolder%20%281%29.png)'
      );
      expect(
        micromark(rendered.markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] })
      ).toContain('<img src="https://cdn.example/image%5Cfolder%20%281%29.png" alt="Diagram" />');
    } finally {
      opened.session.dispose();
    }
  });

  test('restarts a pending image pass when a live view advances to an image-free revision', async () => {
    const first = openHeadlessDocument(imageDocx());
    const updated = openHeadlessDocument(docx('<w:p><w:r><w:t>Fresh revision</w:t></w:r></w:p>'));
    expect(first.ok).toBe(true);
    expect(updated.ok).toBe(true);
    if (!first.ok || !updated.ok) return;

    let activeView = first.view;
    let revision = 0;
    const live: HeadlessDocumentView = {
      part: () => activeView.part(),
      currentPackage: () => activeView.currentPackage(),
      packageRevision: () => revision,
      stylesRoot: () => activeView.stylesRoot(),
      numberingRoot: () => activeView.numberingRoot(),
      settingsRoot: () => activeView.settingsRoot(),
      documentThemeFonts: () => activeView.documentThemeFonts(),
      documentProperties: () => activeView.documentProperties(),
      headerFooterPartsBySection: () => activeView.headerFooterPartsBySection(),
      relationshipTarget: (relationshipId) => activeView.relationshipTarget(relationshipId),
    };
    let markDecodeStarted!: () => void;
    const decodeStarted = new Promise<void>((resolve) => {
      markDecodeStarted = resolve;
    });
    const opened = openDocumentForExport(live, {
      imageDecodePort: {
        decode: () => {
          markDecodeStarted();
          return new Promise(() => {});
        },
      },
      resourceTimeoutMs: 500,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      const pending = exportMarkdownFrom(opened.session);
      await decodeStarted;
      activeView = updated.view;
      revision += 1;
      await expect(pending).resolves.toMatchObject({ markdown: 'Fresh revision' });
      expect((await opened.session.layout()).revision).toBe(1);
    } finally {
      opened.session.dispose();
    }
  });

  test('coalesces more than 64 staggered image settlements before relayout', async () => {
    let decoded = 0;
    const opened = openDocumentForExport(manyImageDocx(65), {
      imageDecodePort: {
        decode: async () => {
          const delay = decoded;
          decoded += 1;
          await new Promise((resolve) => setTimeout(resolve, delay * 2));
          return { pixelWidth: 2, pixelHeight: 3, dpiX: 96, dpiY: 96 };
        },
      },
      resourceTimeoutMs: 5_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      await expect(opened.session.layout()).resolves.toMatchObject({ pages: expect.any(Array) });
      expect(decoded).toBe(65);
    } finally {
      opened.session.dispose();
    }
  });

  test('maps each drawing once across logical and page projections', async () => {
    const opened = openDocumentForExport(imageDocx());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      let calls = 0;
      const rendered = await exportMarkdownFrom(opened.session, {
        image: () => {
          calls += 1;
          return { url: 'https://cdn.example/image.png' };
        },
      });
      expect(rendered.markdown).toContain('image.png');
      expect(rendered.pages[0]?.markdown).toContain('image.png');
      expect(calls).toBe(1);
      await expect(
        exportMarkdownFrom(opened.session, {
          image: (() => Promise.resolve({ url: 'late.png' })) as never,
        })
      ).rejects.toThrow('must return synchronously');
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        await expect(
          exportMarkdownFrom(opened.session, {
            image: (async () => {
              throw new Error('upload failed');
            }) as never,
          })
        ).rejects.toThrow('must return synchronously');
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
      await expect(
        exportMarkdownFrom(opened.session, { image: (() => undefined) as never })
      ).rejects.toThrow('must return { url: string } or { skip: true }');
    } finally {
      opened.session.dispose();
    }
  });

  test('keeps same-view image capabilities and disposal independent between sessions', async () => {
    const prepared = openHeadlessDocument(imageDocx());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const decodePort = {
      decode: async () => ({ pixelWidth: 2, pixelHeight: 3, dpiX: 96, dpiY: 96 }),
    };
    const first = openDocumentForExport(prepared.view, { imageDecodePort: decodePort });
    const second = openDocumentForExport(prepared.view, { imageDecodePort: decodePort });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    await first.session.layout();
    await second.session.layout();
    let firstDrawing: Parameters<typeof first.session.validatedImageBytes>[0] | undefined;
    let secondDrawing: Parameters<typeof second.session.validatedImageBytes>[0] | undefined;
    await exportMarkdownFrom(first.session, {
      image: (drawing) => {
        firstDrawing = drawing;
        return { url: 'first.png' };
      },
    });
    await exportMarkdownFrom(second.session, {
      image: (drawing) => {
        secondDrawing = drawing;
        return { url: 'second.png' };
      },
    });
    expect(firstDrawing).toBeDefined();
    expect(secondDrawing).toBeDefined();
    if (!firstDrawing || !secondDrawing) return;
    expect(first.session.validatedImageBytes(firstDrawing)).toEqual(png());
    expect(second.session.validatedImageBytes(secondDrawing)).toEqual(png());
    expect(first.session.validatedImageBytes(secondDrawing)).toBeNull();
    expect(second.session.validatedImageBytes(firstDrawing)).toBeNull();

    first.session.dispose();
    expect(first.session.validatedImageBytes(firstDrawing)).toBeNull();
    expect(second.session.validatedImageBytes(secondDrawing)).toEqual(png());
    await expect(second.session.layout()).resolves.toMatchObject({ pages: expect.any(Array) });
    await expect(first.session.layout()).rejects.toMatchObject({ code: 'disposed' });
    second.session.dispose();
    expect(second.session.validatedImageBytes(secondDrawing)).toBeNull();
  });

  test('keeps nested lists and renders nested tables as inline HTML inside outer GFM cells', async () => {
    const numbering =
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
      '<w:lvl w:ilvl="0"><w:start w:val="10"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>' +
      '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>' +
      '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
    const item = (level: number, text: string) =>
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const nested =
      '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const outer =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>' +
      nested +
      '</w:tc></w:tr></w:tbl>';
    const result = await exportMarkdown(docx(item(0, 'ten') + item(1, 'child') + outer, numbering));
    expect(result.markdown).toContain('10. ten\n\n    - child');
    expect(result.markdown).toContain('<span class="docx-nested-table" role="table">');
    expect(result.markdown).not.toContain('\\| inner \\|');
    const html = micromark(result.markdown, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
      allowDangerousHtml: true,
    });
    expect(html).toContain('<ol start="10">');
    expect(html).toContain('<li>\n<p>ten</p>\n<ul>');
    expect(html).toContain('<span class="docx-nested-table" role="table">');
    expect(html).toContain('<span class="docx-nested-table__cell" role="cell">inner</span>');
    expect(html).not.toContain('<pre>');
  });
});
