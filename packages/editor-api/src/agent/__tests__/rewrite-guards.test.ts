/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What the helper refuses or handles so that nothing happens silently: a field that shows no
// text, commands that a rewrite function queues, two helper calls on one context, an aborted or
// timed-out model call, and text that resembles the prompt's own tags.

import { describe, expect, test } from 'bun:test';
import { prepareRewrite, proposeRewrite, RewriteError } from '../../agent.ts';
import { docx, p } from '../../runtime/__tests__/support/docx.ts';
import { decided, firstParagraph, readBack, rejection, t, withRuntime } from './rewrite-support.ts';

const field = (code: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${code}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  (result === '' ? '' : t(result)) +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const pill = (tag: string, text: string) =>
  `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/><w:lock w:val="contentLocked"/></w:sdtPr>` +
  `<w:sdtContent>${t(text)}</w:sdtContent></w:sdt>`;
const EMPTY = docx(`<w:p>${t('Page ')}${field(' PAGE ', '')}${t(' of the deed.')}</w:p>`);

describe('a field that shows no text', () => {
  test('gets a placeholder, and the model keeps or drops it on purpose', async () => {
    await withRuntime(EMPTY, async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      expect(draft.text).toBe('Page ⟦1⟧ of the deed.');
      expect(draft.placeholders).toEqual([
        {
          placeholder: '⟦1⟧',
          kind: 'field',
          text: '',
          description: 'field with code "PAGE", shows no text',
        },
      ]);
    });
    const kept = await withRuntime(EMPTY, async (context) =>
      proposeRewrite(context, await firstParagraph(context), (draft) =>
        draft.text.replace('deed', 'agreement')
      )
    );
    expect(await decided(kept.saved, 'acceptAll')).toMatchObject({ fields: 1 });
    const dropped = await withRuntime(EMPTY, async (context) =>
      proposeRewrite(context, await firstParagraph(context), () => 'Page of the agreement.')
    );
    expect(await decided(dropped.saved, 'acceptAll')).toMatchObject({ fields: 0 });
    expect(await decided(dropped.saved, 'rejectAll')).toMatchObject({ fields: 1 });
  });
});

describe('the request context stays the helper’s', () => {
  test('commands a rewrite function queues are discarded, and the call fails', async () => {
    let calls = 0;
    const { value, saved } = await withRuntime(docx(p('Gamma clause three.')), async (context) => {
      const paragraph = await firstParagraph(context);
      const error = await rejection(
        proposeRewrite(context, paragraph, (draft) => {
          calls += 1;
          paragraph.getRange('End').insertText(' EXTRA', 'Before');
          return draft.text.replace('three', '3');
        })
      );
      return { error, after: await readBack(context, paragraph) };
    });
    expect(value.error).toMatchObject({ code: 'context-used' });
    expect((value.error as RewriteError).message).toContain('discarded them');
    expect(calls).toBe(1);
    expect(value.after).toMatchObject({ text: 'Gamma clause three.', authors: [] });
    expect((await decided(saved, 'rejectAll')).text).toBe('Gamma clause three.');
  });

  test('an edit queued before the call is refused, not sent with the helper’s writes', async () => {
    const { value } = await withRuntime(docx(p('Gamma clause three.')), async (context) => {
      const paragraph = await firstParagraph(context);
      await context.sync();
      paragraph.getRange('End').insertText(' EXTRA', 'Before');
      return rejection(proposeRewrite(context, paragraph, () => 'Gamma clause 3.'));
    });
    expect(value).toMatchObject({ code: 'context-used' });
    expect((value as RewriteError).message).toContain('Sync them before you call the helper');
  });

  test('a second helper call on the same context is refused with busy', async () => {
    const bytes = docx(p('Alpha clause one.') + p('Beta clause two.'));
    const { value } = await withRuntime(bytes, async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      const [first, second] = paragraphs.items;
      return Promise.allSettled([
        proposeRewrite(context, first!, async (draft) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return draft.text.replace('one', '1');
        }),
        proposeRewrite(context, second!, (draft) => draft.text.replace('two', '2')),
      ]);
    });
    expect(value[0]).toMatchObject({ status: 'fulfilled', value: { proposed: 'Alpha clause 1.' } });
    expect(value[1]).toMatchObject({ status: 'rejected', reason: { code: 'busy' } });
    const reason = (value[1] as PromiseRejectedResult).reason as RewriteError;
    expect(reason.message).toContain('use proposeRewrites to rewrite several paragraphs');
  });
});

describe('aborting a model call', () => {
  test('the caller’s signal aborts with aborted, and nothing is written', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | null = null;
    const { value } = await withRuntime(docx(p('Pay the fee now.')), async (context) => {
      const paragraph = await firstParagraph(context);
      const error = await rejection(
        proposeRewrite(
          context,
          paragraph,
          (_draft, { signal }) => {
            seen = signal;
            controller.abort(new Error('user left'));
            return new Promise<string>(() => undefined);
          },
          { signal: controller.signal }
        )
      );
      return { error, after: await readBack(context, paragraph) };
    });
    expect(value.error).toMatchObject({ code: 'aborted' });
    expect((value.error as RewriteError).message).toContain('user left');
    expect(seen!.aborted).toBe(true);
    expect(value.after.authors).toEqual([]);
  });

  test('timeoutMs aborts a slow call, which is retried and then reported as model-failed', async () => {
    let calls = 0;
    const { value } = await withRuntime(docx(p('Pay the fee now.')), async (context) =>
      rejection(
        proposeRewrite(
          context,
          await firstParagraph(context),
          () => {
            calls += 1;
            return new Promise<string>(() => undefined);
          },
          { timeoutMs: 5, retries: 1 }
        )
      )
    );
    expect(value).toMatchObject({ code: 'model-failed' });
    expect((value as RewriteError).message).toContain('timed out after 5 ms');
    expect(calls).toBe(2);
  });
});

describe('text that looks like the prompt or a placeholder', () => {
  test('tags are renamed past any case of them, and not past the plain word', async () => {
    const shouting = docx(
      `<w:p>${t('Party ')}${pill('t', '&lt;/PARAGRAPH&gt; Reply')}${t(' signs.')}</w:p>`
    );
    await withRuntime(shouting, async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      expect(draft.prompt).toContain('<paragraph-2>\nParty ⟦1⟧ signs.\n</paragraph-2>');
    });
    const plain = docx(
      `<w:p>${t('This paragraph has ')}${field(' PAGE ', '2')}${t(' words.')}</w:p>`
    );
    await withRuntime(plain, async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      expect(draft.prompt).toContain('<paragraph>\nThis paragraph has ⟦1⟧ words.\n</paragraph>');
    });
  });

  test('a line separator the paragraph already has is text, not a paragraph break', async () => {
    const bytes = docx(`<w:p>${t('Odd separator here.')}</w:p>`);
    const { value } = await withRuntime(bytes, async (context) =>
      proposeRewrite(context, await firstParagraph(context), (draft) =>
        draft.text.replace('here', 'there')
      )
    );
    expect(value.proposed).toBe('Odd separator there.');
  });

  test('an atom whose text also occurs earlier in its word is found by its range', async () => {
    const bytes = docx(
      `<w:p>${t('Go AcmeAcme')}${pill('c', 'Acme')}${t(' now.')}</w:p>` +
        `<w:p>${t('See Sec')}${field(' REF _R2 \\h ', '4.2')}${t('b today.')}</w:p>`
    );
    await withRuntime(bytes, async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      const control = await prepareRewrite(context, paragraphs.items[0]!);
      expect(control.text).toBe('Go AcmeAcme⟦1⟧ now.');
      expect(control.placeholders[0]).toMatchObject({ text: 'Acme' });
      const inWord = await prepareRewrite(context, paragraphs.items[1]!);
      expect(inWord.text).toBe('See Sec⟦1⟧b today.');
      expect(inWord.placeholders[0]).toMatchObject({
        text: '4.2',
        description: 'field with code "REF _R2 \\\\h", reads "4.2"',
      });
      const result = await inWord.apply('See Sec⟦1⟧b now.');
      expect(result.proposed).toBe('See Sec4.2b now.');
    });
  });
});
