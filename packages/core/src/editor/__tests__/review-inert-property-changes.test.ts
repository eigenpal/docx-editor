import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import {
  collectReviewItems,
  findNode,
  revisionItemsOf,
  serializeOoxmlPart,
} from '../../store/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STAMP = 'w:author="Ada" w:date="2026-03-01T10:00:00Z"';
const STYLES = `<w:styles xmlns:w="${W}">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Indented"><w:name w:val="Indented"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Strong"><w:name w:val="Strong"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>
</w:styles>`;
const NUMBERING = `<w:numbering xmlns:w="${W}">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="1440" w:hanging="720"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

function docx(body: string): Uint8Array {
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const parts: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1', 'officeDocument', 'word/document.xml')}</Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1', 'styles', 'styles.xml')}${rel('rId2', 'numbering', 'numbering.xml')}</Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    'word/styles.xml': STYLES,
    'word/numbering.xml': NUMBERING,
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])));
}

function mount(body: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    author: 'Ada',
    document: docx(body),
    modules: [
      {
        id: 'review',
        review: {
          displayModes: ['all-markup', 'proposed', 'original'],
          collectReviewItems,
          revisionItemsOfParagraph: (part, id) => {
            const paragraph = findNode(part, id);
            return paragraph?.kind === 'paragraph'
              ? revisionItemsOf({ ...part, root: paragraph })
              : [];
          },
        },
      },
    ],
  });
  return {
    editor,
    count: () => editor.getReviewItems({ pairReplacements: false, placement: false }).length,
    xml: () => serializeOoxmlPart(editor.surface!.session.part()),
    [Symbol.dispose]: () => {
      editor.destroy();
      container.remove();
    },
  };
}

let id = 1;
const ppr = (current: string, previous: string) =>
  `<w:pPr>${current}<w:pPrChange w:id="${id++}" ${STAMP}><w:pPr>${previous}</w:pPr></w:pPrChange></w:pPr>`;
const rpr = (current: string, previous: string, text = 'text') =>
  `<w:r><w:rPr>${current}<w:rPrChange w:id="${id++}" ${STAMP}><w:rPr>${previous}</w:rPr></w:rPrChange></w:rPr><w:t>${text}</w:t></w:r>`;
const p = (properties: string, runs = '<w:r><w:t>text</w:t></w:r>') =>
  `<w:p>${properties}${runs}</w:p>`;
const style = (name: string) => `<w:pStyle w:val="${name}"/>`;
const list = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';

describe('property changes that change nothing', () => {
  for (const [name, body, listed] of [
    [
      'indent the style already sets',
      p(ppr(style('Indented') + '<w:ind w:left="720"/>', style('Indented'))),
      0,
    ],
    [
      'indent the style sets, removed',
      p(ppr(style('Indented'), style('Indented') + '<w:ind w:left="720"/>')),
      0,
    ],
    ['default alignment written out', p(ppr('<w:jc w:val="left"/>', '')), 0],
    [
      'indent the list level sets',
      p(ppr(list + '<w:ind w:left="1440" w:hanging="720"/>', list)),
      0,
    ],
    ['bold turned off where nothing set it', p('', rpr('<w:b w:val="0"/>', '')), 0],
    [
      'bold the paragraph style already sets',
      p(`<w:pPr>${style('Strong')}</w:pPr>`, rpr('<w:b/>', '')),
      0,
    ],
    ['a real indent', p(ppr(style('Indented') + '<w:ind w:left="1440"/>', style('Indented'))), 1],
    ['a list indent that differs', p(ppr(list + '<w:ind w:left="720" w:hanging="720"/>', list)), 1],
    ['a no-op beside a real change', p(ppr('<w:jc w:val="left"/><w:keepNext/>', '')), 1],
    [
      'bold turned off against a bold style',
      p(`<w:pPr>${style('Strong')}</w:pPr>`, rpr('<w:b w:val="0"/>', '')),
      1,
    ],
    ['a style change', p(ppr(style('Indented'), '<w:ind w:left="720"/>')), 1],
    [
      'different tab stops',
      p(
        ppr(
          '<w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>',
          '<w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs>'
        )
      ),
      1,
    ],
    [
      'a no-op inside a table',
      `<w:tbl><w:tr><w:tc>${p(ppr('<w:jc w:val="left"/>', ''))}</w:tc></w:tr></w:tbl>`,
      1,
    ],
  ] as const) {
    test(`${name}: ${listed === 0 ? 'not listed' : 'listed'}`, () => {
      using view = mount(body);
      expect(view.count()).toBe(listed);
    });
  }

  for (const action of ['accept', 'reject'] as const) {
    test(`${action} all clears an unlisted record with the listed ones`, () => {
      using view = mount(p(ppr('<w:jc w:val="left"/>', '')) + p(ppr('<w:jc w:val="center"/>', '')));
      expect(view.count()).toBe(1);
      const result = view.editor.exec({ type: 'resolveAllReviewChanges', action });
      expect(result.ok).toBe(true);
      expect(view.count()).toBe(0);
      expect(view.xml()).not.toContain('pPrChange');
    });
  }

  test('typing in the paragraph keeps the record unlisted', () => {
    using view = mount(p(ppr('<w:jc w:val="left"/>', '')) + p(ppr('<w:jc w:val="center"/>', '')));
    expect(view.count()).toBe(1);
    const paragraphId = view.editor.surface!.session.paragraphIds()[0]!;
    const at = { paragraphId, offset: 1 };
    view.editor.surface!.setSelection({ anchor: at, head: at });
    expect(view.editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    expect(view.editor.surface!.session.bodyText()).toContain('txext');
    expect(view.count()).toBe(1);
  });
});
