/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The "Propose an AI rewrite as tracked changes" recipe in a collaboration room. A participant
// edits between two of the recipe's writes; the recipe then fails, rolls back only its own
// changes on both peers, keeps the participant's edit, and succeeds when called again.
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { DocxEditorRuntime, RequestContext } from '@docx-editor.dev/editor-api/browser';
import {
  apply,
  prepare,
} from '../../../../editor-api/src/runtime/__tests__/support/propose-rewrite.ts';
import { converged, REVIEWER, room } from './tracked-foreign-revisions-support';

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
          return target.sync();
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
    const first = paragraphs.items[0]!;
    const current = first.getReviewedText('Current');
    const revisions = context.document.body.revisions;
    const second = paragraphs.items[1]!.getReviewedText('Current');
    revisions.load('items/author,items/type');
    await context.sync();
    return {
      first: current.value,
      second: second.value,
      revisions: revisions.items.map((item) => `${item.author}:${item.type}`).sort(),
    };
  });
}

for (const [where, edit] of [
  ['the next paragraph', 'other'],
  ['the same paragraph', 'same'],
] as const) {
  test(`a participant's edit in ${where} mid-apply rolls back only the recipe's changes`, async () => {
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
          context.document.changeTrackingMode = 'TrackMineOnly';
          const prepared = await prepare(
            context,
            context.document.body.paragraphs.getFirst(),
            REVIEWER
          );
          // The first write lands, then the participant edits, then the second write runs.
          await apply(interrupted(context, 2, peerEdit), prepared, MODEL);
        })
        .then(
          () => null,
          (error: unknown) => error
        );
      expect(failure).toMatchObject({ code: 'StaleDocument' });
      r.sync();
      await converged(r);
      const expectedFirst = edit === 'same' ? `Note: ${ORIGINAL}` : ORIGINAL;
      const expectedSecond = edit === 'other' ? 'Second clause. Noted.' : 'Second clause.';
      for (const peer of r.peers) {
        expect(await state(peer.runtime)).toEqual({
          first: expectedFirst,
          second: expectedSecond,
          revisions: ['Tailspin Legal:Insert'],
        });
      }

      // Calling prepare() again on the new document succeeds.
      const proposed = await alice!.runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const paragraph = context.document.body.paragraphs.getFirst();
        const prepared = await prepare(context, paragraph, REVIEWER).catch(() => null);
        if (!prepared) return null;
        return apply(context, prepared, prepared.promptText.replace('beta', 'BETA'));
      });
      if (edit === 'other') expect(proposed).toBe('Alpha BETA gamma delta.');
      else expect(proposed).toBeNull();
    } finally {
      r.close();
    }
  });
}
