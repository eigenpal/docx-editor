/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `runtime.run({ historyGroup }, callback)`: a browser automation run joins an editor history
// group, so a review decision made partly through the editor and partly through this API is
// one undo step. Hosts with no editor history refuse the option; nothing approximates it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../../index.ts';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import type { HistoryGroup, RequestContext } from '../../index.ts';
import { reviewModule } from '../../../../pro/src/review/review-module.ts';
import { docx, p } from './support/docx.ts';

const DATE = '2026-01-01T00:00:00Z';
const BODY =
  '<w:p><w:r><w:t xml:space="preserve">Payment is due in </w:t></w:r>' +
  `<w:ins w:id="1" w:author="Counterparty" w:date="${DATE}"><w:r><w:t>30</w:t></w:r></w:ins>` +
  '<w:r><w:t xml:space="preserve"> days.</w:t></w:r></w:p>' +
  p('Delivery is free.');

function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(BODY),
    author: 'Reviewer',
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  const runtime = DocxEditorBrowser.createBrowser(editor, { author: 'Reviewer' });
  return {
    editor,
    runtime,
    dispose() {
      runtime.dispose();
      editor.destroy();
      container.remove();
    },
  };
}

async function saved(editor: DocxEditorInstance): Promise<string> {
  const files = unzipSync(new Uint8Array(await editor.save()));
  const comments = files['word/comments.xml'];
  return strFromU8(files['word/document.xml']!) + (comments ? strFromU8(comments) : '');
}

async function replaceDelivery(context: RequestContext): Promise<void> {
  const ranges = context.document.body.search('free', { matchCase: true });
  ranges.load('items');
  await context.sync();
  const inserted = ranges.items[0]!.insertText('charged at cost', 'Replace');
  await context.sync();
  inserted.insertComment('Counter-proposal for delivery.');
  await context.sync();
}

function selectDelivery(editor: DocxEditorInstance): void {
  const id = editor.surface!.session.paragraphIds()[1]!;
  editor.surface!.setSelection({
    anchor: { paragraphId: id, offset: 0 },
    head: { paragraphId: id, offset: 8 },
  });
}

describe('runtime.run({ historyGroup })', () => {
  test('editor writes and every sync of the run are one undo step and one redo step', async () => {
    const mounted = mount();
    try {
      const { editor, runtime } = mounted;
      const before = await saved(editor);
      const decision = editor.beginHistoryGroup();
      expect(
        editor.exec(
          { type: 'resolveAllReviewChanges', action: 'reject', scope: 'document' },
          { historyGroup: decision }
        )
      ).toMatchObject({ ok: true, history: { kind: 'started' } });
      await runtime.run({ historyGroup: decision }, replaceDelivery);
      selectDelivery(editor);
      expect(
        editor.addComment('Decision recorded.', undefined, { historyGroup: decision })
      ).toMatchObject({ ok: true, history: { kind: 'extended' } });
      decision.end();
      const after = await saved(editor);
      expect(after).toContain('charged at cost');
      expect(after).toContain('Counter-proposal for delivery.');
      expect(after).toContain('Decision recorded.');
      expect(after).not.toContain('Counterparty');

      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(before);
      expect(editor.snapshot().canUndo).toBe(false);
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(after);
    } finally {
      mounted.dispose();
    }
  });

  test('a run without the option never joins an open group', async () => {
    const mounted = mount();
    try {
      const { editor, runtime } = mounted;
      const decision = editor.beginHistoryGroup();
      editor.exec(
        { type: 'resolveAllReviewChanges', action: 'reject', scope: 'document' },
        { historyGroup: decision }
      );
      const resolved = await saved(editor);
      await runtime.run(replaceDelivery);
      // Each sync of the ungrouped run is its own step; the group's step stays below them.
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(resolved);
      expect(editor.snapshot().canUndo).toBe(true);
    } finally {
      mounted.dispose();
    }
  });

  test('a closed handle refuses before the callback runs', async () => {
    const mounted = mount();
    try {
      const { editor, runtime } = mounted;
      const ended = editor.beginHistoryGroup();
      ended.end();
      let called = false;
      const refused = await runtime
        .run({ historyGroup: ended }, async () => {
          called = true;
        })
        .catch((error: unknown) => error);
      expect(refused).toMatchObject({ code: 'InvalidArgument', target: 'historyGroup' });
      expect(called).toBe(false);
    } finally {
      mounted.dispose();
    }
  });

  test('a handle from another editor refuses before the callback runs', async () => {
    const mounted = mount();
    const other = mount();
    try {
      let called = false;
      const refused = await mounted.runtime
        .run({ historyGroup: other.editor.beginHistoryGroup() }, async () => {
          called = true;
        })
        .catch((error: unknown) => error);
      expect(refused).toMatchObject({ code: 'InvalidArgument', target: 'historyGroup' });
      expect(called).toBe(false);
    } finally {
      other.dispose();
      mounted.dispose();
    }
  });

  test('a handle that closes during the run refuses at sync and writes nothing', async () => {
    const mounted = mount();
    const other = mount();
    try {
      const { editor, runtime } = mounted;
      const before = await saved(editor);
      const decision = editor.beginHistoryGroup();
      const closing = await runtime
        .run({ historyGroup: decision }, async (context) => {
          context.document.body.insertParagraph('Never written.', 'End');
          decision.end();
          await context.sync();
        })
        .catch((error: unknown) => error);
      expect(closing).toMatchObject({ code: 'InvalidArgument', target: 'historyGroup' });
      expect(await saved(editor)).toBe(before);
      expect(editor.snapshot().canUndo).toBe(false);
    } finally {
      other.dispose();
      mounted.dispose();
    }
  });

  test('a server runtime refuses the option with NotSupported', async () => {
    const runtime = await DocxEditor.createServer(docx(p('Alpha')));
    try {
      // The server refuses any handle; a real one needs an editor this test does not mount.
      const group = { state: 'open', lastOutcome: null, end() {} } as unknown as HistoryGroup;
      const refused = await runtime
        .run({ historyGroup: group }, async () => undefined)
        .catch((error: unknown) => error);
      expect(refused).toMatchObject({ code: 'NotSupported', target: 'historyGroup' });
      // Options without a group run as an ordinary batch.
      expect(await runtime.run({}, async () => 'ran')).toBe('ran');
    } finally {
      runtime.dispose();
    }
  });

  test('a run reports its outcome on the handle and a later split is detected', async () => {
    const mounted = mount();
    try {
      const { editor, runtime } = mounted;
      const diagnostics: unknown[] = [];
      editor.on('historyDiagnostic', (diagnostic) => diagnostics.push(diagnostic));
      const decision = editor.beginHistoryGroup();
      expect(decision.lastOutcome).toBeNull();
      await runtime.run({ historyGroup: decision }, async (context) => {
        context.document.body.insertParagraph('First.', 'End');
        await context.sync();
        // A run settles once, after its last sync.
        expect(decision.lastOutcome).toBeNull();
        context.document.body.insertParagraph('Second.', 'End');
        await context.sync();
      });
      // The whole run is one write of the group.
      expect(decision.lastOutcome).toEqual({ kind: 'started' });
      // An ungrouped write closes the group under the run's writes.
      selectDelivery(editor);
      expect(editor.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
      expect(
        editor.exec(
          { type: 'resolveAllReviewChanges', action: 'reject', scope: 'document' },
          { historyGroup: decision }
        )
      ).toMatchObject({ ok: true, history: { kind: 'split', reason: 'history-boundary' } });
      expect(decision.lastOutcome).toMatchObject({ kind: 'split' });
      expect(diagnostics).toEqual([{ kind: 'split', reason: 'history-boundary' }]);
      // And a run after an ungrouped write reports the split itself.
      expect(editor.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
      await runtime.run({ historyGroup: decision }, async (context) => {
        context.document.body.insertParagraph('Later.', 'End');
        await context.sync();
      });
      expect(decision.lastOutcome).toMatchObject({ kind: 'split' });
      expect(diagnostics).toHaveLength(2);
    } finally {
      mounted.dispose();
    }
  });

  for (const where of ['before the run', 'between two syncs of the run'] as const) {
    test(`a split ${where} is the run's outcome even when a later sync extends`, async () => {
      const mounted = mount();
      try {
        const { editor, runtime } = mounted;
        const diagnostics: unknown[] = [];
        editor.on('historyDiagnostic', (diagnostic) => diagnostics.push(diagnostic));
        const decision = editor.beginHistoryGroup();
        await runtime.run({ historyGroup: decision }, async (context) => {
          context.document.body.insertParagraph('A.', 'End');
          await context.sync();
        });
        const ungrouped = () => {
          selectDelivery(editor);
          expect(editor.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
        };
        if (where === 'before the run') ungrouped();
        await runtime.run({ historyGroup: decision }, async (context) => {
          context.document.body.insertParagraph('B.', 'End');
          await context.sync();
          if (where !== 'before the run') {
            ungrouped();
            // Read again so the next write is not refused as stale.
            const paragraphs = context.document.body.paragraphs;
            paragraphs.load('items');
            await context.sync();
          }
          context.document.body.insertParagraph('C.', 'End');
          await context.sync();
        });
        decision.end();
        expect(decision.lastOutcome).toMatchObject({ kind: 'split' });
        expect(diagnostics).toHaveLength(1);
        let undos = 0;
        while (editor.snapshot().canUndo && undos < 10) {
          editor.exec({ type: 'undo' });
          undos += 1;
        }
        expect(undos).toBe(3);
      } finally {
        mounted.dispose();
      }
    });
  }

  test('an options object with any prototype is options, never an object to adopt', async () => {
    const mounted = mount();
    try {
      class Options {
        readonly previousObjects = undefined;
      }
      expect(await mounted.runtime.run(new Options(), async () => 'ran')).toBe('ran');
      expect(await mounted.runtime.run(Object.create(null), async () => 'ran')).toBe('ran');
    } finally {
      mounted.dispose();
    }
  });

  test('the documented review decision runs as written and is one undo step', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: docx(
        p('Payment is due in 30 days.') +
          `<w:p><w:ins w:id="1" w:author="Counterparty" w:date="${DATE}"><w:r><w:t>Delivery is free.</w:t></w:r></w:ins></w:p>`
      ),
      author: 'Reviewer',
      modules: [reviewModule()],
    });
    const runtime = DocxEditorBrowser.createBrowser(editor, { author: 'Reviewer' });
    try {
      const before = await saved(editor);
      const keys = editor
        .getReviewItems()
        .filter((item) => item.kind === 'revision' && item.item.author === 'Counterparty')
        .map((item) => item.key);
      expect(keys).toHaveLength(1);
      // The example from docs/site/content/core/index.mdx, "Group a review decision".
      const decision = editor.beginHistoryGroup();
      try {
        const resolved = editor.exec(
          { type: 'resolveAllReviewChanges', action: 'reject', keys },
          { historyGroup: decision }
        );
        if (!resolved.ok) throw new Error(resolved.reason);
        await runtime.run({ historyGroup: decision }, async (context) => {
          const ranges = context.document.body.search('30 days');
          ranges.load('items');
          await context.sync();
          const target = ranges.items[0];
          if (!target) throw new Error('The document has no "30 days" text.');
          const replaced = target.insertText('45 days', 'Replace');
          await context.sync();
          replaced.insertComment('Counter-proposal: 45 days.');
          await context.sync();
        });
      } finally {
        decision.end();
      }
      const after = await saved(editor);
      expect(after).toContain('45 days');
      expect(after).toContain('Counter-proposal: 45 days.');
      expect(after).not.toContain('Delivery is free.');
      expect(decision.lastOutcome).toEqual({ kind: 'extended' });
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(before);
      expect(editor.snapshot().canUndo).toBe(false);
    } finally {
      runtime.dispose();
      editor.destroy();
      container.remove();
    }
  });

  test('the agent guide example runs as written and is one undo step', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: docx(
        p('Payment is due in 30 days.') +
          `<w:p><w:ins w:id="1" w:author="Counterparty" w:date="${DATE}"><w:r><w:t>Delivery is free.</w:t></w:r></w:ins></w:p>`
      ),
      author: 'Reviewer',
      modules: [reviewModule()],
    });
    const runtime = DocxEditorBrowser.createBrowser(editor, { author: 'Reviewer' });
    try {
      const before = await saved(editor);
      const key = editor.getReviewItems()[0]!.key;
      // The example from packages/editor-api/OFFICE_JS_GUIDE.md.
      const decision = editor.beginHistoryGroup();
      try {
        // Reply first: the card's key no longer exists after the change is accepted.
        const reply = editor.replyToReviewItem(key, 'Accepted; see the new term.', {
          historyGroup: decision,
        });
        const accepted = editor.acceptReviewItem(key, { historyGroup: decision });
        if (!reply.ok || !accepted.ok) throw new Error('The review card was refused.');
        await runtime.run({ historyGroup: decision }, async (context) => {
          const ranges = context.document.body.search('30 days');
          ranges.load('items');
          await context.sync();
          const target = ranges.items[0];
          if (!target) throw new Error('The document has no "30 days" text.');
          target.insertText('45 days', 'Replace');
          await context.sync();
        });
      } finally {
        decision.end();
      }
      const after = await saved(editor);
      expect(after).toContain('45 days');
      expect(after).toContain('Accepted; see the new term.');
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(await saved(editor)).toBe(before);
      expect(editor.snapshot().canUndo).toBe(false);
    } finally {
      runtime.dispose();
      editor.destroy();
      container.remove();
    }
  });
});
