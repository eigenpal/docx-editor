// Build the paragraph acceptance fixture (task 8.2).
//
// Covers, deliberately and in one document:
//   - every accepted D8 RUN property and every accepted D8 PARAGRAPH property;
//   - inline text, authored whitespace that must survive verbatim, tabs and hard breaks;
//   - UNKNOWN ordered OOXML interleaved with known content — at paragraph level, inside a
//     run, and nested inside a known `w:rPr` — so preservation is exercised in every
//     position a generic node can occupy;
//   - enough body text that a single paragraph crosses a page boundary.
//
// Regenerate with: node scripts/make-acceptance-fixture.mjs

import { writeFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const run = (rPr, inner) => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${inner}</w:r>`;
const text = (value) => `<w:t xml:space="preserve">${value}</w:t>`;
const para = (pPr, inner) => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;

/** Every accepted run property, one per labelled run. */
const RUN_PROPERTIES = [
  ['rFonts', '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>'],
  ['sz', '<w:sz w:val="28"/>'],
  ['szCs', '<w:szCs w:val="28"/>'],
  ['color', '<w:color w:val="C00000"/>'],
  ['b', '<w:b/>'],
  ['bCs', '<w:bCs/>'],
  ['i', '<w:i/>'],
  ['iCs', '<w:iCs/>'],
  ['u', '<w:u w:val="double" w:color="0070C0"/>'],
  ['strike', '<w:strike/>'],
  ['dstrike', '<w:dstrike/>'],
  ['highlight', '<w:highlight w:val="yellow"/>'],
  ['vertAlign', '<w:vertAlign w:val="superscript"/>'],
  ['position', '<w:position w:val="6"/>'],
  ['caps', '<w:caps/>'],
  ['smallCaps', '<w:smallCaps/>'],
  ['spacing', '<w:spacing w:val="20"/>'],
  ['w', '<w:w w:val="150"/>'],
  ['kern', '<w:kern w:val="16"/>'],
];

/** Every accepted paragraph property, one per labelled paragraph. */
const PARAGRAPH_PROPERTIES = [
  ['pStyle', '<w:pStyle w:val="Heading1"/>'],
  ['jc', '<w:jc w:val="center"/>'],
  ['spacing', '<w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto"/>'],
  ['ind', '<w:ind w:left="720" w:right="360" w:firstLine="360"/>'],
  ['tabs', '<w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs>'],
  ['numPr', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'],
  ['keepNext', '<w:keepNext/>'],
  ['keepLines', '<w:keepLines/>'],
  ['widowControl', '<w:widowControl/>'],
  ['pageBreakBefore', '<w:pageBreakBefore/>'],
  ['contextualSpacing', '<w:contextualSpacing/>'],
  ['shd', '<w:shd w:val="clear" w:fill="F2F2F2"/>'],
];

const UNKNOWN_DRAWING =
  '<w:drawing><wp:inline xmlns:wp="urn:test:wp"><wp:extent cx="914400" cy="914400"/>' +
  '<a:graphic xmlns:a="urn:test:a"><a:graphicData uri="urn:test:clip"/></a:graphic>' +
  '</wp:inline></w:drawing>';

const body = [
  // Inline text, authored whitespace that must survive verbatim, tab and hard break.
  para(
    '',
    run('', text('  leading and trailing spaces  ')) +
      run('', `${text('before tab')}<w:tab/>${text('after tab')}`) +
      run('', `${text('before break')}<w:br/>${text('after break')}`)
  ),

  // Every accepted RUN property, each on its own labelled run.
  para(
    '',
    RUN_PROPERTIES.map(([name, rPr]) => run(rPr, text(`${name} `))).join('')
  ),

  // Every accepted PARAGRAPH property, each on its own paragraph.
  ...PARAGRAPH_PROPERTIES.map(([name, pPr]) => para(pPr, run('', text(`paragraph property ${name}`)))),

  // UNKNOWN ordered OOXML in every position it can occupy.
  para(
    '',
    run('', text('text before the drawing ')) +
      run('', UNKNOWN_DRAWING) +
      run(
        '<w:b/><ext:futureRunProp xmlns:ext="urn:test:ext" val="keep-me"/>',
        text(' text after, with an unknown run property')
      ) +
      '<ext:futureParagraphChild xmlns:ext="urn:test:ext">tail</ext:futureParagraphChild>'
  ),

  // MIXED FAMILIES AND MIXED SIZES ON ONE LINE.
  //
  // The case that exposes every disagreement between measurement and painting at once: a
  // line is only as tall as its tallest run, runs of different faces have different
  // ascents, and the browser draws the selection band per run. If line height, advance or
  // baseline is off anywhere, this is where it shows.
  para('<w:pStyle w:val="Heading2"/>', run('<w:b/><w:sz w:val="28"/>', text('1.3 Font Variations'))),
  para(
    '',
    [
      ['Arial', 'Arial'],
      ['Times New Roman', 'Times New Roman'],
      ['Courier New', 'Courier New'],
      ['Georgia', 'Georgia'],
      ['Verdana', 'Verdana'],
    ]
      .map(([family, label], index) =>
        (index > 0 ? run('', text(' | ')) : '') +
        run(`<w:rFonts w:ascii="${family}" w:hAnsi="${family}"/>`, text(label))
      )
      .join('')
  ),
  ...[0, 1].map(() =>
    para(
      '',
      [8, 11, 14, 18, 24, 36]
        .map((points, index) =>
          (index > 0 ? run('', text(' | ')) : '') +
          run(`<w:sz w:val="${points * 2}"/>`, text(`${points}pt`))
        )
        .join('')
    )
  ),

  // Long enough that one paragraph crosses a page boundary.
  para(
    '',
    run(
      '',
      text(
        Array.from({ length: 1200 }, (_, index) => `word${index}`).join(' ')
      )
    )
  ),
].join('');

const bytes = zipSync({
  '[Content_Types].xml': strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/>` +
      '</Relationships>'
  ),
  'word/document.xml': strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
  ),
});

// BOTH copies, always. The harness serves the one under `public/`, and a hand-made copy
// silently drifted from the generated one — the demo kept rendering a fixture the tests had
// already moved past.
const outputs = [
  new URL('../e2e/fixtures/paragraph-acceptance.docx', import.meta.url),
  new URL('../examples/vite/public/paragraph-acceptance.docx', import.meta.url),
];
for (const out of outputs) writeFileSync(out, bytes);
console.log(
  `wrote ${outputs.length} copies (${bytes.length} bytes, ` +
    `${RUN_PROPERTIES.length} run properties, ${PARAGRAPH_PROPERTIES.length} paragraph properties)`
);
