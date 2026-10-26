import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type JSZip from 'jszip';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const escape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const run = (text: string, properties = '') =>
  `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
const paragraph = (text: string, properties = '', before = 0) =>
  `<w:p><w:pPr>${properties}<w:spacing w:before="${before}" w:after="160"/></w:pPr>${run(text)}</w:p>`;

function heading(text: string, anchor: string, id: number, pageBreak = true): string {
  return `<w:p><w:pPr><w:pStyle w:val="Heading1"/>${pageBreak ? '<w:pageBreakBefore/>' : ''}</w:pPr><w:bookmarkStart w:id="${id}" w:name="${anchor}"/>${run(text)}<w:bookmarkEnd w:id="${id}"/></w:p>`;
}

function subheading(text: string): string {
  return paragraph(text, '<w:pStyle w:val="Heading2"/><w:keepNext/>');
}

function drawing(
  id: number,
  name: string,
  width: number,
  height: number,
  uri: string,
  content: string
): string {
  return `<w:p><w:pPr><w:spacing w:before="80" w:after="160"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="${escape(name)}" descr="${escape(name)}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="${A}"><a:graphicData uri="${uri}">${content}</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function smartArt(index: number): string {
  return `<dgm:relIds xmlns:dgm="${DGM}" r:dm="rIdDemoDiagramData${index}" r:lo="rIdDemoDiagramLayout${index}" r:qs="rIdDemoDiagramStyle${index}" r:cs="rIdDemoDiagramColors${index}"/>`;
}

function rtlRun(text: string, language: string, rtl = true): string {
  return run(
    text,
    `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:rtl w:val="${rtl ? 1 : 0}"/><w:lang w:val="${language}" w:bidi="${language}"/>`
  );
}

function rtlParagraph(runs: string): string {
  return `<w:p><w:pPr><w:bidi/><w:spacing w:after="180" w:line="320" w:lineRule="auto"/><w:jc w:val="right"/></w:pPr>${runs}</w:p>`;
}

function rtlTable(): string {
  const rows = [
    ['المرحلة', 'الحالة', 'العدد'],
    ['المسودة', 'جاهزة', '12'],
    ['المراجعة', 'قيد العمل', '9'],
  ];
  const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:color="D9D9D9"/>`)
    .join('');
  return `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="3120"/><w:gridCol w:w="3120"/><w:gridCol w:w="3120"/></w:tblGrid>${rows.map((row, i) => `<w:tr>${i === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${row.map((value) => `<w:tc><w:tcPr><w:tcW w:w="3120" w:type="dxa"/><w:shd w:val="clear" w:fill="${i === 0 ? 'DCE6F2' : i % 2 ? 'FFFFFF' : 'F5F8FA'}"/><w:vAlign w:val="center"/></w:tcPr>${rtlParagraph(rtlRun(value, 'ar-SA'))}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
}

function blocks(): string {
  return [
    heading('22. DrawingML diagrams and charts', '_TocDemoDrawingML', 910000),
    paragraph(
      'These examples show nested SmartArt, grouped tasks, combination charts, and doughnut charts.'
    ),
    subheading('22.1 Nested workflow'),
    paragraph('Nested containers place planning, writing, and checking tasks within one workflow.'),
    drawing(
      9100,
      'Nested workflow containing Plan Write and Ship tasks',
      5000000,
      2314000,
      DGM,
      smartArt(1)
    ),
    subheading('22.2 Grouped task list'),
    paragraph('Three columns group six tasks. Each group keeps its own color and text hierarchy.'),
    drawing(9120, 'Grouped tasks for Plan Write and Ship', 4400000, 2531000, DGM, smartArt(2)),
    paragraph('DrawingML charts', '<w:pStyle w:val="Heading2"/><w:pageBreakBefore/>'),
    subheading('22.3 Delivery and capacity'),
    paragraph('Paired columns compare planned and delivered work. The line shows capacity.'),
    drawing(
      9130,
      'Delivery and capacity: monthly planned and delivered work with a capacity line',
      5486400,
      2286000,
      CHART,
      `<c:chart xmlns:c="${CHART}" r:id="rIdDemoCombo"/>`
    ),
    subheading('22.4 Where effort goes'),
    paragraph('Four labeled shares show an example allocation of effort.'),
    drawing(
      9140,
      'Effort allocation: Build 42 percent, Research 26 percent, Review 20 percent, Support 12 percent',
      5486400,
      2286000,
      CHART,
      `<c:chart xmlns:c="${CHART}" r:id="rIdDemoDoughnut"/>`
    ),
    heading('23. Right to left text', '_TocDemoRTL', 910001),
    paragraph(
      'Arabic and Hebrew paragraphs use right-to-left direction. Latin names and numbers retain their reading order.'
    ),
    rtlParagraph(
      rtlRun('هذا مثال باللغة العربية. اسم المشروع: ', 'ar-SA') +
        rtlRun('DOCX Editor', 'en-US', false) +
        rtlRun(' — العدد ', 'ar-SA') +
        rtlRun('123', 'en-US', false)
    ),
    rtlParagraph(
      rtlRun('זוהי דוגמה בעברית. שם הפרויקט: ', 'he-IL') +
        rtlRun('DOCX Editor', 'en-US', false) +
        rtlRun(' — מספר ', 'he-IL') +
        rtlRun('123', 'en-US', false)
    ),
    rtlTable(),
    paragraph(
      'The first table column appears on the right. The header labels mean stage, status, and count.',
      '',
      120
    ),
    heading('24. Chinese Japanese and Korean text', '_TocDemoCJK', 910002, false),
    paragraph('These examples combine East Asian text, punctuation, Latin letters, and numbers.'),
    ...[
      [
        'Chinese',
        'zh-CN',
        'SimSun',
        '这是一份中文示例文档。您可以编辑文字、查看图表并保存更改。项目：DOCX Editor，编号：123。',
      ],
      [
        'Japanese',
        'ja-JP',
        'MS Gothic',
        'これは日本語のサンプル文書です。文章を編集し、図を確認して保存できます。プロジェクト：DOCX Editor、番号：123。',
      ],
      [
        'Korean',
        'ko-KR',
        'Malgun Gothic',
        '이 문서는 한국어 예제입니다. 텍스트를 편집하고 도표를 확인한 뒤 저장할 수 있습니다. 프로젝트: DOCX Editor, 번호: 123.',
      ],
    ].map(
      ([label, language, font, text]) =>
        `<w:p><w:pPr><w:spacing w:after="180" w:line="320" w:lineRule="auto"/></w:pPr>${run(`${label}: `, '<w:b/>')}${run(text, `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="${font}"/><w:sz w:val="22"/><w:lang w:val="en-US" w:eastAsia="${language}"/>`)}</w:p>`
    ),
  ].join('');
}

/** Adds only anonymous drawing parts; document metadata never enters the sample. */
export async function addShowcase(zip: JSZip, directory: string): Promise<void> {
  let document = await zip.file('word/document.xml')!.async('string');
  // The list examples span two pages before the tables section.
  document = document.replace(/<w:p>.*?<\/w:p>/g, (block) => {
    if (!block.includes('<w:pStyle w:val="TOC')) return block;
    return block.replace(/<w:t>(\d+)<\/w:t><\/w:r><\/w:hyperlink>/, (match, value: string) => {
      const page = Number(value);
      return page >= 8 && page <= 24
        ? match.replace(`<w:t>${page}</w:t>`, `<w:t>${page + 1}</w:t>`)
        : match;
    });
  });
  const summary = '22. Element Coverage Summary';
  const summaryAt = document.lastIndexOf(summary);
  const paragraphAt = document.lastIndexOf('<w:p>', summaryAt);
  if (summaryAt < 0 || paragraphAt < 0) throw new Error('Sample summary heading is missing');
  const summaryBlock = document
    .slice(paragraphAt)
    .replace('<w:pStyle w:val="Heading1"/>', '<w:pStyle w:val="Heading1"/><w:pageBreakBefore/>');
  document = document.slice(0, paragraphAt) + blocks() + summaryBlock;
  document = document
    .replaceAll(summary, '25. Element Coverage Summary')
    .replace(
      '52 element categories • 22 sections',
      'DrawingML • RTL text • CJK text • 25 sections'
    );
  const tocAt = document.indexOf('<w:hyperlink w:anchor=', document.indexOf('TOC \\h'));
  const summaryTocAt = document.indexOf('25. Element Coverage Summary', tocAt);
  const tocParagraphAt = document.lastIndexOf('<w:p>', summaryTocAt);
  const entries = [
    ['22. DrawingML diagrams and charts', '_TocDemoDrawingML', '26'],
    ['23. Right to left text', '_TocDemoRTL', '28'],
    ['24. Chinese Japanese and Korean text', '_TocDemoCJK', '28'],
  ]
    .map(
      ([label, anchor, page]) =>
        `<w:p><w:pPr><w:pStyle w:val="TOC1"/><w:tabs><w:tab w:val="right" w:pos="9350" w:leader="dot"/></w:tabs><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr><w:hyperlink w:anchor="${anchor}">${run(label)}<w:r><w:ptab w:alignment="right" w:relativeTo="margin" w:leader="dot"/></w:r>${run(page)}</w:hyperlink></w:p>`
    )
    .join('');
  document = document.slice(0, tocParagraphAt) + entries + document.slice(tocParagraphAt);
  document = document.replace(
    /(25\. Element Coverage Summary<\/w:t><\/w:r><w:r><w:ptab[^>]*\/><\/w:r><w:r><w:t>)25(<\/w:t>)/,
    '$129$2'
  );
  zip.file('word/document.xml', document);

  let relationships = await zip.file('word/_rels/document.xml.rels')!.async('string');
  relationships = relationships.replace(
    'Target="https://www.anthropic.com"',
    'Target="https://docx-editor.dev"'
  );
  let types = await zip.file('[Content_Types].xml')!.async('string');
  for (const index of [1, 2]) {
    const parts = [
      ['data', 'Data', 'diagramData', 'diagramData'],
      ['layout', 'Layout', 'diagramLayout', 'diagramLayout'],
      ['quickStyle', 'Style', 'diagramQuickStyle', 'diagramStyle'],
      ['colors', 'Colors', 'diagramColors', 'diagramColors'],
      [
        'drawing',
        'Drawing',
        'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',
        'diagramDrawing',
      ],
    ];
    for (const [kind, id, rel, type] of parts) {
      const file = `${kind}${index}.xml`;
      zip.file(`word/diagrams/${file}`, await readFile(join(directory, 'diagrams', file), 'utf8'));
      relationships = relationships.replace(
        '</Relationships>',
        `<Relationship Id="rIdDemoDiagram${id}${index}" Type="${rel.startsWith('http:') ? rel : `${REL}/${rel}`}" Target="diagrams/${file}"/></Relationships>`
      );
      const contentType =
        type === 'diagramDrawing'
          ? 'application/vnd.ms-office.drawingml.diagramDrawing+xml'
          : `application/vnd.openxmlformats-officedocument.drawingml.${type}+xml`;
      types = types.replace(
        '</Types>',
        `<Override PartName="/word/diagrams/${file}" ContentType="${contentType}"/></Types>`
      );
    }
  }
  for (const index of [1, 2]) {
    zip.file(
      `word/diagrams/_rels/data${index}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDemoDiagramDrawing${index}" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="drawing${index}.xml"/></Relationships>`
    );
  }
  for (const name of ['combo', 'doughnut']) {
    zip.file(`word/charts/${name}.xml`, await readFile(join(directory, 'charts', `${name}.xml`)));
    zip.file(
      `word/embeddings/${name}.xlsx`,
      await readFile(join(directory, 'charts', `${name}.xlsx`))
    );
    zip.file(
      `word/charts/_rels/${name}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdWorkbook" Type="${REL}/package" Target="../embeddings/${name}.xlsx"/></Relationships>`
    );
    types = types.replace(
      '</Types>',
      `<Override PartName="/word/embeddings/${name}.xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/></Types>`
    );
    const id = name === 'combo' ? 'Combo' : 'Doughnut';
    relationships = relationships.replace(
      '</Relationships>',
      `<Relationship Id="rIdDemo${id}" Type="${REL}/chart" Target="charts/${name}.xml"/></Relationships>`
    );
    types = types.replace(
      '</Types>',
      `<Override PartName="/word/charts/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`
    );
  }
  zip.file('word/_rels/document.xml.rels', relationships);
  zip.file('[Content_Types].xml', types);
}
