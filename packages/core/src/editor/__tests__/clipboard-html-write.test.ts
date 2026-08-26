// Interop HTML from a clipboard fragment package (rich-clipboard-fidelity task 3.2).
//
// Each test zips a hand-written miniature WordprocessingML package — the same entry
// shapes `clipboard-fragment-extract.ts` produces — and asserts on the emitted string.
// Pure strings end to end: no DOM on either side.

import { describe, expect, test } from 'bun:test';
import { writeZip, strToU8 } from '../../store/package/zip.ts';
import { interopHtmlFromFragment } from '../clipboard-html-write.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

interface FragmentInput {
  readonly body: string;
  readonly styles?: string;
  readonly numbering?: string;
  /** Extra `<Relationship .../>` rows for word/_rels/document.xml.rels. */
  readonly docRels?: string;
  /** Media entries by zip name, e.g. `word/media/image1.png`. */
  readonly media?: Readonly<Record<string, Uint8Array>>;
}

function fragment(input: FragmentInput): Uint8Array {
  const entries = new Map<string, Uint8Array>();
  const overrides = [
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  ];
  let docRels = input.docRels ?? '';
  if (input.styles !== undefined) {
    entries.set('word/styles.xml', strToU8(`<w:styles xmlns:w="${W}">${input.styles}</w:styles>`));
    overrides.push(
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    );
    docRels += `<Relationship Id="rId9001" Type="${R}/styles" Target="styles.xml"/>`;
  }
  if (input.numbering !== undefined) {
    entries.set(
      'word/numbering.xml',
      strToU8(`<w:numbering xmlns:w="${W}">${input.numbering}</w:numbering>`)
    );
    overrides.push(
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    );
    docRels += `<Relationship Id="rId9002" Type="${R}/numbering" Target="numbering.xml"/>`;
  }
  for (const [name, bytes] of Object.entries(input.media ?? {})) entries.set(name, bytes);

  entries.set(
    '[Content_Types].xml',
    strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        overrides.join('') +
        '</Types>'
    )
  );
  entries.set(
    '_rels/.rels',
    strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    )
  );
  entries.set(
    'word/_rels/document.xml.rels',
    strToU8(`<Relationships xmlns="${REL}">${docRels}</Relationships>`)
  );
  entries.set(
    'word/document.xml',
    strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}">` +
        `<w:body>${input.body}</w:body></w:document>`
    )
  );
  return writeZip(entries);
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('interopHtmlFromFragment', () => {
  test('unreadable bytes produce the empty string', () => {
    expect(interopHtmlFromFragment(new Uint8Array([1, 2, 3, 4]))).toBe('');
  });

  test('a formatted run carries its resolved inline CSS', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p><w:r><w:rPr>' +
          '<w:rFonts w:ascii="Courier New"/><w:b/><w:i/>' +
          '<w:color w:val="FF0000"/><w:sz w:val="28"/><w:u w:val="single"/>' +
          '</w:rPr><w:t>styled</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('font-weight:bold');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('color:#ff0000');
    expect(html).toContain('font-size:14pt');
    expect(html).toContain("font-family:'Courier New'");
    expect(html).toContain('text-decoration:underline');
    expect(html).toContain('>styled<');
  });

  test('a style chain reaching Heading2 emits an h2 with the cascaded CSS', () => {
    const html = interopHtmlFromFragment(
      fragment({
        styles:
          '<w:style w:type="paragraph" w:styleId="Heading2">' +
          '<w:name w:val="heading 2"/><w:pPr><w:spacing w:before="240"/><w:jc w:val="center"/></w:pPr>' +
          '</w:style>' +
          '<w:style w:type="paragraph" w:styleId="Fancy"><w:basedOn w:val="Heading2"/></w:style>',
        body: '<w:p><w:pPr><w:pStyle w:val="Fancy"/></w:pPr>' + '<w:r><w:t>Title</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('<h2');
    expect(html).toContain('</h2>');
    expect(html).toContain('margin-top:12pt');
    expect(html).toContain('text-align:center');
  });

  test('numbered and bulleted levels nest as ol/ul with list-style-type', () => {
    const item = (ilvl: number, text: string): string =>
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="5"/></w:numPr></w:pPr>` +
      `<w:r><w:t>${text}</w:t></w:r></w:p>`;
    const html = interopHtmlFromFragment(
      fragment({
        numbering:
          '<w:abstractNum w:abstractNumId="0">' +
          '<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>' +
          '<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl>' +
          '</w:abstractNum>' +
          '<w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>',
        body:
          item(0, 'one') +
          item(1, 'sub') +
          item(0, 'two') +
          '<w:p><w:r><w:t>after</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('<ol style="list-style-type:decimal">');
    expect(count(html, '<li')).toBe(3);
    // The bulleted level nests inside the ordered list and closes before "two".
    const ulOpen = html.indexOf('<ul>');
    const ulClose = html.indexOf('</ul>');
    expect(ulOpen).toBeGreaterThan(html.indexOf('one'));
    expect(ulOpen).toBeLessThan(html.indexOf('sub'));
    expect(ulClose).toBeGreaterThan(html.indexOf('sub'));
    expect(ulClose).toBeLessThan(html.indexOf('two'));
    // Lists close before the trailing plain paragraph.
    expect(html.indexOf('</ol>')).toBeLessThan(html.indexOf('after'));
    expect(html).toContain('<p>after</p>');
  });

  test('a table emits colspan, rowspan, shading, and swallows vMerge continuations', () => {
    const cell = (props: string, text: string): string =>
      `<w:tc><w:tcPr>${props}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:tbl>' +
          `<w:tr>${cell('<w:gridSpan w:val="2"/>', 'head')}</w:tr>` +
          `<w:tr>${cell('<w:vMerge w:val="restart"/><w:shd w:val="clear" w:fill="DDEEFF"/>', 'merged')}${cell('<w:vAlign w:val="center"/>', 'b1')}</w:tr>` +
          `<w:tr>${cell('<w:vMerge/>', '')}${cell('<w:tcW w:w="2400" w:type="dxa"/>', 'b2')}</w:tr>` +
          '</w:tbl>',
      })
    );
    expect(html).toContain('<table style="border-collapse:collapse">');
    expect(html).toContain('colspan="2"');
    expect(html).toContain('rowspan="2"');
    expect(html).toContain('background-color:#ddeeff');
    expect(html).toContain('vertical-align:middle');
    expect(html).toContain('width:120pt');
    // The continuation cell is spanned, not emitted: 1 + 2 + 1 cells.
    expect(count(html, '<td')).toBe(4);
    expect(count(html, 'merged')).toBe(1);
  });

  test('table borders resolve from tblBorders onto every cell', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:tbl><w:tblPr><w:tblBorders>' +
          '<w:top w:val="single" w:color="112233"/><w:left w:val="single"/>' +
          '<w:bottom w:val="none"/><w:right w:val="single" w:color="auto"/>' +
          '</w:tblBorders></w:tblPr>' +
          '<w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr>' +
          '</w:tbl>',
      })
    );
    expect(html).toContain('border-top:1pt solid #112233');
    expect(html).toContain('border-left:1pt solid #000000');
    expect(html).toContain('border-right:1pt solid #000000');
    expect(html).not.toContain('border-bottom');
  });

  test('hyperlinks sanitize their targets; a refused scheme keeps the text only', () => {
    const html = interopHtmlFromFragment(
      fragment({
        docRels:
          `<Relationship Id="rId5" Type="${R}/hyperlink" Target="https://example.com/x" TargetMode="External"/>` +
          `<Relationship Id="rId6" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>`,
        body:
          '<w:p>' +
          '<w:hyperlink r:id="rId5"><w:r><w:t>good</w:t></w:r></w:hyperlink>' +
          '<w:hyperlink r:id="rId6"><w:r><w:t>bad</w:t></w:r></w:hyperlink>' +
          '<w:hyperlink w:anchor="_Ref1"><w:r><w:t>internal</w:t></w:r></w:hyperlink>' +
          '</w:p>',
      })
    );
    expect(html).toContain('<a href="https://example.com/x">good</a>');
    expect(html).toContain('bad');
    expect(html).toContain('internal');
    expect(html).not.toContain('javascript:');
    expect(count(html, '<a ')).toBe(1);
  });

  test('an in-budget image inlines as a data: URI with px dimensions', () => {
    const bytes = strToU8('hello world!');
    const html = interopHtmlFromFragment(
      fragment({
        docRels: `<Relationship Id="rId7" Type="${R}/image" Target="media/image1.png"/>`,
        media: { 'word/media/image1.png': bytes },
        body:
          '<w:p><w:r><w:drawing><wp:inline>' +
          '<wp:extent cx="952500" cy="476250"/>' +
          `<a:graphic><a:graphicData uri="${PIC}">` +
          '<pic:pic><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic>' +
          '</a:graphicData></a:graphic>' +
          '</wp:inline></w:drawing></w:r></w:p>',
      })
    );
    expect(html).toContain('<img src="data:image/png;base64,aGVsbG8gd29ybGQh"');
    expect(html).toContain('width="100" height="50"');
  });

  test('an image over either budget is omitted', () => {
    const bytes = strToU8('hello world!');
    const input = fragment({
      docRels: `<Relationship Id="rId7" Type="${R}/image" Target="media/image1.png"/>`,
      media: { 'word/media/image1.png': bytes },
      body:
        '<w:p><w:r><w:drawing><wp:inline>' +
        '<wp:extent cx="952500" cy="476250"/>' +
        `<a:graphic><a:graphicData uri="${PIC}">` +
        '<pic:pic><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic>' +
        '</a:graphicData></a:graphic>' +
        '</wp:inline></w:drawing></w:r></w:p>',
    });
    expect(interopHtmlFromFragment(input, { maxImageBytes: 4 })).not.toContain('<img');
    expect(interopHtmlFromFragment(input, { maxTotalImageBytes: 4 })).not.toContain('<img');
    expect(interopHtmlFromFragment(input)).toContain('<img');
  });

  test('hidden runs, deletions, and field machinery never reach the HTML', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body:
          '<w:p>' +
          '<w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r>' +
          '<w:del w:id="1" w:author="a"><w:r><w:delText>gone</w:delText></w:r></w:del>' +
          '<w:ins w:id="2" w:author="a"><w:r><w:t>kept</w:t></w:r></w:ins>' +
          '<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>' +
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          '<w:r><w:instrText> DATE </w:instrText></w:r>' +
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          '<w:r><w:t>2026</w:t></w:r>' +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
          '</w:p>',
      })
    );
    expect(html).not.toContain('hidden');
    expect(html).not.toContain('gone');
    expect(html).toContain('kept');
    expect(html).toContain('7');
    expect(html).toContain('2026');
    expect(html).not.toContain('DATE');
  });

  test('tabs and breaks map to pre-space spans and br', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body: '<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('<span style="white-space:pre">\t</span>');
    expect(html).toContain('<br>');
  });

  test('every text value is escaped, never markup', () => {
    const html = interopHtmlFromFragment(
      fragment({
        body: '<w:p><w:r><w:t>&lt;script&gt;alert("x")&lt;/script&gt;</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script');
  });

  test('docDefaults and the default paragraph style cascade under direct formatting', () => {
    const html = interopHtmlFromFragment(
      fragment({
        styles:
          '<w:docDefaults><w:rPrDefault><w:rPr>' +
          '<w:rFonts w:ascii="Arial"/><w:sz w:val="22"/>' +
          '</w:rPr></w:rPrDefault></w:docDefaults>' +
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
          '<w:name w:val="Normal"/><w:rPr><w:color w:val="222222"/></w:rPr>' +
          '</w:style>',
        body:
          '<w:p><w:r><w:t>plain</w:t></w:r></w:p>' +
          '<w:p><w:r><w:rPr><w:sz w:val="40"/></w:rPr><w:t>big</w:t></w:r></w:p>',
      })
    );
    // The unstyled run resolves through docDefaults and the default style.
    expect(html).toContain('font-family:Arial');
    expect(html).toContain('font-size:11pt');
    expect(html).toContain('color:#222222');
    // Direct formatting wins over both.
    expect(html).toContain('font-size:20pt');
  });

  test('highlight wins over shading and toggles honour explicit off values', () => {
    const html = interopHtmlFromFragment(
      fragment({
        styles: '<w:style w:type="character" w:styleId="Loud"><w:rPr><w:b/></w:rPr></w:style>',
        body:
          '<w:p><w:r><w:rPr>' +
          '<w:rStyle w:val="Loud"/><w:b w:val="0"/>' +
          '<w:highlight w:val="yellow"/><w:shd w:val="clear" w:fill="00FF00"/>' +
          '<w:vertAlign w:val="superscript"/>' +
          '</w:rPr><w:t>note</w:t></w:r></w:p>',
      })
    );
    expect(html).toContain('background-color:yellow');
    expect(html).not.toContain('background-color:#00ff00');
    expect(html).not.toContain('font-weight:bold');
    expect(html).toContain('<sup>note</sup>');
  });
});
