/** Deterministic consumer agent. Document edits use only public Office-shaped APIs. */
import {
  DocxEditor,
  isDocxEditorError,
  type DocxEditorRuntime,
  type RequestContext,
  type Range,
} from '@docx-editor.dev/editor-api';
import { zipSync, strToU8 } from 'fflate';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';

const failures: { operation: string; code: string; target: string | undefined }[] = [];

export type ContractAction =
  | {
      kind: 'replace';
      quote: string;
      occurrence: number;
      expectedCount: number;
      text: string;
      tracked?: boolean;
    }
  | { kind: 'appendClause'; after: string; text: string }
  | { kind: 'deleteClause'; text: string }
  | { kind: 'hyperlink'; quote: string; url: string }
  | {
      kind: 'field';
      quote: string;
      tag: string;
      title: string;
      text: string;
      type: 'RichText' | 'PlainText';
    }
  | { kind: 'comment'; quote: string; text: string; reply: string; resolved: boolean };

async function exact(
  context: RequestContext,
  quote: string,
  occurrence = 0,
  expectedCount = 1
): Promise<Range> {
  const matches = context.document.body.search(quote, { matchCase: true });
  matches.load('items');
  await context.sync(); // Read exact candidates before making the agent's targeting decision.
  assert.equal(matches.items.length, expectedCount, `Ambiguous anchor: ${quote}`);
  assert.ok(
    occurrence >= 0 && occurrence < matches.items.length,
    'Occurrence is outside the matched set'
  );
  return matches.items[occurrence]!;
}

export async function executeContractPlan(
  runtime: DocxEditorRuntime,
  plan: readonly ContractAction[]
) {
  for (const action of plan) {
    await runtime.run(async (context) => {
      context.document.changeTrackingMode =
        action.kind === 'replace' && action.tracked ? 'TrackMineOnly' : 'Off';
      // Each action is an intentional, separately reviewable edit. Re-anchor after preceding edits.
      if (action.kind === 'replace') {
        assert.ok(action.text.length > 0, 'Use an explicit deletion action');
        const range = await exact(context, action.quote, action.occurrence, action.expectedCount);
        range.insertText(action.text, 'Replace');
      } else if (action.kind === 'appendClause') {
        (await exact(context, action.after)).insertParagraph(action.text, 'After');
      } else if (action.kind === 'deleteClause') {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        for (const p of paragraphs.items) p.load('text');
        await context.sync();
        const matches = paragraphs.items.filter((p) => p.text === action.text);
        assert.equal(matches.length, 1);
        matches[0]!.delete();
      } else if (action.kind === 'hyperlink') {
        (await exact(context, action.quote)).hyperlink = action.url;
      } else if (action.kind === 'field') {
        const control = (await exact(context, action.quote)).insertContentControl(action.type);
        await context.sync(); // Insert-returned proxies need this boundary before configuration.
        control.tag = action.tag;
        control.title = action.title;
        await context.sync();
        control.insertText(action.text, 'Replace');
      } else {
        const comment = (await exact(context, action.quote)).insertComment(action.text);
        await context.sync();
        comment.reply(action.reply);
        await context.sync();
        comment.resolved = action.resolved;
      }
      await context.sync(); // Commit this complete action before reading the next action's anchors.
    });
  }
}

const plan: ContractAction[] = [
  { kind: 'replace', quote: '30 days', occurrence: 1, expectedCount: 3, text: '45 days' },
  { kind: 'appendClause', after: 'Contract heading', text: 'New confidentiality clause.' },
  { kind: 'deleteClause', text: 'DELETE THIS DRAFT CLAUSE' },
  { kind: 'hyperlink', quote: 'Policy portal', url: 'https://example.com/contract-policy' },
  {
    kind: 'field',
    quote: 'CLIENT_PLACEHOLDER',
    tag: 'client',
    title: 'Client legal name',
    text: 'Acme Research',
    type: 'PlainText',
  },
  {
    kind: 'field',
    quote: 'SERVICE_PLACEHOLDER',
    tag: 'service',
    title: 'Service description',
    text: 'Document review',
    type: 'RichText',
  },
  {
    kind: 'comment',
    quote: 'Liability cap is 100.',
    text: 'Please approve this limit.',
    reply: 'Approved for review.',
    resolved: true,
  },
  { kind: 'replace', quote: '100', occurrence: 0, expectedCount: 1, text: '200', tracked: true },
];

function fixture(): Uint8Array {
  const texts = [
    'Contract heading',
    'Payment: 30 days; renewal: 30 days.',
    'Other agreement: 30 days.',
    'DELETE THIS DRAFT CLAUSE',
    'Policy portal',
    'CLIENT_PLACEHOLDER',
    'SERVICE_PLACEHOLDER',
    'Liability cap is 100.',
  ];
  const paragraphs = texts.map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:p><w:bookmarkStart w:id="71" w:name="untouched_sentinel"/><w:r><w:t>SENTINEL KEEP EXACTLY</w:t></w:r><w:bookmarkEnd w:id="71"/></w:p><w:sectPr/></w:body></w:document>`
    ),
  });
}

async function snapshot(runtime: DocxEditorRuntime) {
  return runtime.run(async (context) => {
    const d = context.document;
    d.body.load('text');
    d.contentControls.load('items');
    d.comments.load('items');
    d.revisions.load('items');
    d.body.bookmarks.load('items');
    await context.sync();
    for (const c of d.contentControls.items)
      c.load('tag,title,text,subtype,cannotEdit,cannotDelete');
    for (const c of d.comments.items) {
      c.load('text,resolved');
      c.replies.load('items');
    }
    for (const r of d.revisions.items) r.load('type,author');
    for (const b of d.body.bookmarks.items) b.load('name');
    await context.sync();
    for (const c of d.comments.items) for (const r of c.replies.items) r.load('text');
    await context.sync();
    return {
      text: d.body.text,
      controls: d.contentControls.items.map((c) => ({
        tag: c.tag,
        title: c.title,
        text: c.text,
        subtype: c.subtype,
        cannotEdit: c.cannotEdit,
        cannotDelete: c.cannotDelete,
      })),
      comments: d.comments.items.map((c) => ({
        text: c.text,
        resolved: c.resolved,
        replies: c.replies.items.map((r) => r.text),
      })),
      revisions: d.revisions.items.map((r) => ({ type: r.type, author: r.author })),
      bookmarks: d.body.bookmarks.items.map((b) => b.name),
    };
  });
}

export async function runContractAgent() {
  const out = '/tmp/editor-api-consumers/contract';
  await mkdir(out, { recursive: true });
  await rm(`${out}/unlock-failure.json`, { force: true });
  const input = fixture();
  await writeFile(`${out}/input.docx`, input);
  const runtime = await DocxEditor.createServer(input, { author: 'Contract Agent' });
  try {
    await executeContractPlan(runtime, plan);
    const pending = await runtime.save();
    await writeFile(`${out}/pending.docx`, pending);
    const original = await DocxEditor.createServer(pending, { revisionTextView: 'original' });
    try {
      const originalSnapshot = await snapshot(original);
      assert.ok(originalSnapshot.text.includes('Liability cap is 100.'));
      await writeFile(`${out}/original-snapshot.json`, JSON.stringify(originalSnapshot, null, 2));
    } finally {
      original.dispose();
    }
    const reopened = await DocxEditor.createServer(pending, { author: 'Contract Agent' });
    try {
      const result = await snapshot(reopened);
      assert.ok(result.text.includes('Payment: 30 days; renewal: 45 days.'));
      assert.ok(result.text.includes('Other agreement: 30 days.'));
      assert.ok(result.text.includes('New confidentiality clause.'));
      assert.ok(!result.text.includes('DELETE THIS DRAFT CLAUSE'));
      assert.deepEqual(result.bookmarks, ['untouched_sentinel']);
      assert.ok(result.text.includes('SENTINEL KEEP EXACTLY'));
      assert.equal(result.controls.length, 2);
      assert.deepEqual(
        result.controls.map((c) => [c.tag, c.text]),
        [
          ['client', 'Acme Research'],
          ['service', 'Document review'],
        ]
      );
      assert.deepEqual(result.comments, [
        { text: 'Please approve this limit.', resolved: true, replies: ['Approved for review.'] },
      ]);
      assert.equal(result.revisions.length, 1);
      await reopened.run(async (context) => {
        const r = await exact(context, 'Policy portal');
        r.load('hyperlink');
        await context.sync();
        assert.equal(r.hyperlink, 'https://example.com/contract-policy');
      });
      await writeFile(`${out}/pending-snapshot.json`, JSON.stringify(result, null, 2));
    } finally {
      reopened.dispose();
    }
    return { out, pending, runtime };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

async function verifyReviewDecisions(bytes: Uint8Array, out: string) {
  for (const decision of ['accept', 'reject', 'acceptAll', 'rejectAll'] as const) {
    const rt = await DocxEditor.createServer(bytes, { author: 'Contract Agent' });
    try {
      await rt.run(async (context) => {
        const revisions = context.document.revisions;
        if (decision === 'acceptAll' || decision === 'rejectAll') revisions[decision]();
        else {
          revisions.load('items');
          await context.sync();
          for (const revision of revisions.items) revision[decision]();
        }
        await context.sync();
      });
      const saved = await rt.save();
      await writeFile(`${out}/${decision}.docx`, saved);
      const reopened = await DocxEditor.createServer(saved);
      try {
        const result = await snapshot(reopened);
        assert.equal(result.revisions.length, 0);
        assert.ok(
          result.text.includes(`Liability cap is ${decision.startsWith('accept') ? '200' : '100'}.`)
        );
        assert.deepEqual(result.bookmarks, ['untouched_sentinel']);
        assert.equal(result.comments.length, 1);
        await writeFile(`${out}/${decision}-snapshot.json`, JSON.stringify(result, null, 2));
      } finally {
        reopened.dispose();
      }
    } finally {
      rt.dispose();
    }
  }
}

async function verifyControlAndCommentLifecycle(bytes: Uint8Array, out: string) {
  const rt = await DocxEditor.createServer(bytes, { author: 'Contract Agent' });
  try {
    await rt.run(async (context) => {
      const controls = context.document.contentControls.getByTag('client');
      controls.load('items');
      await context.sync();
      assert.equal(controls.items.length, 1);
      controls.items[0]!.cannotEdit = true;
      controls.items[0]!.cannotDelete = true;
      await context.sync();
    });
    await writeFile(`${out}/locked.docx`, await rt.save());
    const before = await snapshot(rt);
    assert.equal(before.controls[0]!.cannotEdit, true);
    assert.equal(before.controls[0]!.cannotDelete, true);
    const refusals: unknown[] = [];
    for (const operation of ['fill', 'delete'] as const) {
      try {
        await rt.run(async (context) => {
          const controls = context.document.contentControls.getByTag('client');
          controls.load('items');
          await context.sync();
          if (operation === 'fill') controls.items[0]!.insertText('FORBIDDEN', 'Replace');
          else controls.items[0]!.delete(false);
          await context.sync();
        });
        assert.fail(`Locked control allowed ${operation}`);
      } catch (error) {
        if (!isDocxEditorError(error)) throw error;
        refusals.push({ operation, code: error.code, target: error.target });
      }
      assert.deepEqual(await snapshot(rt), before, 'Refused control operation changed document');
    }
    try {
      await rt.run(async (context) => {
        const controls = context.document.contentControls.getByTag('client');
        controls.load('items');
        await context.sync();
        controls.items[0]!.cannotEdit = false;
        controls.items[0]!.cannotDelete = false;
        await context.sync();
      });
    } catch (error) {
      if (!isDocxEditorError(error)) throw error;
      failures.push({ operation: 'unlock control', code: error.code, target: error.target });
      await writeFile(
        `${out}/unlock-failure.json`,
        JSON.stringify({ code: error.code, target: error.target, message: error.message }, null, 2)
      );
      console.error('KNOWN FAILURE: unlocking protected control:', error.code, error.target);
    }
    if (!failures.some((failure) => failure.operation === 'unlock control')) {
      await rt.run(async (context) => {
        const controls = context.document.contentControls.getByTag('client');
        controls.load('items');
        await context.sync();
        controls.items[0]!.insertText('Server unlocked client', 'Replace');
        await context.sync();
      });
      const saved = await rt.save();
      await writeFile(`${out}/unlocked.docx`, saved);
      const unlocked = await DocxEditor.createServer(saved);
      try {
        const result = await snapshot(unlocked);
        assert.equal(result.controls[0]!.text, 'Server unlocked client');
        assert.equal(result.controls[0]!.cannotEdit, false);
        assert.equal(result.controls[0]!.cannotDelete, false);
        assert.deepEqual(result.bookmarks, ['untouched_sentinel']);
        await writeFile(`${out}/unlocked-snapshot.json`, JSON.stringify(result, null, 2));
      } finally {
        unlocked.dispose();
      }
    }
    await writeFile(`${out}/lock-refusals.json`, JSON.stringify(refusals, null, 2));
  } finally {
    rt.dispose();
  }
  // A separate lifecycle case starts from the original pending artifact. It does not bypass the failed lock operation.
  const cleanup = await DocxEditor.createServer(bytes, { author: 'Contract Agent' });
  try {
    await cleanup.run(async (context) => {
      const controls = context.document.contentControls.getByTag('client');
      controls.load('items');
      await context.sync();
      controls.items[0]!.delete(true);
      await context.sync();
      const services = context.document.contentControls.getByTag('service');
      services.load('items');
      await context.sync();
      services.items[0]!.delete(false);
      await context.sync();
    });
    await cleanup.run(async (context) => {
      const comments = context.document.comments;
      comments.load('items');
      await context.sync();
      const comment = comments.items[0]!;
      comment.replies.load('items');
      await context.sync();
      comment.replies.items[0]!.delete();
      await context.sync();
    });
    const withoutReply = await snapshot(cleanup);
    assert.deepEqual(withoutReply.comments[0]!.replies, []);
    await cleanup.run(async (context) => {
      const comments = context.document.comments;
      comments.load('items');
      await context.sync();
      comments.items[0]!.delete();
      await context.sync();
    });
    const saved = await cleanup.save();
    await writeFile(`${out}/cleanup.docx`, saved);
    const reopened = await DocxEditor.createServer(saved);
    try {
      const result = await snapshot(reopened);
      assert.equal(result.controls.length, 0);
      assert.equal(result.comments.length, 0);
      assert.ok(result.text.includes('Acme Research'));
      assert.ok(!result.text.includes('Document review'));
      assert.deepEqual(result.bookmarks, ['untouched_sentinel']);
      await writeFile(`${out}/cleanup-snapshot.json`, JSON.stringify(result, null, 2));
    } finally {
      reopened.dispose();
    }
  } finally {
    cleanup.dispose();
  }
}

async function verifyBrowser() {
  // A DOM emulator exercises the public browser host. This does not test native rendering.
  const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
  GlobalRegistrator.register();
  const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
  const { reviewModule } = await import('@docx-editor.dev/pro');
  const { DocxEditor: BrowserDocxEditor } = await import('@docx-editor.dev/editor-api/browser');
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    document: fixture(),
    modules: [reviewModule()],
    author: 'Contract Agent',
  });
  editor.attach(container);
  const runtime = BrowserDocxEditor.createBrowser(editor, { author: 'Contract Agent' });
  try {
    await executeContractPlan(runtime, plan);
    const bytes = new Uint8Array(await editor.save());
    const out = '/tmp/editor-api-consumers/contract';
    await writeFile(`${out}/browser-pending.docx`, bytes);
    const reopened = await DocxEditor.createServer(bytes, { author: 'Contract Agent' });
    try {
      const actual = await snapshot(reopened);
      const expected = await Bun.file(`${out}/pending-snapshot.json`).json();
      assert.deepEqual(actual, expected, 'Browser and server semantic snapshots differ');
      await writeFile(`${out}/browser-pending-snapshot.json`, JSON.stringify(actual, null, 2));
    } finally {
      reopened.dispose();
    }
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'Off';
      const controls = context.document.contentControls.getByTag('client');
      controls.load('items');
      await context.sync();
      controls.items[0]!.cannotEdit = true;
      controls.items[0]!.cannotDelete = true;
      await context.sync();
    });
    const lockedSnapshot = await snapshot(runtime);
    for (const operation of ['fill', 'delete'] as const) {
      await assert.rejects(
        runtime.run(async (context) => {
          const controls = context.document.contentControls.getByTag('client');
          controls.load('items');
          await context.sync();
          if (operation === 'fill') controls.items[0]!.insertText('FORBIDDEN', 'Replace');
          else controls.items[0]!.delete(false);
          await context.sync();
        }),
        (error) => isDocxEditorError(error)
      );
      assert.deepEqual(await snapshot(runtime), lockedSnapshot);
    }
    await runtime.run(async (context) => {
      const controls = context.document.contentControls.getByTag('client');
      controls.load('items');
      await context.sync();
      controls.items[0]!.cannotEdit = false;
      controls.items[0]!.cannotDelete = false;
      await context.sync();
      controls.items[0]!.insertText('Browser unlocked client', 'Replace');
      await context.sync();
    });
    const unlockedBytes = new Uint8Array(await editor.save());
    await writeFile(`${out}/browser-unlocked.docx`, unlockedBytes);
    const unlocked = await DocxEditor.createServer(unlockedBytes);
    try {
      const result = await snapshot(unlocked);
      assert.equal(result.controls[0]!.text, 'Browser unlocked client');
      assert.equal(result.controls[0]!.cannotEdit, false);
      assert.equal(result.controls[0]!.cannotDelete, false);
      assert.deepEqual(result.bookmarks, ['untouched_sentinel']);
      await writeFile(`${out}/browser-unlocked-snapshot.json`, JSON.stringify(result, null, 2));
    } finally {
      unlocked.dispose();
    }
  } finally {
    runtime.dispose();
    editor.destroy();
    container.remove();
    await GlobalRegistrator.unregister();
  }
}

if (import.meta.main) {
  try {
    const result = await runContractAgent();
    result.runtime.dispose();
    await verifyReviewDecisions(result.pending, result.out);
    await verifyControlAndCommentLifecycle(result.pending, result.out);
    if (process.argv.includes('--browser')) await verifyBrowser();
    const evidence = {
      status: failures.length ? 'FAIL' : 'PASS',
      failures,
      browser: process.argv.includes('--browser'),
      artifacts: result.out,
    };
    await writeFile(`${result.out}/run-result.json`, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(
      isDocxEditorError(error)
        ? { code: error.code, target: error.target, message: error.message }
        : error
    );
    process.exitCode = 1;
  }
}
