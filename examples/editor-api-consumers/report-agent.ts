/** Run: bun examples/editor-api-consumers/report-agent.ts
 * Public package imports only. XML creation supplies the input, never repairs output.
 */
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execute, plan, png } from './report-plan';
import {
  createLayoutShaping,
  createLayoutShapedMeasurer,
  createFixedMeasurer,
  disposeLayoutShaping,
  sha256FontBytes,
} from '@docx-editor.dev/core/layout';

const probe = process.argv.includes('--probe-batching');
const output = '/tmp/editor-api-consumers/report' + (probe ? '/batching-probe' : '');
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const inputParts = {
  '[Content_Types].xml': strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  ),
  'word/_rels/document.xml.rels': strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="sentinelImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/sentinel.png"/></Relationships>'
  ),
  'word/styles.xml': strToU8(
    `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="table" w:styleId="ReportGrid"><w:name w:val="Report Grid"/><w:tblPr><w:tblBorders><w:bottom w:val="single" w:sz="8" w:color="123456"/></w:tblBorders></w:tblPr></w:style></w:styles>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${w}"><w:body><w:p><w:bookmarkStart w:id="77" w:name="PreserveMe"/><w:r><w:t>ARCHIVE SENTINEL — keep intact</w:t></w:r><w:bookmarkEnd w:id="77"/></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`
  ),
  'word/media/sentinel.png': Uint8Array.from(Buffer.from(png, 'base64')),
  'customXml/report-sentinel.xml': strToU8('<archive keep="yes">report-v1</archive>'),
};

const evidence: unknown[] = [];
await mkdir(output, { recursive: true });
const fixture = zipSync(inputParts);
await writeFile(`${output}/input.docx`, fixture);
const sources = await Promise.all(
  ['Regular', 'Bold', 'Italic', 'BoldItalic'].map(async (variant) => {
    const bytes = new Uint8Array(await readFile(`packages/fonts/assets/Carlito-${variant}.ttf`));
    return {
      request: {
        family: 'Calibri',
        weight: variant.includes('Bold') ? 700 : 400,
        style: variant.includes('Italic') ? ('italic' as const) : ('normal' as const),
      },
      id: variant,
      bytes,
      hash: sha256FontBytes(bytes),
      faceIndex: 0,
    };
  })
);
const shaping = await createLayoutShaping({
  epoch: 1,
  maxFontBytes: 10000000,
  sources,
  defaultFont: { family: 'Calibri', sizeHalfPoints: 22 },
});
const measurer = createLayoutShapedMeasurer(shaping, {
  fallback: createFixedMeasurer(),
  resolveFont(style) {
    const face = shaping.fonts.resolve({
      family: style.fontFamily ?? 'Calibri',
      weight: style.bold ? 700 : 400,
      style: style.italic ? 'italic' : 'normal',
    });
    if ('code' in face) throw new Error(`Missing measured font: ${style.fontFamily}`);
    return face;
  },
});
const runtime = await DocxEditor.createServer(fixture, {
  author: 'Report agent',
  pagination: { measurer },
});
try {
  for (const [index, action] of plan.entries()) {
    if (probe && action.kind === 'page-furniture') continue;
    try {
      await runtime.run((context) => execute(context, action, evidence, probe));
      evidence.push({ index, kind: action.kind, status: 'passed' });
    } catch (error) {
      evidence.push({
        index,
        kind: action.kind,
        status: 'failed',
        error: String(error),
        code: (error as { code?: string }).code,
        stack: (error as Error).stack,
      });
    }
  }
  await writeFile(`${output}/report.docx`, await runtime.save());
} finally {
  runtime.dispose();
  disposeLayoutShaping(shaping);
}
await writeFile(`${output}/action-evidence.json`, JSON.stringify(evidence, null, 2));
const saved = new Uint8Array(
  await readFile(process.env.REPORT_VERIFY_DOCX ?? `${output}/report.docx`)
);
const parts = unzipSync(saved);
const xml = strFromU8(parts['word/document.xml']!);
await writeFile(`${output}/document.xml`, xml);
assert.match(xml, /PreserveMe/);
assert.match(xml, /ARCHIVE SENTINEL/);
assert.deepEqual(parts['word/media/sentinel.png'], inputParts['word/media/sentinel.png']);
assert.equal(
  strFromU8(parts['customXml/report-sentinel.xml']!),
  strFromU8(inputParts['customXml/report-sentinel.xml'])
);
assert.match(strFromU8(parts['word/styles.xml']!), /123456/);
const reopened = await DocxEditor.createServer(saved);
try {
  await reopened.run(async (context) => {
    const body = context.document.body;
    body.load('text');
    const tables = body.tables;
    tables.load('items');
    const pics = body.inlinePictures;
    pics.load('items');
    await context.sync();
    for (const table of tables.items)
      table.load('values,style,headerRowCount,rowCount,columnCount');
    for (const pic of pics.items) pic.load('width,height,lockAspectRatio,altTextDescription');
    await context.sync();
    assert.equal(tables.items.length, 1);
    assert.deepEqual(tables.items[0]!.values, [
      ['Measure', 'Q2', 'Q3'],
      ['Delivery', '81%', '95%'],
      ['Retention', '92%', '94%'],
    ]);
    assert.equal(tables.items[0]!.headerRowCount, 1);
    assert.equal(tables.items[0]!.style, 'Report Grid');
    assert.equal(pics.items.length, 1);
    assert.equal(pics.items[0]!.width, 96);
    assert.equal(pics.items[0]!.height, 36);
    assert.equal(pics.items[0]!.altTextDescription, 'Delivery trend & confidence <Q3>');
    const cell = tables.items[0]!.getCell(0, 0);
    cell.load('columnWidth,shadingColor,verticalAlignment');
    await context.sync();
    assert.equal(cell.columnWidth, 144);
    assert.equal(cell.shadingColor.replace('#', ''), 'DDEEFF');
    assert.equal(cell.verticalAlignment, 'Center');
    evidence.push({
      reopened: {
        text: body.text,
        tables: tables.items.map((t) => ({
          values: t.values,
          style: t.style,
          headers: t.headerRowCount,
          rows: t.rowCount,
          columns: t.columnCount,
        })),
        pictures: pics.items.map((p) => ({
          width: p.width,
          height: p.height,
          locked: p.lockAspectRatio,
          alt: p.altTextDescription,
        })),
      },
    });
  });
} finally {
  reopened.dispose();
}
const gridXml = xml.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/)![0];
assert.deepEqual(
  [...gridXml.matchAll(/w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1])),
  [2880, 3600, 3600]
);
const paragraphXml = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m) => m[0]);
for (const label of ['Operating metrics', 'Figure 1. Delivery confidence']) {
  assert.match(paragraphXml.find((p) => p.includes(label))!, /w:numId w:val="0"/);
}
const headingXml = paragraphXml.find((p) => p.includes('Q3 delivery report'))!;
assert.match(headingXml, /w:pStyle w:val="Heading1"/);
assert.match(headingXml, /w:sz w:val="44"/);
assert.match(headingXml, /w:jc w:val="center"/);
assert.match(headingXml, /w:after="200"/);
if (!probe) {
  assert.match(
    paragraphXml.find((p) => p.includes('Accessibility audit complete'))!,
    /w:ilvl w:val="1"/
  );
  assert.match(paragraphXml.find((p) => p.includes('Temporary note'))!, /w:numId w:val="0"/);
}
if (!probe) {
  const footerXml = strFromU8(parts['word/footer1.xml']!);
  assert.match(footerXml, /w:instr="PAGE">[\s\S]*?<w:t>1<\/w:t>/);
  assert.match(footerXml, /w:instr="NUMPAGES">[\s\S]*?<w:t>1<\/w:t>/);
  if (!evidence.some((e) => (e as { kind?: string }).kind === 'footer-formatting-after-fields')) {
    assert.match(footerXml, /w:sz w:val="18"/);
    assert.match(footerXml, /w:jc w:val="center"/);
  }
  assert.match(xml, /w:pgSz[^>]*w:h="15840"[^>]*w:w="12240"/);
  assert.match(xml, /w:pgMar[^>]*w:bottom="1080"/);
}
assert.match(strFromU8(parts['word/numbering.xml']!), /w:start w:val="3"/);
evidence.push({
  semantics: 'passed',
  preservation: [
    'bookmark',
    'sentinel text',
    'custom XML',
    'unrelated style border',
    'original media bytes',
  ],
  cachedFields: probe ? 'not checked' : { PAGE: 1, NUMPAGES: 1 },
});
for (const [name, bytes] of Object.entries(parts)) {
  if (/word\/(header|footer|numbering)/.test(name) && name.endsWith('.xml'))
    await writeFile(`${output}/${name.replaceAll('/', '-')}`, bytes);
}
await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2));
process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
if (evidence.some((e) => (e as { status?: string }).status === 'failed')) process.exitCode = 1;
