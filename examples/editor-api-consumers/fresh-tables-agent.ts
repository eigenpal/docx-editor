/** Blind public-API consumer. Run with bun from the repository root. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync, unzipSync, strFromU8 } from 'fflate';
import {
  DocxEditor,
  DocxEditorError,
  type DocxEditorServerRuntime,
} from '@docx-editor.dev/editor-api';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fixture = zipSync({
  '[Content_Types].xml': strToU8(
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
  ),
  '_rels/.rels': strToU8(
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  ),
  'word/styles.xml': strToU8(
    `<?xml version="1.0"?><w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>`
  ),
  'word/document.xml': strToU8(
    `<?xml version="1.0"?><w:document xmlns:w="${w}"><w:body>${['Quarterly service report', 'Metrics', 'Verify backup', 'Confirm restoration', 'Logo', 'End of report'].map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
  ),
});
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const results: { stage: string; ok: boolean; detail?: unknown }[] = [];
async function stage(name: string, fn: () => Promise<unknown>) {
  try {
    const detail = await fn();
    results.push({ stage: name, ok: true, detail });
    console.log('PASS', name, detail ?? '');
  } catch (error) {
    const detail =
      error instanceof DocxEditorError
        ? {
            code: error.code,
            message: error.message,
            ...('debugInfo' in error ? { debugInfo: error.debugInfo } : {}),
          }
        : { message: String(error) };
    results.push({ stage: name, ok: false, detail });
    console.log('FAIL', name, JSON.stringify(detail));
  }
}

async function inspect(runtime: DocxEditorServerRuntime) {
  return runtime.run(async (context) => {
    const body = context.document.body;
    body.load('text');
    body.tables.load('items');
    body.inlinePictures.load('items');
    body.lists.load('items');
    body.paragraphs.load('items');
    await context.sync();
    for (const table of body.tables.items)
      table.load('values,rowCount,columnCount,headerRowCount,style');
    for (const picture of body.inlinePictures.items)
      picture.load('width,height,lockAspectRatio,altTextDescription');
    for (const paragraph of body.paragraphs.items) paragraph.load('text,style');
    await context.sync();
    return {
      text: body.text,
      tables: body.tables.items.map((t) => ({
        values: t.values,
        rows: t.rowCount,
        columns: t.columnCount,
        headers: t.headerRowCount,
        style: t.style,
      })),
      pictures: body.inlinePictures.items.map((p) => ({
        width: p.width,
        height: p.height,
        lock: p.lockAspectRatio,
        alt: p.altTextDescription,
      })),
      lists: body.lists.items.length,
      paragraphs: body.paragraphs.items.map((p) => ({ text: p.text, style: p.style })),
    };
  });
}

const runtime = await DocxEditor.createServer(fixture, { author: 'Service report agent' });
try {
  await stage('format title using read-derived proxy', () =>
    runtime.run(async (context) => {
      const title = context.document.body.paragraphs.getFirst();
      title.style = 'Heading 1';
      title.font.bold = true;
      title.font.size = 20;
      title.spaceAfter = 12;
      await context.sync();
    })
  );
  await stage('create metrics table', () =>
    runtime.run(async (context) => {
      const anchor = context.document.body.search('Metrics').getFirst();
      const table = anchor.insertTable(3, 2, 'After', [
        ['Service', 'Availability'],
        ['API', '99.95%'],
        ['Storage', '99.99%'],
      ]);
      await context.sync();
      table.style = 'Table Grid';
      table.headerRowCount = 1;
      await context.sync();
    })
  );
  await stage('format header and set column widths in one batch', () =>
    runtime.run(async (context) => {
      const table = context.document.body.tables.getFirst();
      for (let col = 0; col < 2; col++) {
        const cell = table.getCell(0, col);
        cell.shadingColor = '#143B52';
        cell.verticalAlignment = 'Center';
        cell.columnWidth = col === 0 ? 210 : 110;
        cell.body.font.bold = true;
        cell.body.font.color = '#FFFFFF';
      }
      await context.sync();
    })
  );
  await stage('add a metrics row and configure returned row after sync', () =>
    runtime.run(async (context) => {
      const table = context.document.body.tables.getFirst();
      const added = table.addRows('End', 1, [['Search', '99.90%']]);
      await context.sync();
      added.load('items');
      await context.sync();
      assert.equal(added.items.length, 1);
      const cell = added.items[0]!.cells.getFirst();
      cell.shadingColor = '#E2EFD9';
      await context.sync();
    })
  );
  await stage('append owner column', () =>
    runtime.run(async (context) => {
      context.document.body.tables
        .getFirst()
        .addColumns('End', 1, [['Owner'], ['Ada'], ['Sam'], ['Kai']]);
      await context.sync();
    })
  );
  await stage('update cell text and independent formatting', () =>
    runtime.run(async (context) => {
      const cell = context.document.body.tables.getFirst().getCell(1, 1);
      cell.value = '99.97%';
      cell.shadingColor = '#E2EFD9';
      await context.sync();
    })
  );
  await stage('create numbered action list', () =>
    runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      for (const paragraph of paragraphs.items) paragraph.load('text');
      await context.sync();
      const first = paragraphs.items.find((p) => p.text === 'Verify backup')!;
      const second = paragraphs.items.find((p) => p.text === 'Confirm restoration')!;
      const list = first.startNewList();
      await context.sync();
      list.load('id');
      await context.sync();
      list.setLevelNumbering(0, 'Arabic', [0, '.']);
      list.setLevelIndents(0, 36, -18);
      list.setLevelStartingNumber(0, 3);
      second.attachToList(list.id, 0);
      await context.sync();
    })
  );
  await stage('append nested action', () =>
    runtime.run(async (context) => {
      const list = context.document.body.lists.getFirst();
      const detail = list.insertParagraph('Record elapsed recovery time', 'End');
      await context.sync();
      list.setLevelBullet(1, 'Custom', 0x2022, 'Calibri');
      list.setLevelIndents(1, 54, -18);
      detail.listItem.level = 1;
      await context.sync();
    })
  );
  await stage('insert and resize inline report logo', () =>
    runtime.run(async (context) => {
      const marker = context.document.body.search('Logo').getFirst();
      const picture = marker.insertInlinePictureFromBase64(png, 'Replace');
      await context.sync();
      picture.lockAspectRatio = true;
      picture.width = 48;
      picture.altTextDescription = 'Service report logo';
      await context.sync();
    })
  );
  await stage('recover within run after a refused dimension batch', () =>
    runtime.run(async (context) => {
      const picture = context.document.body.inlinePictures.getFirst();
      const title = context.document.body.paragraphs.getFirst();
      title.font.italic = true;
      picture.width = 72;
      picture.height = 20;
      let refused = false;
      try {
        await context.sync();
      } catch (error) {
        assert(error instanceof DocxEditorError);
        refused = true;
      }
      assert(refused, 'Locked contradictory dimensions must refuse');
      picture.load('width,height');
      title.font.load('italic');
      await context.sync();
      assert.equal(picture.width, 48);
      assert.equal(picture.height, 48);
      assert.notEqual(title.font.italic, true, 'Failed batch must preserve title font');
      picture.width = 60;
      await context.sync();
    })
  );
  await stage('verify header formatting survives structural table edits', () =>
    runtime.run(async (context) => {
      const table = context.document.body.tables.getFirst();
      const first = table.getCell(0, 0);
      const second = table.getCell(0, 1);
      first.load('columnWidth,shadingColor,verticalAlignment');
      second.load('columnWidth,shadingColor,verticalAlignment');
      first.body.font.load('bold,color');
      second.body.font.load('bold,color');
      await context.sync();
      assert.equal(first.columnWidth, 210);
      assert.equal(second.columnWidth, 110);
      for (const cell of [first, second]) {
        assert.equal(cell.shadingColor, '#143B52');
        assert.equal(cell.verticalAlignment, 'Center');
        assert.equal(cell.body.font.bold, true);
        assert.equal(cell.body.font.color, '#FFFFFF');
      }
    })
  );
  await stage('read final document', () => inspect(runtime));
  await stage('save and reopen report', async () => {
    const before = await inspect(runtime);
    const bytes = await runtime.save();
    const file = join(tmpdir(), 'fresh-tables-report.docx');
    await writeFile(file, bytes);
    const reopened = await DocxEditor.createServer(bytes);
    try {
      assert.deepEqual(await inspect(reopened), before);
    } finally {
      reopened.dispose();
    }
    const xml = unzipSync(bytes);
    return {
      file,
      bytes: bytes.length,
      numbering: xml['word/numbering.xml'] ? strFromU8(xml['word/numbering.xml']!) : null,
    };
  });
} finally {
  runtime.dispose();
}

// These isolated probes follow the first blind run. They still use public imports only.
async function probe(name: string, fn: (runtime: DocxEditorServerRuntime) => Promise<unknown>) {
  await stage(name, async () => {
    const isolated = await DocxEditor.createServer(fixture);
    try {
      return await fn(isolated);
    } finally {
      isolated.dispose();
    }
  });
}
await probe('isolate same-level list settings without membership writes', (isolated) =>
  isolated.run(async (context) => {
    const list = context.document.body.paragraphs.getFirst().startNewList();
    await context.sync();
    list.setLevelNumbering(0, 'Arabic', [0, '.']);
    list.setLevelIndents(0, 36, -18);
    list.setLevelStartingNumber(0, 3);
    await context.sync();
  })
);
await probe('isolate list formatting plus attach on another paragraph', (isolated) =>
  isolated.run(async (context) => {
    const first = context.document.body.paragraphs.getFirst();
    const second = first.insertParagraph('Second task', 'After');
    await context.sync();
    const list = first.startNewList();
    await context.sync();
    list.load('id');
    await context.sync();
    list.setLevelNumbering(0, 'Arabic', [0, '.']);
    second.attachToList(list.id, 0);
    await context.sync();
  })
);
await probe('isolate level definition plus listItem level assignment', (isolated) =>
  isolated.run(async (context) => {
    const first = context.document.body.paragraphs.getFirst();
    const list = first.startNewList();
    await context.sync();
    list.setLevelBullet(1, 'Custom', 0x2022, 'Calibri');
    first.listItem.level = 1;
    await context.sync();
  })
);
await probe('delete table row and column then inspect values', (isolated) =>
  isolated.run(async (context) => {
    const table = context.document.body
      .search('Metrics')
      .getFirst()
      .insertTable(3, 3, 'After', [
        ['a', 'b', 'c'],
        ['d', 'e', 'f'],
        ['g', 'h', 'i'],
      ]);
    await context.sync();
    table.deleteRows(1);
    await context.sync();
    table.deleteColumns(1);
    await context.sync();
    table.load('values,rowCount,columnCount');
    await context.sync();
    assert.deepEqual(table.values, [
      ['a', 'c'],
      ['g', 'i'],
    ]);
    assert.equal(table.rowCount, 2);
    assert.equal(table.columnCount, 2);
  })
);
await probe('replace plain table values and retain cell formatting', (isolated) =>
  isolated.run(async (context) => {
    const table = context.document.body
      .search('Metrics')
      .getFirst()
      .insertTable(2, 2, 'After', [
        ['a', 'b'],
        ['c', 'd'],
      ]);
    await context.sync();
    const cell = table.getCell(0, 0);
    cell.shadingColor = '#FFFF00';
    cell.body.font.bold = true;
    await context.sync();
    table.values = [
      ['A', 'B'],
      ['C', 'D'],
    ];
    await context.sync();
    table.load('values');
    cell.load('shadingColor');
    cell.body.font.load('bold');
    await context.sync();
    assert.deepEqual(table.values, [
      ['A', 'B'],
      ['C', 'D'],
    ]);
    assert.equal(cell.shadingColor, '#FFFF00');
    assert.equal(cell.body.font.bold, true);
  })
);
await probe('isolate cell body font read against paragraph read', (isolated) =>
  isolated.run(async (context) => {
    const table = context.document.body
      .search('Metrics')
      .getFirst()
      .insertTable(1, 2, 'After', [['Only bold text', 'Plain text']]);
    await context.sync();
    const cell = table.getCell(0, 0);
    cell.body.font.bold = true;
    cell.body.font.color = '#143B52';
    await context.sync();
    cell.body.load('text');
    cell.body.font.load('bold,color');
    const paragraph = cell.body.paragraphs.getFirst();
    paragraph.font.load('bold,color');
    await context.sync();
    const result = {
      text: cell.body.text,
      bodyBold: cell.body.font.bold,
      paragraphBold: paragraph.font.bold,
      bodyColor: cell.body.font.color,
      paragraphColor: paragraph.font.color,
    };
    console.log('CELL_FONT_OBSERVED', result);
    assert.equal(result.text, 'Only bold text');
    assert.equal(result.paragraphBold, true);
    assert.equal(result.bodyBold, true);
    assert.equal(result.bodyColor, '#143B52');
    return result;
  })
);
await probe('reuse loaded collections after refresh and inserted row deletion', (isolated) =>
  isolated.run(async (context) => {
    const tables = context.document.body.tables;
    tables.load('items');
    await context.sync();
    assert.equal(tables.items.length, 0);
    const table = context.document.body
      .search('Metrics')
      .getFirst()
      .insertTable(1, 2, 'After', [['a', 'b']]);
    await context.sync();
    tables.load('items');
    await context.sync();
    assert.equal(tables.items.length, 1);
    const rows = table.rows;
    rows.load('items');
    await context.sync();
    const original = rows.items[0]!;
    table.addRows('Start', 1, [['x', 'y']]);
    await context.sync();
    rows.load('items');
    const originalFirstCell = original.cells.getFirst();
    originalFirstCell.load('value');
    await context.sync();
    assert.equal(rows.items.length, 2);
    assert.equal(originalFirstCell.value, 'a');
    table.deleteRows(0);
    await context.sync();
    originalFirstCell.load('value');
    await context.sync();
    assert.equal(originalFirstCell.value, 'a');
  })
);
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.ok)) process.exitCode = 1;
