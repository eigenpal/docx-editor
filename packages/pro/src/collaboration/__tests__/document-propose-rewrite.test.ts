/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The rewrite helper of `@docx-editor.dev/editor-api/agent` in a collaboration room.
//
// A participant edits between two of the helper's writes: the next write fails with
// `StaleDocument`, the helper rejects only its own changes on both peers, keeps the
// participant's edit, and the rewrite succeeds when it runs again. A participant who edits while
// the model is thinking makes the first write fail before anything lands, and `proposeRewrite`
// prepares the paragraph again and asks the model again on its own.
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { RequestContext, type DocxEditorRuntime } from '@docx-editor.dev/editor-api/browser';
import { prepareRewrite, proposeRewrite, RewriteError } from '@docx-editor.dev/editor-api/agent';
import { converged, COUNTERPARTY, REVIEWER, room } from './tracked-foreign-revisions-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const BODY =
  '<w:p><w:r><w:t xml:space="preserve">Alpha beta gamma delta.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Second clause.</w:t></w:r></w:p>';
const ORIGINAL = 'Alpha beta gamma delta.';
const MODEL = 'Alpha BETA gamma DELTA.';

/** A context whose `sync()` runs `between` once, before the sync numbered `at`. */
function interrupted(context: RequestContext, at: number, between: () => Promise<void>) {
  let count = 0;
  return new Proxy(context, {
    get(target, key) {
      if (key === 'sync') {
        return async () => {
          count += 1;
          if (count === at) await between();
          return RequestContext.prototype.sync.call(target);
        };
      }
      const value = Reflect.get(target, key) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function state(runtime: DocxEditorRuntime) {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    const first = paragraphs.items[0]!.getReviewedText('Current');
    const second = paragraphs.items[1]!.getReviewedText('Current');
    const revisions = context.document.body.revisions;
    revisions.load('items/author,items/type');
    context.document.load('changeTrackingMode');
    await context.sync();
    return {
      first: first.value,
      second: second.value,
      revisions: revisions.items.map((item) => `${item.author}:${item.type}`).sort(),
      tracking: context.document.changeTrackingMode,
    };
  });
}

for (const [where, edit] of [
  ['the next paragraph', 'other'],
  ['the same paragraph', 'same'],
] as const) {
  test(`a participant's edit in ${where} mid-apply rolls back only the helper's changes`, async () => {
    const r = await room('reviewer first', BODY);
    try {
      const [alice, bob] = r.peers;
      const peerEdit = async () => {
        await bob!.runtime.run(async (context) => {
          context.document.changeTrackingMode = 'TrackMineOnly';
          const paragraphs = context.document.body.paragraphs;
          if (edit === 'other') paragraphs.getLast().insertText(' Noted.', 'End');
          else paragraphs.getFirst().insertText('Note: ', 'Start');
          await context.sync();
        });
        r.sync();
      };
      const failure = await alice!.runtime
        .run(async (context) => {
          // Syncs 1 to 6 prepare, 7 and 8 turn tracking on, and 9 lists the revisions. The last
          // hunk writes at 10 and reads back at 11 and 12; the participant edits before sync 13,
          // which writes the first hunk.
          const paused = interrupted(context, 13, peerEdit);
          const draft = await prepareRewrite(paused, paused.document.body.paragraphs.getFirst());
          await draft.apply(MODEL);
        })
        .then(
          () => null,
          (error: unknown) => error
        );
      expect(failure).toBeInstanceOf(RewriteError);
      expect(failure).toMatchObject({ code: 'stale', cause: { code: 'StaleDocument' } });
      r.sync();
      await converged(r);
      const expectedFirst = edit === 'same' ? `Note: ${ORIGINAL}` : ORIGINAL;
      const expectedSecond = edit === 'other' ? 'Second clause. Noted.' : 'Second clause.';
      for (const peer of r.peers) {
        expect(await state(peer.runtime)).toMatchObject({
          first: expectedFirst,
          second: expectedSecond,
          revisions: [`${COUNTERPARTY}:Insert`],
        });
      }
      // The helper turned tracking off again on its own runtime.
      expect((await state(alice!.runtime)).tracking).toBe('Off');

      // A new rewrite reads the new document. The participant's pending insertion in the same
      // paragraph refuses it until someone decides that change.
      const again = await alice!.runtime.run(async (context) =>
        proposeRewrite(context, context.document.body.paragraphs.getFirst(), (draft) =>
          draft.text.replace('beta', 'BETA')
        ).catch((error: unknown) => error)
      );
      if (edit === 'other') expect(again).toMatchObject({ proposed: 'Alpha BETA gamma delta.' });
      else expect(again).toMatchObject({ code: 'pending-changes' });
      r.sync();
      await converged(r);
    } finally {
      r.close();
    }
  });
}

test('a participant with the same author keeps their change when the rewrite rolls back', async () => {
  const r = await room('reviewer first', BODY);
  try {
    const [alice] = r.peers;
    // A second worker that writes under the same author name.
    const twin = r.mount(r.pair.bob, REVIEWER);
    try {
      const failure = await alice!.runtime
        .run(async (context) => {
          const paused = interrupted(context, 13, async () => {
            await twin.runtime.run(async (other) => {
              other.document.changeTrackingMode = 'TrackMineOnly';
              other.document.body.paragraphs.getFirst().insertText('Note: ', 'Start');
              await other.sync();
            });
            r.sync();
          });
          const draft = await prepareRewrite(paused, paused.document.body.paragraphs.getFirst());
          await draft.apply(MODEL);
        })
        .then(
          () => null,
          (error: unknown) => error
        );
      expect(failure).toMatchObject({ code: 'stale' });
      r.sync();
      const seen = [await state(alice!.runtime), await state(twin.runtime)];
      for (const view of seen) {
        expect(view).toMatchObject({
          first: `Note: ${ORIGINAL}`,
          revisions: [`${REVIEWER}:Insert`],
        });
      }
    } finally {
      twin.close();
    }
  } finally {
    r.close();
  }
});

test('an edit while the model answers makes proposeRewrite prepare and ask again', async () => {
  const r = await room('reviewer first', BODY);
  try {
    const [alice, bob] = r.peers;
    const texts: string[] = [];
    const result = await alice!.runtime.run(async (context) =>
      proposeRewrite(context, context.document.body.paragraphs.getFirst(), async (draft) => {
        texts.push(draft.text);
        if (texts.length === 1) {
          // The participant edits the paragraph directly while the model answers.
          await bob!.runtime.run(async (peer) => {
            peer.document.body.paragraphs.getFirst().insertText(' Agreed.', 'End');
            await peer.sync();
          });
          r.sync();
        }
        return draft.text.replace('gamma', 'GAMMA');
      })
    );
    expect(texts).toEqual([ORIGINAL, `${ORIGINAL} Agreed.`]);
    expect(result).toMatchObject({
      original: `${ORIGINAL} Agreed.`,
      proposed: 'Alpha beta GAMMA delta. Agreed.',
      changes: 1,
    });
    r.sync();
    await converged(r);
    for (const peer of r.peers) {
      expect(await state(peer.runtime)).toMatchObject({
        first: 'Alpha beta GAMMA delta. Agreed.',
        revisions: [`${REVIEWER}:Delete`, `${REVIEWER}:Insert`],
      });
    }
  } finally {
    r.close();
  }
});
