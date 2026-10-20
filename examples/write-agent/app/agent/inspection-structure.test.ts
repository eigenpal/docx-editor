import { expect, test } from 'bun:test';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { seedDocx } from '../seed-document';
import { runWriterTool } from './run-tool';

test('picture inspection reveals an existing row and table inspection gives cell ownership', async () => {
  const runtime = await DocxEditor.createServer(seedDocx());
  try {
    await runtime.run(async (context) => {
      const table = context.document.body
        .getRange('End')
        .insertTable(1, 3, 'After', [['A', 'B', 'C']]);
      await context.sync();
      const paragraphs = table.getCell(0, 1).body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      paragraphs.items[0]!.getRange('End').insertInlinePictureFromBase64(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=',
        'End'
      );
      await context.sync();
    });
    const pictures = await runWriterTool(runtime, null, 'inspect_document', { area: 'pictures' });
    expect(pictures.success, pictures.output).toBe(true);
    expect(JSON.parse(pictures.output).tables).toEqual([{ index: 0, rowCount: 1, columnCount: 3 }]);
    const tables = await runWriterTool(runtime, null, 'inspect_document', { area: 'tables' });
    expect(tables.success, tables.output).toBe(true);
    const cells = JSON.parse(tables.output).items[0].cells;
    expect(cells.map((cell: { pictureCount: number }) => cell.pictureCount)).toEqual([0, 1, 0]);
    expect(cells[1].paragraphs[0].text).toContain('B');
    const paragraphs = await runWriterTool(runtime, null, 'inspect_document', {
      area: 'paragraphs',
    });
    expect(paragraphs.success, paragraphs.output).toBe(true);
    expect(
      JSON.parse(paragraphs.output).items.find((p: { text: string }) => p.text.startsWith('B'))
        .pictureCount
    ).toBe(1);
  } finally {
    runtime.dispose();
  }
});
