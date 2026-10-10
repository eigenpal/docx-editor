/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor } from '../../index.ts';
import { docx, p } from './support/docx.ts';

for (const type of ['PlainText', 'RichText', 'DatePicker'] as const) {
  for (const decision of ['accept', 'reject'] as const) {
    test(`${type} wrapper survives save and ${decision}`, async () => {
      const runtime = await DocxEditor.createServer(docx(p('Date: [Select date].')), {
        author: 'Writer',
      });
      try {
        await runtime.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          const matches = c.document.body.search('[Select date]');
          matches.load('items');
          await c.sync();
          const control = matches.items[0]!.insertContentControl(type);
          await c.sync();
          control.tag = 'date';
          control.title = 'Effective date';
          await c.sync();
        });
        const bytes = await runtime.save();
        const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
        expect(xml).toMatch(/<w:ins[^>]*>\s*<w:sdt/);
        expect(xml).toContain('w:delText');
        const reopened = await DocxEditor.createServer(bytes);
        try {
          await reopened.run(async (c) => {
            const revisions = c.document.body.revisions;
            revisions.load('items');
            await c.sync();
            expect(revisions.items).toHaveLength(2);
            for (const revision of revisions.items) revision[decision]();
            await c.sync();
            const controls = c.document.contentControls;
            controls.load('items');
            c.document.body.load('text');
            await c.sync();
            expect(c.document.body.text).toBe('Date: [Select date].');
            expect(controls.items.length).toBe(decision === 'accept' ? 1 : 0);
            if (controls.items[0]) {
              controls.items[0].load('tag,title,text');
              await c.sync();
              expect(controls.items[0].tag).toBe('date');
              expect(controls.items[0].title).toBe('Effective date');
              expect(controls.items[0].text).toBe('[Select date]');
            }
          });
        } finally {
          reopened.dispose();
        }
      } finally {
        runtime.dispose();
      }
    });
  }
}

test('tracked wrappers preserve mixed run formatting and unrelated text through both decisions', async () => {
  const body =
    '<w:p><w:r><w:t>Keep: </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Alpha</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>Beta</w:t></w:r><w:r><w:t> tail</w:t></w:r></w:p>';
  const runtime = await DocxEditor.createServer(docx(body), {
    author: 'Writer',
    revisionTextView: 'original',
  });
  try {
    await runtime.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      const ranges = c.document.body.search('AlphaBeta');
      ranges.load('items');
      await c.sync();
      ranges.items[0]!.insertContentControl('RichText');
      await c.sync();
      c.document.body.load('text');
      await c.sync();
      expect(c.document.body.text).toBe('Keep: AlphaBeta tail');
    });
    const bytes = await runtime.save();
    for (const decision of ['acceptAll', 'rejectAll'] as const) {
      const reopened = await DocxEditor.createServer(bytes);
      try {
        await reopened.run(async (c) => {
          c.document.body.revisions[decision]();
          await c.sync();
          const a = c.document.body.search('Alpha'),
            b = c.document.body.search('Beta');
          a.load('items');
          b.load('items');
          c.document.body.load('text');
          await c.sync();
          expect(c.document.body.text).toBe('Keep: AlphaBeta tail');
          a.items[0]!.font.load('bold');
          b.items[0]!.font.load('italic');
          await c.sync();
          expect(a.items[0]!.font.bold).toBe(true);
          expect(b.items[0]!.font.italic).toBe(true);
        });
      } finally {
        reopened.dispose();
      }
    }
  } finally {
    runtime.dispose();
  }
});

test('tracked creation refuses empty ranges and cannot change established control metadata', async () => {
  const runtime = await DocxEditor.createServer(docx(p('Field')), { author: 'Writer' });
  try {
    await runtime.run(async (c) => {
      const control = c.document.body.getRange('Content').insertContentControl('PlainText');
      await c.sync();
      control.tag = 'original';
      await c.sync();
      c.document.changeTrackingMode = 'TrackMineOnly';
      await c.sync();
      control.tag = 'changed';
      await expect(c.sync()).rejects.toMatchObject({ code: 'NotSupported' });
      control.load('tag');
      await c.sync();
      expect(control.tag).toBe('original');
    });
    const before = await runtime.save();
    await expect(
      runtime.run(async (c) => {
        c.document.body.getRange('End').insertContentControl('RichText');
        await c.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
  }
});

for (const content of [
  '<w:bookmarkStart w:id="1" w:name="keep"/><w:r><w:t>Field</w:t></w:r><w:bookmarkEnd w:id="1"/>',
  '<w:ins w:id="1" w:author="Other"><w:r><w:t>Field</w:t></w:r></w:ins>',
  '<w:hyperlink w:anchor="keep"><w:r><w:t>Field</w:t></w:r></w:hyperlink>',
  '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>Field</w:t></w:r></w:sdtContent></w:sdt>',
]) {
  test(`tracked wrapper refuses protected or structured content ${content.slice(0, 35)}`, async () => {
    const runtime = await DocxEditor.createServer(docx(`<w:p>${content}</w:p>`), {
      author: 'Writer',
    });
    try {
      const before = await runtime.save();
      await expect(
        runtime.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          c.document.body.getRange('Content').insertContentControl('RichText');
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'NotSupported' });
      expect(await runtime.save()).toEqual(before);
    } finally {
      runtime.dispose();
    }
  });
}

test('a different author cannot configure a pending inserted control', async () => {
  const author = await DocxEditor.createServer(docx(p('Field')), { author: 'Author' });
  try {
    await author.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      c.document.body.getRange('Content').insertContentControl('PlainText');
      await c.sync();
    });
    const other = await DocxEditor.createServer(await author.save(), { author: 'Other' });
    try {
      const before = await other.save();
      await expect(
        other.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          c.document.contentControls.getFirst().title = 'Changed';
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'NotSupported' });
      expect(await other.save()).toEqual(before);
    } finally {
      other.dispose();
    }
  } finally {
    author.dispose();
  }
});

for (const properties of [
  '<w:pPrChange w:id="9" w:author="Other"><w:pPr/></w:pPrChange>',
  '<w:rPr><w:ins w:id="9" w:author="Other"/></w:rPr>',
  '<w:rPr><w:del w:id="9" w:author="Other"/></w:rPr>',
]) {
  test(`tracked controls refuse pending paragraph properties: ${properties.slice(0, 30)}`, async () => {
    const runtime = await DocxEditor.createServer(
      docx(`<w:p><w:pPr>${properties}</w:pPr><w:r><w:t>Keep Field tail</w:t></w:r></w:p>`),
      { author: 'Writer' }
    );
    try {
      const before = await runtime.save();
      await expect(
        runtime.run(async (context) => {
          context.document.changeTrackingMode = 'TrackMineOnly';
          const matches = context.document.body.search('Field');
          matches.load('items');
          await context.sync();
          matches.items[0]!.insertContentControl('PlainText');
          await context.sync();
        })
      ).rejects.toMatchObject({ code: 'NotSupported' });
      expect(await runtime.save()).toEqual(before);
    } finally {
      runtime.dispose();
    }
  });
}

test('separate control suggestions keep independent review decisions after reopen', async () => {
  const runtime = await DocxEditor.createServer(docx(p('One Two')), { author: 'Writer' });
  try {
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      for (const text of ['One', 'Two']) {
        const matches = context.document.body.search(text);
        matches.load('items');
        await context.sync();
        const control = matches.items[0]!.insertContentControl('PlainText');
        await context.sync();
        control.tag = text.toLowerCase();
        await context.sync();
      }
    });
    const reopened = await DocxEditor.createServer(await runtime.save());
    try {
      await reopened.run(async (context) => {
        const revisions = context.document.body.revisions;
        revisions.load('items');
        await context.sync();
        expect(revisions.items).toHaveLength(4);
        revisions.items[0]!.accept();
        revisions.items[1]!.accept();
        await context.sync();
        revisions.load('items');
        await context.sync();
        expect(revisions.items).toHaveLength(2);
        for (const revision of revisions.items) revision.reject();
        await context.sync();
        const controls = context.document.contentControls;
        controls.load('items');
        context.document.body.load('text');
        await context.sync();
        expect(context.document.body.text).toBe('One Two');
        expect(controls.items).toHaveLength(1);
        controls.items[0]!.load('tag,text');
        await context.sync();
        expect(controls.items[0]!.tag).toBe('one');
        expect(controls.items[0]!.text).toBe('One');
      });
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});
