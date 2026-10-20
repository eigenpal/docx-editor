/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { DocxEditor } from '../../index.ts';
import { docx, p } from './support/docx.ts';

for (const marker of ['ins', 'del']) {
  test(`a proposal in a pending row ${marker} rolls back earlier edits and tracking mode`, async () => {
    const runtime = await DocxEditor.createServer(
      docx(
        p('Unchanged paragraph') +
          '<w:tbl><w:tr><w:trPr>' +
          `<w:${marker} w:id="1" w:author="Human" w:date="2026-08-01T00:00:00Z"/>` +
          '</w:trPr><w:tc>' +
          p('first paragraph') +
          p('head target tail') +
          '</w:tc></w:tr></w:tbl>'
      ),
      { author: 'Agent' }
    );
    try {
      const before = await runtime.save();
      await runtime.run(async (context) => {
        const ordinary = context.document.body.search('Unchanged').getFirstOrNullObject();
        const target = context.document.body.search('target').getFirstOrNullObject();
        context.document.load('changeTrackingMode');
        await context.sync();

        ordinary.insertText('Must roll back', 'Replace');
        context.document.changeTrackingMode = 'TrackMineOnly';
        target.insertText('NEW', 'Replace');
        await expect(context.sync()).rejects.toMatchObject({ code: 'NotImplemented' });
        expect<string>(context.document.changeTrackingMode).toBe('Off');
        expect(await runtime.save()).toEqual(before);

        // The refusal preserves the read revision, so the untouched range remains usable.
        ordinary.insertText('Updated', 'Replace');
        await context.sync();
        context.document.body.load('text');
        context.document.load('changeTrackingMode');
        await context.sync();
        expect(context.document.body.text).toContain('Updated paragraph');
        expect(context.document.body.text).toContain('head target tail');
        expect<string>(context.document.changeTrackingMode).toBe('Off');
      });
    } finally {
      runtime.dispose();
    }
  });
}
