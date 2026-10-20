import { expect, test } from 'bun:test';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { zipDocument } from '../../../../packages/pro/src/collaboration/__tests__/document-peer-support';
import { runWriterTool } from './run-tool';

const cell = (value: string) => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
const fixture = () =>
  zipDocument(
    `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="3"/></w:tcPr><w:p><w:r><w:t>Summary</w:t></w:r></w:p></w:tc></w:tr><w:tr>${['Operating Expenses', '850', '820'].map(cell).join('')}</w:tr><w:tr>${['Net Income', '350', '530'].map(cell).join('')}</w:tr></w:tbl><w:p/>`
  );
for (const mode of ['direct', 'suggest'] as const) {
  test(`writer inserts middle rows below a merged header in ${mode}`, async () => {
    const runtime = await DocxEditor.createServer(fixture(), { author: 'Writer' });
    try {
      const read = await runWriterTool(runtime, null, 'inspect_document', { area: 'tables' }, mode);
      expect(read.success, read.output).toBe(true);
      const edit = await runWriterTool(
        runtime,
        null,
        'edit_table',
        {
          table: 0,
          operation: {
            action: 'insertRows',
            row: 1,
            location: 'After',
            count: 1,
            values: [['Cloud Infrastructure', '120', '145']],
          },
        },
        mode
      );
      expect(edit.success, edit.output).toBe(true);
      const reopened = await DocxEditor.createServer(await runtime.save());
      try {
        await reopened.run(async (context) => {
          if (mode === 'suggest') {
            context.document.body.revisions.acceptAll();
            await context.sync();
          }
          const table = context.document.body.tables.getFirst();
          table.load('values');
          await context.sync();
          expect(table.values).toEqual([
            ['Summary'],
            ['Operating Expenses', '850', '820'],
            ['Cloud Infrastructure', '120', '145'],
            ['Net Income', '350', '530'],
          ]);
        });
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
}
