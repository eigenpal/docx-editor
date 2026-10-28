/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Inside a content-locked control, a decision that keeps the content applies and one that would
// change it fails with the lock's own code, whether it names one revision or all of them.
import { expect, test } from 'bun:test';
import { createServer } from '../../runtime/server.ts';
import { docx } from './support/documents.ts';

const ann = (id: number) => `w:id="${id}" w:author="Ann" w:date="2026-10-01T10:00:00Z"`;
const body =
  '<w:p><w:sdt><w:sdtPr><w:id w:val="7"/><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
  `<w:r><w:t xml:space="preserve">in </w:t></w:r><w:del ${ann(1)}><w:r><w:delText xml:space="preserve">OLD </w:delText></w:r></w:del>` +
  `<w:ins ${ann(2)}><w:r><w:t xml:space="preserve">NEW </w:t></w:r></w:ins><w:r><w:t>end</w:t></w:r></w:sdtContent></w:sdt></w:p>`;

async function attempt(
  decide: (revisions: any) => void,
  xml = body
): Promise<{ readonly error: string | null; readonly left: number }> {
  const runtime = await createServer(docx(xml), { author: 'Reviewer' });
  try {
    const error = await runtime
      .run(async (context) => {
        const revisions = context.document.revisions;
        revisions.load('items/type');
        await context.sync();
        decide(revisions);
        await context.sync();
        return null;
      })
      .catch((e: any) => `${e?.code}/${e?.debugInfo?.innerError?.code}`);
    const left = await runtime.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load('items');
      await context.sync();
      return revisions.items.length;
    });
    return { error, left };
  } finally {
    runtime.dispose();
  }
}

test('accepting the insertion applies; accepting the deletion fails as locked content', async () => {
  const insertion = await attempt((revisions) =>
    revisions.items.find((item: any) => item.type === 'Insert').accept()
  );
  expect(insertion).toEqual({ error: null, left: 1 });
  const deletion = await attempt((revisions) =>
    revisions.items.find((item: any) => item.type === 'Delete').accept()
  );
  expect(deletion).toEqual({ error: 'GeneralException/review.locked-content', left: 2 });
});

test('acceptAll() over the locked deletion fails the same way', async () => {
  expect(await attempt((revisions) => revisions.acceptAll())).toEqual({
    error: 'GeneralException/review.locked-content',
    left: 2,
  });
});

test('a revision returns the same range proxy, so a load on it is kept', async () => {
  const runtime = await createServer(docx(body), { author: 'Reviewer' });
  try {
    const text = await runtime.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load('items');
      await context.sync();
      const revision = revisions.items[0]!;
      expect(revision.range).toBe(revision.range);
      revision.range.load('text');
      await context.sync();
      return revision.range.text;
    });
    expect(text).toBe('OLD ');
  } finally {
    runtime.dispose();
  }
});

test('a decision inside a data-bound control fails as bound content', async () => {
  const bound = body.replace(
    '<w:lock w:val="contentLocked"/>',
    '<w:dataBinding w:storeItemID="{1}" w:xpath="/a"/>'
  );
  const insertion = await attempt(
    (revisions) => revisions.items.find((item: any) => item.type === 'Insert').accept(),
    bound
  );
  expect(insertion).toEqual({ error: 'GeneralException/review.bound-content', left: 2 });
});

test('acceptAll() over a data-bound change fails with the binding code', async () => {
  const bound = body.replace(
    '<w:lock w:val="contentLocked"/>',
    '<w:dataBinding w:storeItemID="{1}" w:xpath="/a"/>'
  );
  expect(await attempt((revisions) => revisions.acceptAll(), bound)).toEqual({
    error: 'GeneralException/review.bound-content',
    left: 2,
  });
});

// The decision keeps what a lock allows: the locked control holds only what the decision keeps.
test('acceptAll() applies when the locked control holds only an insertion', async () => {
  const insertionOnly =
    '<w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
    `<w:ins ${ann(2)}><w:r><w:t>NEW</w:t></w:r></w:ins></w:sdtContent></w:sdt></w:p>`;
  expect(await attempt((revisions) => revisions.acceptAll(), insertionOnly)).toEqual({
    error: null,
    left: 0,
  });
  const deletionOnly =
    '<w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
    `<w:del ${ann(1)}><w:r><w:delText>OLD</w:delText></w:r></w:del></w:sdtContent></w:sdt></w:p>`;
  expect(await attempt((revisions) => revisions.rejectAll(), deletionOnly)).toEqual({
    error: null,
    left: 0,
  });
});

// A text box is its own story: the body's acceptAll() leaves its locked change alone.
test('acceptAll() on the body ignores a locked change inside a text box', async () => {
  const NS =
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
  const locked =
    '<w:txbxContent><w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>' +
    `<w:sdtContent><w:del ${ann(1)}><w:r><w:delText>OLD</w:delText></w:r></w:del>` +
    '</w:sdtContent></w:sdt></w:p></w:txbxContent>';
  const box =
    `<w:r><w:drawing ${NS}><wp:anchor distT="0" distB="0" distL="0" distR="0" ` +
    'simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" ' +
    'allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column">' +
    '<wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph">' +
    '<wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="2743200" cy="457200"/>' +
    '<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Text Box 1"/><a:graphic>' +
    '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr/>' +
    `<wps:txbx>${locked}</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>';
  const xml = `<w:p><w:ins ${ann(2)}><w:r><w:t xml:space="preserve">NEW </w:t></w:r></w:ins>${box}</w:p>`;
  const runtime = await createServer(docx(xml), { author: 'Reviewer' });
  try {
    const left = await runtime.run(async (context) => {
      const revisions = context.document.body.revisions;
      revisions.acceptAll();
      await context.sync();
      revisions.load('items');
      await context.sync();
      return revisions.items.length;
    });
    expect(left).toBe(0);
  } finally {
    runtime.dispose();
  }
});
