/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import {
  Alignment,
  BreakType,
  ChangeTrackingMode,
  ContentControlType,
  DocxEditor,
  InsertLocation,
  ListBullet,
  ListNumbering,
  PageOrientation,
  VerticalAlignment,
} from '../../index.ts';
import { docx, p } from './support/documents.ts';

test('public enum values drive document editing with the same behavior as string literals', async () => {
  const runtime = await DocxEditor.createServer(docx(p('Template')), { author: 'Enum consumer' });
  try {
    await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      const section = context.document.sections.getFirst();
      await context.sync();
      paragraph.alignment = Alignment.centered;
      section.pageSetup.orientation = PageOrientation.landscape;
      await context.sync();
      const table = context.document.body
        .getRange('Start')
        .insertTable(1, 1, InsertLocation.before, [['A']]);
      await context.sync();
      table.addRows(InsertLocation.end, 1, [['B']]);
      await context.sync();
      const cell = table.getCell(0, 0);
      cell.verticalAlignment = VerticalAlignment.center;
      await context.sync();
      cell.load('verticalAlignment');
      paragraph.load('alignment');
      section.pageSetup.load('orientation');
      await context.sync();
      expect(cell.verticalAlignment).toBe('Center');
      expect(paragraph.alignment).toBe('Centered');
      expect(section.pageSetup.orientation).toBe('Landscape');
      const list = paragraph.startNewList();
      await context.sync();
      list.setLevelNumbering(0, ListNumbering.arabic);
      await context.sync();
      list.setLevelBullet(0, ListBullet.square);
      await context.sync();
      paragraph.detachFromList();
      await context.sync();
      context.document.body.insertText(' suffix', InsertLocation.end);
      await context.sync();
      const controlRange = context.document.body.getRange('End');
      await context.sync();
      const control = controlRange.insertContentControl(ContentControlType.richText);
      await context.sync();
      control.insertText('CONTROL', InsertLocation.replace);
      await context.sync();
      context.document.changeTrackingMode = ChangeTrackingMode.trackMineOnly;
      await context.sync();
      context.document.body.insertText(' tracked', InsertLocation.end);
      await context.sync();
      context.document.changeTrackingMode = ChangeTrackingMode.off;
      await context.sync();
      const range = context.document.body.getRange('End');
      await context.sync();
      range.insertBreak(BreakType.next, InsertLocation.after);
      await expect(context.sync()).rejects.toThrow();
    });
  } finally {
    runtime.dispose();
  }
});
