// A large open lays its body out in slices: a growing prefix per task, each pass resuming
// from the last, then the normal full layout. The result must be exactly the layout an
// unsliced mount produces, and nothing may hand out the surface before it is complete.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { BlockFragmentRecord, SemanticLayout } from '../../layout/semantic-records.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { progressiveOpenStepCount } from '../surface-progressive-open.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const paragraph = (text: string, extra = '') =>
  `<w:p><w:pPr>${extra}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const item = (text: string) =>
  paragraph(text, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');

function table(rows: number, label: string): string {
  const cells: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    cells.push(
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${paragraph(`${label} ${row}`)}</w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${item(`${label} cell ${row}`)}</w:tc></w:tr>`
    );
  }
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    cells.join('') +
    '</w:tbl>'
  );
}

/** Several hundred blocks: lists, tables, keep-with-next, page and section breaks. */
function body(): string {
  const parts: string[] = [];
  for (let index = 0; index < 360; index += 1) {
    if (index % 40 === 0) parts.push(paragraph(`Heading ${index}`, '<w:keepNext/>'));
    if (index % 90 === 45) parts.push(table(25, `Table ${index}`));
    if (index === 150) parts.push(paragraph('Break', '<w:pageBreakBefore/>'));
    if (index === 240) {
      parts.push(
        paragraph(
          'Section end',
          '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1800" w:right="1800"/></w:sectPr>'
        )
      );
    }
    parts.push(index % 3 === 0 ? item(`Item ${index}`) : paragraph(`Body paragraph ${index}`));
  }
  return parts.join('') + '<w:sectPr/>';
}

/** Past the open-yield threshold through a filler part, so the open is deferred. */
function docx(): Uint8Array {
  const lines: string[] = [];
  for (let line = 1, total = 0; total < 700 * 1024; line += 1) {
    const text = `<l>filler line ${line} carrying a little ordinary sentence text.</l>`;
    lines.push(text);
    total += text.length;
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUMREL}" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body()}</w:body></w:document>`
    ),
    'customXml/item1.xml': strToU8(`<filler>${lines.join('')}</filler>`),
  });
}

/** Every fragment's identity, text, marker and position, in page order. */
function signature(layout: SemanticLayout): string[] {
  const rows: string[] = [];
  const visit = (blocks: readonly BlockFragmentRecord[], page: number): void => {
    for (const block of blocks) {
      if (block.kind === 'table') {
        rows.push(`${page}|table|${block.tableId}|${block.rows.length}|${block.box.y}`);
        for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks, page);
        continue;
      }
      const text = block.lines.flatMap((line) => line.spans.map((span) => span.text)).join('');
      rows.push(
        `${page}|${block.paragraphId}|${text}|${block.marker?.text ?? ''}|${block.box.y}|${block.lines.length}`
      );
    }
  };
  layout.pages.forEach((page, index) => visit(page.fragments, index));
  return rows;
}

async function until(check: () => boolean, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function unslicedSignature(bytes: Uint8Array): string[] {
  const container = document.createElement('div');
  const mounted = mountPaginatedSurface(container, bytes);
  if (!mounted.ok) throw new Error(mounted.reason);
  try {
    return signature(mounted.surface.layout());
  } finally {
    mounted.surface.destroy();
  }
}

describe('a large open laid out in slices', () => {
  test('finishes with exactly the layout of an unsliced mount', async () => {
    const bytes = docx();
    const stepsBefore = progressiveOpenStepCount();
    const editor = createDocxEditor({ document: bytes });
    editor.attach(document.createElement('div'));
    // No surface is handed out while slices remain.
    await until(() => {
      if (editor.snapshot().isOpening) expect(editor.surface).toBeNull();
      return editor.surface !== null && !editor.snapshot().isOpening;
    });
    // The open took several steps, each in its own task.
    expect(progressiveOpenStepCount() - stepsBefore).toBeGreaterThan(1);
    const sliced = signature(editor.surface!.layout());
    expect(sliced.length).toBeGreaterThan(400);
    expect(sliced).toEqual(unslicedSignature(bytes));
    editor.destroy();
  }, 60_000);

  test('a save during the slices finishes the layout at once', async () => {
    const bytes = docx();
    const editor = createDocxEditor({ document: bytes });
    editor.attach(document.createElement('div'));
    await until(() => editor.snapshot().isOpening && editor.fontMeasurement().resolving);
    const saved = await editor.save();
    expect(saved.byteLength).toBeGreaterThan(0);
    expect(editor.snapshot().isOpening).toBe(false);
    expect(editor.surface).not.toBeNull();
    expect(signature(editor.surface!.layout())).toEqual(unslicedSignature(bytes));
    editor.destroy();
  }, 60_000);
});
