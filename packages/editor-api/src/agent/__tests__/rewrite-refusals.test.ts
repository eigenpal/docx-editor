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
import type { RequestContext } from '../../index.ts';
import { docx, p } from '../../runtime/__tests__/support/docx.ts';
import {
  firstParagraph,
  PILL,
  readBack,
  REF,
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
    ['text-attached', 'Under ⟦1⟧ the fee ⟦2⟧ applies\tto ⟦3⟧; promptly.', 'attaches text'],
    ['text-attached', 'Under ⟦1⟧ the fee ⟦2⟧ applies\tto "⟦3⟧" promptly.', 'attaches text'],
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

  test('punctuation-repeated, also across a space', async () => {
    const bytes = docx(`<w:p>${t('Under ')}${REF}${t(', the fee applies.')}</w:p>`);
    for (const output of ['Under ⟦1⟧, the charge applies.', 'Under ⟦1⟧ , the charge applies.']) {
      const outcome = await refused(bytes, output);
      expectUntouched(outcome, 'punctuation-repeated', 'Under Section 4.2, the fee applies.');
      expect((outcome.error as RewriteError).message).toBe(
        'The model output repeats "," after ⟦1⟧, which already ends with it.'
      );
    }
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

  test('verification-failed: an atom keeps its own tab', async () => {
    const bytes = docx(`<w:p>${t('Pay ')}${PILL}<w:r><w:tab/></w:r>${t('promptly.')}</w:p>`);
    const { value } = await withRuntime(bytes, async (context) => {
      const paragraph = await firstParagraph(context);
      const draft = await prepareRewrite(context, paragraph);
      expect(draft.text).toBe('Pay ⟦1⟧\tpromptly.');
      // The space the model writes after the placeholder cannot land: the atom ends in a tab.
      // Without another change, nothing is written; with one, the change is rolled back.
      const errors = [
        await rejection(draft.apply('Pay ⟦1⟧ promptly.')),
        await rejection(draft.apply('Pay ⟦1⟧ promptly today.')),
      ];
      return { errors, after: await readBack(context, paragraph) };
    });
    for (const error of value.errors) {
      expectUntouched(
        { error, after: value.after },
        'verification-failed',
        'Pay Acme Corp\tpromptly.'
      );
    }
  });

  test('a sync that fails mid-apply leaves no change behind', async () => {
    const original = 'Alpha beta gamma delta.';
    const { value } = await withRuntime(docx(p(original)), async (context) => {
      const paragraph = await firstParagraph(context);
      // Two syncs prepare, two turn tracking on, the fifth writes the last hunk, and the sixth,
      // for the first hunk, fails.
      const draft = await prepareRewrite(failingSync(context, 6), paragraph);
      const error = await rejection(draft.apply('Alpha BETA gamma DELTA.'));
      return { error, after: await readBack(context, paragraph) };
    });
    expectUntouched(value, 'write-failed', original);
    expect((value.error as RewriteError).message).toContain('The connection dropped.');
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

/** A context whose sync number `at` throws once instead of syncing: a dropped connection. */
function failingSync(context: RequestContext, at: number): RequestContext {
  let count = 0;
  return new Proxy(context, {
    get(target, key) {
      if (key === 'sync') {
        return async () => {
          count += 1;
          if (count === at) throw new Error('The connection dropped.');
          await target.sync();
        };
      }
      const value = Reflect.get(target, key) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
