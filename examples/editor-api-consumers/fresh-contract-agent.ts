/** Independent public-API consumer. Run: bun examples/editor-api-consumers/fresh-contract-agent.ts [probe-name] */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import {
  DocxEditor,
  isDocxEditorError,
  type DocxEditorRuntime,
  type RequestContext,
} from '@docx-editor.dev/editor-api';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const run = (s: string) => `<w:r><w:t xml:space="preserve">${esc(s)}</w:t></w:r>`;
const p = (s: string) => `<w:p>${run(s)}</w:p>`;
const control = (id: number, tag: string, value: string, lock = '') =>
  `<w:p><w:sdt><w:sdtPr><w:id w:val="${id}"/><w:tag w:val="${tag}"/><w:alias w:val="${tag}"/><w:text/>${lock ? `<w:lock w:val="${lock}"/>` : ''}</w:sdtPr><w:sdtContent>${run(value)}</w:sdtContent></w:sdt></w:p>`;
export function contractFixture(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${R}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${p('SERVICE AGREEMENT')}${control(11, 'client', '{{client}}')}${control(12, 'reference', 'REF-OLD', 'sdtContentLocked')}${p('Pay within 7 days. Liability is $10,000.')}${p('Visit our support portal for assistance.')}${p('Signed by {{signer}} on {{date}}.')}${p('Confidential material remains protected.')}<w:sectPr/></w:body></w:document>`
    ),
  });
}
async function text(runtime: DocxEditorRuntime) {
  return runtime.run(async (c) => {
    c.document.body.load('text');
    await c.sync();
    return c.document.body.text;
  });
}
async function unique(c: RequestContext, needle: string) {
  const found = c.document.body.search(needle, { matchCase: true });
  found.load('items');
  await c.sync();
  assert.equal(found.items.length, 1, `unique target ${needle}`);
  return found.items[0]!;
}
const probes: Record<
  string,
  (runtime: Awaited<ReturnType<typeof DocxEditor.createServer>>) => Promise<void>
> = {};
probes['contract-workflow'] = async (runtime) => {
  await runtime.run(async (c) => {
    const client = c.document.contentControls.getByTag('client').getFirst();
    const reference = c.document.contentControls.getByTag('reference').getFirst();
    client.load('text,isBound');
    reference.load('text,cannotEdit,cannotDelete');
    await c.sync();
    assert.equal(client.isBound, false);
    assert.equal(reference.cannotEdit, true);
    client.insertText('Acme Research Ltd.', 'Replace');
    reference.cannotEdit = false;
    reference.cannotDelete = false;
    await c.sync();
    reference.insertText('REF-2026-0913', 'Replace');
    await c.sync();
    reference.cannotEdit = true;
    reference.cannotDelete = true;
    await c.sync();
    const signer = c.document.body.search('{{signer}}').getFirst();
    const date = c.document.body.search('{{date}}').getFirst();
    signer.insertText('Ada Lovelace', 'Replace');
    date.insertText('13 September 2026', 'Replace');
    await c.sync();
    const portal = await unique(c, 'support portal');
    portal.hyperlink = 'https://example.com/support';
    await c.sync();
    const comment = (await unique(c, 'Liability is $10,000.')).insertComment(
      'Please confirm the liability cap.'
    );
    await c.sync();
    comment.reply('Approved by commercial review.');
    await c.sync();
    comment.resolved = true;
    await c.sync();
    c.document.changeTrackingMode = 'TrackMineOnly';
    (await unique(c, 'within 7 days')).insertText('within 30 days', 'Replace');
    await c.sync();
  });
  const pending = await runtime.save();
  const review = await DocxEditor.createServer(pending, { author: 'Human reviewer' });
  try {
    await review.run(async (c) => {
      const revisions = c.document.revisions;
      revisions.load('items');
      const comments = c.document.comments;
      comments.load('items');
      await c.sync();
      assert.ok(revisions.items.length > 0);
      assert.equal(comments.items.length, 1);
      comments.items[0]!.load('text,resolved');
      const replies = comments.items[0]!.replies;
      replies.load('items');
      await c.sync();
      assert.equal(comments.items[0]!.resolved, true);
      assert.equal(replies.items.length, 1);
      replies.items[0]!.load('text');
      await c.sync();
      assert.equal(replies.items[0]!.text, 'Approved by commercial review.');
      revisions.acceptAll();
      await c.sync();
      const link = await unique(c, 'support portal');
      link.load('hyperlink');
      const locked = c.document.contentControls.getByTag('reference').getFirst();
      locked.load('text,cannotDelete,cannotEdit');
      await c.sync();
      assert.equal(link.hyperlink, 'https://example.com/support');
      assert.equal(locked.text, 'REF-2026-0913');
      assert.equal(locked.cannotEdit, true);
      assert.equal(locked.cannotDelete, true);
    });
    const finalBytes = await review.save();
    const reopened = await DocxEditor.createServer(finalBytes);
    try {
      const result = await text(reopened);
      assert.ok(result.includes('within 30 days'));
      assert.ok(!result.includes('within 7 days'));
      assert.ok(result.includes('Signed by Ada Lovelace on 13 September 2026.'));
      assert.ok(result.includes('Acme Research Ltd.'));
      assert.ok(result.includes('Confidential material remains protected.'));
      await reopened.run(async (c) => {
        c.document.revisions.load('items');
        await c.sync();
        assert.equal(c.document.revisions.items.length, 0);
      });
    } finally {
      reopened.dispose();
    }
    const out = join(tmpdir(), 'fresh-contract-agent');
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'pending.docx'), pending);
    await writeFile(join(out, 'accepted.docx'), finalBytes);
    console.log(`Artifacts: ${out}`);
  } finally {
    review.dispose();
  }
};
probes['tagged-control-roundtrip'] = async (runtime) => {
  await runtime.run(async (c) => {
    const a = c.document.contentControls.getByTag('reference').getFirst();
    a.load('text,tag,cannotEdit');
    await c.sync();
    a.cannotEdit = false;
    a.cannotDelete = false;
    await c.sync();
    a.load('tag,title,id');
    await c.sync();
    console.log('After unlock', { tag: a.tag, title: a.title, id: a.id });
    a.insertText('REF-NEW', 'Replace');
    await c.sync();
    a.load('text,tag');
    await c.sync();
    assert.equal(a.tag, 'reference');
    assert.equal(a.text, 'REF-NEW');
  });
  const reopened = await DocxEditor.createServer(await runtime.save());
  try {
    await reopened.run(async (c) => {
      const controls = c.document.contentControls;
      controls.load('items');
      await c.sync();
      for (const a of controls.items) a.load('text,tag');
      await c.sync();
      assert.deepEqual(
        controls.items.map((a) => [a.tag, a.text]),
        [
          ['client', '{{client}}'],
          ['reference', 'REF-NEW'],
        ]
      );
    });
  } finally {
    reopened.dispose();
  }
};
probes['comment-getfirst-load'] = async (runtime) => {
  await runtime.run(async (c) => {
    (await unique(c, 'Confidential material')).insertComment('Review confidentiality.');
    await c.sync();
    const first = c.document.comments.getFirst();
    first.load('text');
    await c.sync();
    assert.equal(first.text, 'Review confidentiality.');
  });
};
probes['lock-alias-batch'] = async (runtime) => {
  await runtime.run(async (c) => {
    const a = c.document.contentControls.getByTag('client').getFirst();
    const b = c.document.contentControls.getByTitle('client').getFirst();
    a.load('cannotEdit,cannotDelete');
    b.load('cannotEdit,cannotDelete');
    await c.sync();
    a.cannotEdit = true;
    b.cannotDelete = true;
    await c.sync();
    a.load('cannotEdit,cannotDelete');
    b.load('cannotEdit,cannotDelete');
    await c.sync();
    assert.equal(a.cannotEdit, true);
    assert.equal(a.cannotDelete, true);
    assert.equal(b.cannotEdit, true);
  });
};
probes['unlock-and-edit-batch'] = async (runtime) => {
  await runtime.run(async (c) => {
    const a = c.document.contentControls.getByTag('reference').getFirst();
    a.load('cannotEdit,cannotDelete');
    await c.sync();
    a.cannotEdit = false;
    a.cannotDelete = false;
    a.insertText('REF-NEW', 'Replace');
    await c.sync();
    a.load('text,cannotEdit,cannotDelete');
    await c.sync();
    assert.equal(a.text, 'REF-NEW');
    assert.equal(a.cannotEdit, false);
  });
};
probes['replace-returned-range'] = async (runtime) => {
  await runtime.run(async (c) => {
    const inserted = (await unique(c, 'support portal')).insertText(
      'customer help center',
      'Replace'
    );
    await c.sync();
    inserted.hyperlink = 'https://example.com/help';
    await c.sync();
    inserted.load('text,hyperlink');
    await c.sync();
    assert.equal(inserted.text, 'customer help center');
    assert.equal(inserted.hyperlink, 'https://example.com/help');
  });
};
probes['hyperlink-partial-retarget'] = async (runtime) => {
  await runtime.run(async (c) => {
    (await unique(c, 'support portal')).hyperlink = 'https://example.com/original';
    await c.sync();
    (await unique(c, 'portal')).hyperlink = 'https://example.com/updated';
    await c.sync();
    const support = await unique(c, 'support');
    const portal = await unique(c, 'portal');
    support.load('hyperlink,text');
    portal.load('hyperlink,text');
    await c.sync();
    assert.equal(support.hyperlink, 'https://example.com/original');
    assert.equal(portal.hyperlink, 'https://example.com/updated');
    portal.hyperlink = '';
    await c.sync();
  });
  const reopened = await DocxEditor.createServer(await runtime.save());
  try {
    await reopened.run(async (c) => {
      const support = await unique(c, 'support');
      const portal = await unique(c, 'portal');
      support.load('hyperlink');
      portal.load('hyperlink');
      await c.sync();
      assert.equal(support.hyperlink, 'https://example.com/original');
      assert.equal(portal.hyperlink, '');
    });
  } finally {
    reopened.dispose();
  }
};
probes['tracked-unsupported-rollback'] = async (runtime) => {
  const before = await text(runtime);
  await runtime.run(async (c) => {
    const target = await unique(c, 'within 7 days');
    c.document.changeTrackingMode = 'TrackMineOnly';
    target.insertText('within 30 days', 'Replace');
    target.font.bold = true;
    await assert.rejects(c.sync(), (e) => isDocxEditorError(e) && e.code === 'NotSupported');
    c.document.load('changeTrackingMode');
    c.document.body.load('text');
    await c.sync();
    assert.equal(c.document.changeTrackingMode, 'Off');
    assert.equal(c.document.body.text, before);
    (await unique(c, 'within 7 days')).insertText('within 14 days', 'Replace');
    await c.sync();
  });
};
probes['rollback-and-recovery'] = async (runtime) => {
  const before = await text(runtime);
  await runtime.run(async (c) => {
    const free = await unique(c, 'SERVICE AGREEMENT');
    const locked = c.document.contentControls.getByTag('reference').getFirst();
    locked.load('text');
    await c.sync();
    free.insertText('SHOULD ROLLBACK', 'Replace');
    locked.insertText('FORBIDDEN', 'Replace');
    await assert.rejects(c.sync(), (e) => isDocxEditorError(e));
    c.document.body.load('text');
    await c.sync();
    assert.equal(c.document.body.text, before);
    const fresh = await unique(c, 'SERVICE AGREEMENT');
    fresh.insertText('CONSULTING AGREEMENT', 'Replace');
    await c.sync();
    c.document.body.load('text');
    await c.sync();
    assert.ok(c.document.body.text.includes('CONSULTING AGREEMENT'));
  });
};
probes['reject-tracked-replacement'] = async (runtime) => {
  await runtime.run(async (c) => {
    const target = await unique(c, 'within 7 days');
    c.document.changeTrackingMode = 'TrackMineOnly';
    const changed = target.insertText('within 45 days', 'Replace');
    await c.sync();
    changed.load('text');
    await c.sync();
    assert.equal(changed.text, 'within 45 days');
    c.document.revisions.rejectAll();
    await c.sync();
  });
  assert.ok((await text(runtime)).includes('within 7 days'));
};
probes['comment-aliased-replies'] = async (runtime) => {
  await runtime.run(async (c) => {
    const root = (await unique(c, 'Confidential material')).insertComment(
      'Review confidentiality.'
    );
    await c.sync();
    const comments = c.document.comments;
    comments.load('items');
    await c.sync();
    const alias = comments.items[0]!;
    alias.load('text');
    await c.sync();
    root.reply('Legal approved.');
    alias.reply('Security approved.');
    try {
      await c.sync();
    } catch (error) {
      if (!isDocxEditorError(error) || error.code !== 'ConflictingChanges') throw error;
      const check = root.replies;
      check.load('items');
      await c.sync();
      assert.equal(check.items.length, 0, 'the refused reply batch is atomic');
      console.log('LIMIT: Replies to one thread need separate syncs.');
      root.reply('Legal approved.');
      await c.sync();
      alias.reply('Security approved.');
      await c.sync();
    }
    const replies = root.replies;
    replies.load('items');
    await c.sync();
    assert.equal(replies.items.length, 2);
    replies.items[0]!.delete();
    root.resolved = true;
    try {
      await c.sync();
    } catch (error) {
      if (!isDocxEditorError(error) || error.code !== 'ConflictingChanges') throw error;
      replies.load('items');
      await c.sync();
      assert.equal(replies.items.length, 2, 'delete and resolve rolled back together');
      replies.items[0]!.delete();
      await c.sync();
      root.resolved = true;
      await c.sync();
    }
    replies.load('items');
    root.load('resolved');
    await c.sync();
    assert.equal(replies.items.length, 1);
    assert.equal(root.resolved, true);
  });
  const reopened = await DocxEditor.createServer(await runtime.save());
  try {
    await reopened.run(async (c) => {
      const comments = c.document.comments;
      comments.load('items');
      await c.sync();
      const root = comments.items[0]!;
      root.load('resolved');
      const replies = root.replies;
      replies.load('items');
      await c.sync();
      assert.equal(root.resolved, true);
      assert.equal(replies.items.length, 1);
      replies.items[0]!.load('text');
      await c.sync();
      assert.equal(replies.items[0]!.text, 'Security approved.');
    });
  } finally {
    reopened.dispose();
  }
};

if (import.meta.main) {
  const filter = process.argv[2];
  let failures = 0;
  for (const [name, probe] of Object.entries(probes)) {
    if (filter && filter !== name) continue;
    const runtime = await DocxEditor.createServer(contractFixture(), {
      author: 'Contract automation',
    });
    try {
      await probe(runtime);
      console.log(`PASS ${name}`);
    } catch (e) {
      failures++;
      console.error(`FAIL ${name}`, e);
      const dir = join(tmpdir(), 'fresh-contract-agent');
      await mkdir(dir, { recursive: true });
      const before = contractFixture();
      const after = await runtime.save();
      await writeFile(
        join(dir, `${name}.input.xml`),
        strFromU8(unzipSync(before)['word/document.xml']!)
      );
      await writeFile(
        join(dir, `${name}.actual.xml`),
        strFromU8(unzipSync(after)['word/document.xml']!)
      );
      await writeFile(join(dir, `${name}.actual.docx`), after);
    } finally {
      runtime.dispose();
    }
  }
  process.exitCode = failures ? 1 : 0;
}
