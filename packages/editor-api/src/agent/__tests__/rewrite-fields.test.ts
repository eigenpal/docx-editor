/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Fields that show no text at the edges of a paragraph, inside a word, and side by side; a
// paragraph too long to compare; and the cost of preparing a long paragraph.

import { describe, expect, test } from 'bun:test';
import { prepareRewrite, RewriteError } from '../../agent.ts';
import { RequestContext } from '../../index.ts';
import { docx, p } from '../../runtime/__tests__/support/docx.ts';
import {
  decided,
  firstParagraph,
  rejection,
  rewriteParagraph,
  t,
  withRuntime,
} from './rewrite-support.ts';

/** A field with no result: the kind an index or a table of contents entry is. */
const bare = (code: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${code}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const XE = (entry: string) => bare(` XE "${entry}" `);
const fieldWithResult = (code: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${code}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  t(result) +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

describe('fields that show no text', () => {
  test('at the end and at the start of a paragraph, an unchanged answer writes nothing', async () => {
    for (const [body, draftText] of [
      [`${t('See page ')}${bare(' PAGE ')}`, 'See page ⟦1⟧'],
      [`${bare(' PAGE ')}${t(' is the page.')}`, '⟦1⟧ is the page.'],
    ] as const) {
      const bytes = docx(`<w:p>${body}</w:p>`);
      const { value, saved } = await withRuntime(bytes, async (context) => {
        const paragraph = await firstParagraph(context);
        const draft = await prepareRewrite(context, paragraph);
        expect(draft.text).toBe(draftText);
        const unchanged = await draft.apply(draft.text);
        const again = await prepareRewrite(context, paragraph);
        const changed = await again.apply(again.text.replace('page', 'sheet'));
        return { unchanged, changed };
      });
      expect(value.unchanged.changes).toBe(0);
      expect(value.changed.proposed).toContain('sheet');
      // The field beside the changed word stays.
      expect(await decided(saved, 'acceptAll')).toMatchObject({ fields: 1 });
    }
  });

  test('inside a word, the word stays text and the field is its own placeholder', async () => {
    const bytes = docx(`<w:p>${t('The Term')}${XE('Term')}${t(' is defined here.')}</w:p>`);
    const { value, saved } = await withRuntime(bytes, async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      expect(draft.text).toBe('The Term⟦1⟧ is defined here.');
      expect(draft.placeholders).toEqual([
        {
          placeholder: '⟦1⟧',
          kind: 'field',
          text: '',
          description: 'field with code "XE \\"Term\\"", shows no text',
        },
      ]);
      return draft.apply('The Expression⟦1⟧ is defined here.');
    });
    expect(value.proposed).toBe('The Expression is defined here.');
    expect(await decided(saved, 'acceptAll')).toMatchObject({ fields: 1 });
  });

  test('side by side, each has a placeholder, and they go only together', async () => {
    const bytes = docx(`<w:p>${t('One ')}${XE('a')}${XE('b')}${XE('c')}${t(' two three.')}</w:p>`);
    await withRuntime(bytes, async (context) => {
      const paragraph = await firstParagraph(context);
      const draft = await prepareRewrite(context, paragraph);
      expect(draft.text).toBe('One ⟦1⟧⟦2⟧⟦3⟧ two three.');
      expect(draft.placeholders.map((entry) => entry.description)).toEqual([
        'field with code "XE \\"a\\"", shows no text',
        'field with code "XE \\"b\\"", shows no text',
        'field with code "XE \\"c\\"", shows no text',
      ]);
      const error = await rejection(draft.apply('One ⟦1⟧⟦3⟧ two three.'));
      expect(error).toMatchObject({ code: 'placeholder-grouped', isModelError: true });
      expect((error as RewriteError).message).toContain('keep all of ⟦1⟧, ⟦2⟧, ⟦3⟧');
    });
    const dropped = await withRuntime(bytes, async (context) =>
      rewriteParagraph(context, await firstParagraph(context), () => 'One two three.')
    );
    expect(await decided(dropped.saved, 'acceptAll')).toMatchObject({ fields: 0 });
    expect(await decided(dropped.saved, 'rejectAll')).toMatchObject({ fields: 3 });
  });
});

describe('long paragraphs', () => {
  test('a paragraph too long to compare is refused when it is prepared', async () => {
    const bytes = docx(p('word '.repeat(20_001).trim()));
    const { value } = await withRuntime(bytes, async (context) =>
      rejection(prepareRewrite(context, await firstParagraph(context)))
    );
    expect(value).toMatchObject({ code: 'too-long', isModelError: false });
  });

  test('preparing 2,000 plain words reads nothing per word and takes six syncs', async () => {
    const words = Array.from({ length: 2_000 }, (_, at) => `word${at % 97}`).join(' ');
    const bytes = docx(p(`${words}.`));
    const original = RequestContext.prototype.sync;
    let syncs = 0;
    RequestContext.prototype.sync = function count(this: RequestContext) {
      syncs += 1;
      return original.call(this);
    };
    try {
      const { value } = await withRuntime(bytes, async (context) => {
        const paragraph = await firstParagraph(context);
        await context.sync();
        syncs = 0;
        const started = performance.now();
        const draft = await prepareRewrite(context, paragraph);
        const elapsed = performance.now() - started;
        const count = syncs;
        let changed = 0;
        const answer = draft.text.replace(/word5\b/g, (word) => (changed++ % 2 ? word : 'term'));
        const result = await draft.apply(answer);
        return { elapsed, count, result };
      });
      expect(value.count).toBe(6);
      expect(value.elapsed).toBeLessThan(2_000);
      expect(value.result.changes).toBeGreaterThan(5);
    } finally {
      RequestContext.prototype.sync = original;
    }
  });

  test('preparing 2,000 words with 50 fields inside words stays fast', async () => {
    let body = '';
    for (let at = 0; at < 2_000; at += 1) {
      body +=
        at % 40 === 0
          ? `${t('Sec')}${fieldWithResult(` REF _R${at} \\h `, `${at}.1`)}${t('b ')}`
          : t(`word${at % 97} `);
    }
    const bytes = docx(`<w:p>${body}${t('end.')}</w:p>`);
    const { value } = await withRuntime(bytes, async (context) => {
      const paragraph = await firstParagraph(context);
      await context.sync();
      const started = performance.now();
      const draft = await prepareRewrite(context, paragraph);
      return { elapsed: performance.now() - started, draft };
    });
    expect(value.draft.placeholders).toHaveLength(50);
    expect(value.draft.placeholders.every((entry) => entry.kind === 'field')).toBe(true);
    expect(value.elapsed).toBeLessThan(3_000);
  });
});
