/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What the helper refuses or handles so that nothing happens silently: a field that shows no
// text, edits queued before a helper call, a host that wraps `context.sync`, and text that
// resembles a placeholder or a paragraph break.

import { describe, expect, test } from 'bun:test';
import { prepareRewrite, RewriteError } from '../../agent.ts';
import { docx, p } from '../../runtime/__tests__/support/docx.ts';
import {
  decided,
  firstParagraph,
  rejection,
  rewriteParagraph,
  t,
  withRuntime,
} from './rewrite-support.ts';

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
      rewriteParagraph(context, await firstParagraph(context), (text) =>
        text.replace('deed', 'agreement')
      )
    );
    expect(await decided(kept.saved, 'acceptAll')).toMatchObject({ fields: 1 });
    const dropped = await withRuntime(EMPTY, async (context) =>
      rewriteParagraph(context, await firstParagraph(context), () => 'Page of the agreement.')
    );
    expect(await decided(dropped.saved, 'acceptAll')).toMatchObject({ fields: 0 });
    expect(await decided(dropped.saved, 'rejectAll')).toMatchObject({ fields: 1 });
  });
});

describe('the request context stays the helper’s', () => {
  test('an edit queued before a helper call is refused, not sent with its writes', async () => {
    const { value } = await withRuntime(docx(p('Gamma clause three.')), async (context) => {
      const paragraph = await firstParagraph(context);
      await context.sync();
      paragraph.getRange('End').insertText(' EXTRA', 'Before');
      const prepared = await rejection(prepareRewrite(context, paragraph));
      await context.sync();
      const draft = await prepareRewrite(context, paragraph);
      paragraph.getRange('Start').insertText('MORE ', 'Before');
      const applied = await rejection(draft.apply('Gamma clause 3.'));
      return { prepared, applied };
    });
    for (const error of [value.prepared, value.applied]) {
      expect(error).toMatchObject({ code: 'context-used' });
      expect((error as RewriteError).message).toContain(
        '1 edit is queued on the request context. Sync it before you call the helper'
      );
    }
  });

  test('a tracking-mode assignment queued before the helper is not an edit: it rides along', async () => {
    const { value, saved } = await withRuntime(docx(p('Gamma clause three.')), async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const paragraph = context.document.body.paragraphs.getFirst();
      const draft = await prepareRewrite(context, paragraph);
      const result = await draft.apply('Gamma clause 3.');
      context.document.load('changeTrackingMode');
      await context.sync();
      return { result, mode: context.document.changeTrackingMode };
    });
    expect(value.result.proposed).toBe('Gamma clause 3.');
    expect(value.mode).toBe('TrackMineOnly');
    expect(await decided(saved, 'rejectAll')).toMatchObject({ text: 'Gamma clause three.' });
  });

  test('a queued TrackAll, which refuses at sync, still counts as queued', async () => {
    await withRuntime(docx(p('Gamma clause three.')), async (context) => {
      context.document.changeTrackingMode = 'TrackAll';
      const paragraph = context.document.body.paragraphs.getFirst();
      const error = await prepareRewrite(context, paragraph).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: 'context-used' });
    });
  });
});

describe('a host that wraps context.sync', () => {
  test('keeps its wrapper: the helper syncs through it, and it is restored', async () => {
    let calls = 0;
    const { value } = await withRuntime(docx(p('Pay the fee now.')), async (context) => {
      const paragraph = await firstParagraph(context);
      await context.sync();
      const prototype = Object.getPrototypeOf(context) as { sync: () => Promise<void> };
      const wrapper = function traced(this: typeof context) {
        calls += 1;
        return prototype.sync.call(this);
      };
      Object.defineProperty(context, 'sync', {
        configurable: true,
        writable: true,
        value: wrapper,
      });
      const result = await rewriteParagraph(context, paragraph, () => 'Pay the fee today.');
      const restored = Object.getOwnPropertyDescriptor(context, 'sync');
      return { result, restored: restored?.value === wrapper && restored.writable === true };
    });
    expect(value.result.proposed).toBe('Pay the fee today.');
    expect(calls).toBeGreaterThan(5);
    expect(value.restored).toBe(true);
  });

  test('a caller’s own sync during apply() says a helper call is in progress', async () => {
    const { value } = await withRuntime(docx(p('Pay the fee now.')), async (context) => {
      const paragraph = await firstParagraph(context);
      const draft = await prepareRewrite(context, paragraph);
      const running = draft.apply('Pay the fee today.');
      const error = await rejection(context.sync());
      await running;
      return error;
    });
    expect(value).toMatchObject({ code: 'busy' });
    expect((value as RewriteError).message).toContain('A helper call is in progress');
  });
});

describe('text that looks like a placeholder or a break', () => {
  test('a line separator the paragraph already has is text, not a paragraph break', async () => {
    const bytes = docx(`<w:p>${t('Odd separator here.')}</w:p>`);
    const { value } = await withRuntime(bytes, async (context) =>
      rewriteParagraph(context, await firstParagraph(context), (text) =>
        text.replace('here', 'there')
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
