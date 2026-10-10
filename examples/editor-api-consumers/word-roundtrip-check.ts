/** Verify a disposable contract after native Word editing, undo/redo, and save. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DocxEditor } from '@docx-editor.dev/editor-api';

const directory = process.argv[2] ?? '/tmp/pr811-word-round2';
const runtime = await DocxEditor.createServer(
  await readFile(join(directory, 'contract-pending.docx'))
);
try {
  await runtime.run(async (context) => {
    const document = context.document;
    document.body.load('text');
    document.revisions.load('items');
    const comment = document.comments.getFirst();
    comment.load('text,resolved');
    comment.replies.load('items');
    const control = document.contentControls.getByTag('reference').getFirst();
    control.load('text,cannotEdit,cannotDelete');
    const link = document.body.search('support portal').getFirst();
    link.load('hyperlink');
    await context.sync();
    assert.ok(document.body.text.includes('SERVICE AGREEMENT — WORD CHECK'));
    assert.ok(document.body.text.includes('Signed by Ada Lovelace on 13 September 2026.'));
    assert.ok(document.body.text.includes('Confidential material remains protected.'));
    assert.equal(control.text, 'REF-2026-0913');
    assert.equal(control.cannotEdit, true);
    assert.equal(control.cannotDelete, true);
    assert.equal(link.hyperlink, 'https://example.com/support');
    assert.equal(comment.text, 'Please confirm the liability cap.');
    assert.equal(comment.resolved, true);
    assert.equal(comment.replies.items.length, 1);
    comment.replies.items[0]!.load('text');
    await context.sync();
    assert.equal(comment.replies.items[0]!.text, 'Approved by commercial review.');
    assert.ok(document.revisions.items.length > 0);
    document.revisions.acceptAll();
    await context.sync();
  });
  const bytes = await runtime.save();
  await writeFile(join(directory, 'contract-word-then-api-accepted.docx'), bytes);
  const reopened = await DocxEditor.createServer(bytes);
  try {
    await reopened.run(async (context) => {
      context.document.body.load('text');
      context.document.revisions.load('items');
      await context.sync();
      assert.ok(context.document.body.text.includes('Pay within 30 days.'));
      assert.ok(!context.document.body.text.includes('within 7 days'));
      assert.ok(context.document.body.text.includes('SERVICE AGREEMENT — WORD CHECK'));
      assert.equal(context.document.revisions.items.length, 0);
    });
  } finally {
    reopened.dispose();
  }
  console.log(
    'PASS native Word edit/save, preserved controls/links/comments, API acceptance, and reopen'
  );
} finally {
  runtime.dispose();
}
