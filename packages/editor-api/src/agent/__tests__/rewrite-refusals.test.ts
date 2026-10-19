/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The refusals and failures of the rewrite helper. Each one either writes nothing or rejects the
// changes it wrote, so the paragraph reads exactly as it did, with no pending revision.

import { describe, expect, test } from 'bun:test';
import {
  prepareRewrite,
  proposeRewrite,
  RewriteError,
  type RewriteDraft,
  type RewriteErrorCode,
} from '../../agent.ts';
import { DocxEditor, type RequestContext } from '../../index.ts';
import { docx, p } from '../../runtime/__tests__/support/docx.ts';
import {
  AUTHOR,
  firstParagraph,
  PILL,
  readBack,
  rejection,
  RICH,
  RICH_ORIGINAL,
  t,
  withRuntime,
} from './rewrite-support.ts';

/** Prepare the first paragraph, apply `output`, and return the error and the paragraph after. */
async function refused(bytes: Uint8Array, output: string, options = {}) {
  const { value } = await withRuntime(bytes, async (context) => {
    const paragraph = await firstParagraph(context);
    const draft = await prepareRewrite(context, paragraph, options);
    const error = await rejection(draft.apply(output));
    return { error, after: await readBack(context, paragraph) };
  });
  return value;
}

/** Expect a {@link RewriteError} with `code`, and a paragraph left as `original`. */
function expectUntouched(
  outcome: { error: unknown; after: Awaited<ReturnType<typeof readBack>> },
  code: RewriteErrorCode,
  original: string
) {
  expect(outcome.error).toBeInstanceOf(RewriteError);
  expect((outcome.error as RewriteError).code).toBe(code);
  expect(outcome.after.authors).toEqual([]);
  expect(outcome.after.text).toBe(original);
}

describe('model output that breaks a rule writes nothing', () => {
  const cases: [RewriteErrorCode, string, string][] = [
    ['placeholder-moved', '⟦3⟧ Under ⟦1⟧ the fee ⟦2⟧ applies', 'moves ⟦3⟧'],
    ['placeholder-unknown', 'Under ⟦1⟧ the fee ⟦9⟧ applies', 'contains ⟦9⟧'],
    ['placeholder-repeated', 'Under ⟦1⟧ the fee ⟦1⟧ applies', '⟦1⟧ more than once'],
    ['invalid-output', 'Under ⟦1⟧ the fee\n⟦2⟧ applies', 'line break'],
    ['invalid-output', '   ', 'empty'],
  ];
  for (const [code, output, message] of cases) {
    test(`${code}: ${JSON.stringify(output)}`, async () => {
      const outcome = await refused(RICH, output);
      expectUntouched(outcome, code, RICH_ORIGINAL);
      expect((outcome.error as RewriteError).message).toContain(message);
      expect((outcome.error as RewriteError).isModelError).toBe(true);
    });
  }

  test('text beside a placeholder is not refused', async () => {
    const bytes = docx(`<w:p>${t('Pay ')}${PILL}<w:r><w:tab/></w:r>${t('promptly.')}</w:p>`);
    const { value } = await withRuntime(bytes, async (context) => {
      const paragraph = await firstParagraph(context);
      const draft = await prepareRewrite(context, paragraph);
      expect(draft.text).toBe('Pay ⟦1⟧\tpromptly.');
      await draft.apply('Pay "⟦1⟧"; promptly.');
      return readBack(context, paragraph);
    });
    expect(value.current).toBe('Pay "Acme Corp"; promptly.');
  });

  test('placeholder-missing with keepPlaceholders', async () => {
    const outcome = await refused(RICH, 'Under ⟦1⟧ the fee applies\tto ⟦3⟧ promptly.', {
      keepPlaceholders: true,
    });
    expectUntouched(outcome, 'placeholder-missing', RICH_ORIGINAL);
    expect((outcome.error as RewriteError).message).toContain('leaves out ⟦2⟧');
  });
});

describe('a paragraph that cannot take a rewrite', () => {
  test('pending-changes: the paragraph has a tracked insertion', async () => {
    const bytes = docx(
      `<w:p>${t('Pay ')}<w:ins w:id="1" w:author="Other" w:date="2026-01-01T00:00:00Z">` +
        `${t('the full ')}</w:ins>${t('fee.')}</w:p>`
    );
    const { value } = await withRuntime(bytes, async (context) =>
      rejection(proposeRewrite(context, await firstParagraph(context), () => 'Pay a fee.'))
    );
    expect(value).toMatchObject({ code: 'pending-changes', isModelError: false });
  });

  test('tracking-unavailable: the runtime has no author', async () => {
    const { value } = await withRuntime(
      docx(p('Pay the fee now.')),
      async (context) => rejection(prepareRewrite(context, await firstParagraph(context))),
      null
    );
    expect(value).toMatchObject({ code: 'tracking-unavailable' });
  });

  test('draft-used: a draft writes once', async () => {
    const { value } = await withRuntime(docx(p('Pay the fee now.')), async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      await draft.apply('Pay the fee today.');
      return rejection(draft.apply('Pay the fee tomorrow.'));
    });
    expect(value).toMatchObject({ code: 'draft-used' });
  });

  test('the author hook is not enumerable', async () => {
    await withRuntime(docx(p('Text.')), async (context) => {
      expect(Object.keys(context)).toEqual([]);
      expect(JSON.stringify(Object.entries(context))).not.toContain('Rewrite agent');
    });
  });
});

describe('a failed write rolls back the writes before it', () => {
  test('write-failed: the second hunk is refused', async () => {
    const original = 'Alpha beta gamma delta.';
    // The last hunk applies first and succeeds; the first one carries a column break, which a
    // text write refuses.
    const outcome = await refused(docx(p(original)), 'Alpha be\u000Eta gamma DELTA.');
    expectUntouched(outcome, 'write-failed', original);
    expect(outcome.after.current).toBe(original);
    expect((outcome.error as RewriteError).cause).toMatchObject({ name: 'DocxEditorError' });
  });

  test('a sync that fails mid-apply leaves no change behind', async () => {
    const original = 'Alpha beta gamma delta.';
    const { value } = await withRuntime(docx(p(original)), async (context) => {
      const paragraph = await firstParagraph(context);
      // Syncs 1 to 4 prepare, 5 and 6 turn tracking on, and 7 lists the revisions before the
      // first write. The last hunk writes at 8 and reads its revisions back at 9 and 10. Sync 11
      // writes the first hunk and then fails, so the helper must find that change too.
      const draft = await prepareRewrite(failingSync(context, 11), paragraph);
      const error = await rejection(draft.apply('Alpha BETA gamma DELTA.'));
      return { error, after: await readBack(context, paragraph) };
    });
    expectUntouched(value, 'write-failed', original);
    expect((value.error as RewriteError).message).toContain('The connection dropped.');
  });

  test('the rollback finds the changes of an author name with spaces around it', async () => {
    const original = 'Alpha beta gamma delta.';
    const { value } = await withRuntime(
      docx(p(original)),
      async (context) => {
        const paragraph = await firstParagraph(context);
        const draft = await prepareRewrite(failingSync(context, 11), paragraph);
        const error = await rejection(draft.apply('Alpha BETA gamma DELTA.'));
        return { error, after: await readBack(context, paragraph) };
      },
      '  Rewrite agent  '
    );
    expectUntouched(value, 'write-failed', original);
  });

  test('verification-failed rejects only its own change, not one by the same author', async () => {
    const original = 'Alpha beta gamma delta.';
    const runtime = await DocxEditor.createServer(docx(p(original)), { author: AUTHOR });
    try {
      const value = await runtime.run(async (context) => {
        const paragraph = await firstParagraph(context);
        // The same author, in another run, proposes text after this rewrite read its own
        // change back (syncs 9 and 10) and before the final check (sync 11).
        const paused = pausingSync(context, 11, () =>
          runtime.run(async (other) => {
            other.document.body.paragraphs.getFirst().insertText('Note: ', 'Start');
            await other.sync();
          })
        );
        const draft = await prepareRewrite(paused, paragraph);
        const error = await rejection(draft.apply('Alpha beta gamma DELTA.'));
        return { error, after: await readBack(context, paragraph) };
      });
      expect(value.error).toMatchObject({ code: 'verification-failed' });
      expect(value.after.current).toBe(`Note: ${original}`);
      expect(value.after.authors).toEqual([AUTHOR]);
    } finally {
      runtime.dispose();
    }
  });

  test('a rollback that finds nothing to reject reports rollback-failed', async () => {
    const original = 'Alpha beta gamma delta.';
    const { value } = await withRuntime(docx(p(original)), async (context) => {
      const paragraph = await firstParagraph(context);
      // The write lands at sync 8; the read of its revisions at sync 9 then fails, so the helper
      // never learns which changes it made. The rollback must not report success.
      const draft = await prepareRewrite(failingSync(context, 9), paragraph);
      const error = await rejection(draft.apply('Alpha beta gamma DELTA.'));
      return { error, after: await readBack(context, paragraph) };
    });
    expect(value.error).toMatchObject({ code: 'rollback-failed' });
    expect((value.error as RewriteError).message).toContain('after the rollback');
    expect(value.after.current).toBe('Alpha beta gamma DELTA.');
  });

  test('a failure to turn tracking off again never replaces the result or the error', async () => {
    const original = 'Alpha beta gamma delta.';
    // Every sync from the twelfth fails: the write and the check succeed (7 to 11), and turning
    // tracking off again fails. The proposal stands.
    const success = await withRuntime(docx(p(original)), async (context) => {
      const paragraph = await firstParagraph(context);
      const draft = await prepareRewrite(failingSync(context, 12, true), paragraph);
      const result = await draft.apply('Alpha beta gamma DELTA.');
      context.document.load('changeTrackingMode');
      await context.sync();
      return { result, mode: context.document.changeTrackingMode };
    });
    expect(success.value.result.proposed).toBe('Alpha beta gamma DELTA.');
    expect(success.value.mode).toBe('TrackMineOnly');

    // A refused second hunk (sync 11), a rollback (12 to 16), then turning tracking off fails.
    const failure = await withRuntime(docx(p(original)), async (context) => {
      const paragraph = await firstParagraph(context);
      const draft = await prepareRewrite(failingSync(context, 17, true), paragraph);
      return rejection(draft.apply('Alpha be\u000Eta gamma DELTA.'));
    });
    expect(failure.value).toMatchObject({ code: 'write-failed' });
    expect((failure.value as RewriteError).suppressed).toMatchObject({
      message: 'The connection dropped.',
    });
  });
});

describe('retries', () => {
  test('a model error asks the model again with the reason', async () => {
    const drafts: RewriteDraft[] = [];
    const { value } = await withRuntime(RICH, async (context) =>
      proposeRewrite(context, await firstParagraph(context), (draft) => {
        drafts.push(draft);
        return drafts.length === 1
          ? 'Under ⟦1⟧ the fee ⟦9⟧ applies'
          : draft.text.replace('fee', 'charge');
      })
    );
    expect(value.proposed).toContain('the charge');
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.feedback).toBeUndefined();
    expect(drafts[1]!.feedback?.error.code).toBe('placeholder-unknown');
    expect(drafts[1]!.prompt).toContain('Your previous answer was refused: The model output');
    expect(drafts[1]!.prompt).toContain('Previous answer:\nUnder ⟦1⟧ the fee ⟦9⟧ applies');
  });

  test('retries is clamped to a whole number from 0 to 5', async () => {
    for (const [retries, calls] of [
      [-1, 1],
      [Number.NaN, 3],
      [Number.POSITIVE_INFINITY, 3],
      [2.7, 3],
      [99, 6],
    ] as const) {
      let count = 0;
      const { value } = await withRuntime(RICH, async (context) =>
        rejection(
          proposeRewrite(
            context,
            await firstParagraph(context),
            () => {
              count += 1;
              return 'Under ⟦1⟧ ⟦9⟧';
            },
            { retries }
          )
        )
      );
      expect(value).toMatchObject({ code: 'placeholder-unknown' });
      expect([retries, count]).toEqual([retries, calls]);
    }
  });

  test('model-failed: a thrown model call is retried, then reported', async () => {
    const cause = new Error('rate limited');
    let calls = 0;
    const { value } = await withRuntime(RICH, async (context) =>
      rejection(
        proposeRewrite(context, await firstParagraph(context), () => {
          calls += 1;
          throw cause;
        })
      )
    );
    expect(value).toBeInstanceOf(RewriteError);
    expect(value).toMatchObject({ code: 'model-failed', cause, isModelError: false });
    expect(calls).toBe(3);

    let tries = 0;
    const recovered = await withRuntime(docx(p('Pay the fee now.')), async (context) =>
      proposeRewrite(context, await firstParagraph(context), () => {
        tries += 1;
        if (tries === 1) throw cause;
        return 'Pay the fee today.';
      })
    );
    expect(recovered.value.proposed).toBe('Pay the fee today.');
    expect(tries).toBe(2);
  });

  test('context-used: the rewrite function must not sync the context', async () => {
    let calls = 0;
    const { value } = await withRuntime(docx(p('Pay the fee now.')), async (context) => {
      const paragraph = await firstParagraph(context);
      const error = await rejection(
        proposeRewrite(context, paragraph, async () => {
          calls += 1;
          paragraph.load('text');
          await context.sync();
          return 'Pay the fee today.';
        })
      );
      // The guard comes off after the model call: the context syncs again.
      paragraph.load('text');
      await context.sync();
      return { error, text: paragraph.text };
    });
    expect(value.error).toMatchObject({ code: 'context-used' });
    expect((value.error as RewriteError).message).toContain('must not use the request context');
    expect(calls).toBe(1);
    expect(value.text).toBe('Pay the fee now.');
  });

  test('verification-failed prepares the paragraph again, like stale', async () => {
    const runtime = await DocxEditor.createServer(docx(p('Alpha beta gamma delta.')), {
      author: AUTHOR,
    });
    try {
      let calls = 0;
      const error = await runtime.run(async (context) => {
        const paused = pausingSync(context, 11, () =>
          runtime.run(async (other) => {
            other.document.body.paragraphs.getFirst().insertText('Note: ', 'Start');
            await other.sync();
          })
        );
        return rejection(
          proposeRewrite(paused, paused.document.body.paragraphs.getFirst(), () => {
            calls += 1;
            return 'Alpha beta gamma DELTA.';
          })
        );
      });
      // The second preparation finds the other run's pending insertion.
      expect(error).toMatchObject({ code: 'pending-changes' });
      expect(calls).toBe(1);
    } finally {
      runtime.dispose();
    }
  });

  test('retries: 0 throws the first model error', async () => {
    const { value } = await withRuntime(RICH, async (context) =>
      rejection(
        proposeRewrite(context, await firstParagraph(context), () => 'Under ⟦1⟧ ⟦1⟧', {
          retries: 0,
        })
      )
    );
    expect(value).toMatchObject({ code: 'placeholder-repeated' });
  });
});

/**
 * A context whose sync number `at` syncs and then throws, as a connection that drops before the
 * answer arrives does: the batch lands, but the caller cannot know it. Once, or with `from`, on
 * every sync from then on.
 */
function failingSync(context: RequestContext, at: number, from = false): RequestContext {
  let count = 0;
  return new Proxy(context, {
    get(target, key) {
      if (key === 'sync') {
        return async () => {
          count += 1;
          await target.sync();
          if (count === at || (from && count > at)) throw new Error('The connection dropped.');
        };
      }
      const value = Reflect.get(target, key) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** A context whose sync number `at` runs `between` first. */
function pausingSync(
  context: RequestContext,
  at: number,
  between: () => Promise<unknown>
): RequestContext {
  let count = 0;
  return new Proxy(context, {
    get(target, key) {
      if (key === 'sync') {
        return async () => {
          count += 1;
          if (count === at) await between();
          await target.sync();
        };
      }
      const value = Reflect.get(target, key) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
