/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What a draft gives the caller's prompt and retry loop: `legend`, the placeholder contract as
// plain text, and `check()`, which answers with the error `apply()` would throw before writing.

import { describe, expect, test } from 'bun:test';
import { prepareRewrite, RewriteError } from '../../agent.ts';
import { docx, p } from '../../runtime/__tests__/support/docx.ts';
import {
  firstParagraph,
  readBack,
  rejection,
  REF,
  RICH,
  RICH_ORIGINAL,
  t,
  withRuntime,
} from './rewrite-support.ts';

const RULES =
  'The text contains placeholders, such as ⟦1⟧. Each one stands for content that you cannot ' +
  'edit, such as a field or an equation. Copy each placeholder that you keep exactly as ' +
  'written. Leave a placeholder out to delete what it stands for. Write the text around a ' +
  'placeholder as usual. Do not change the order of the placeholders, and do not repeat one.';
const LIST =
  'Placeholders:\n' +
  '⟦1⟧ = field with code "REF _Ref1 \\\\h", reads "Section 4.2"\n' +
  '⟦2⟧ = equation\n' +
  '⟦3⟧ = locked content control named "party", reads "Acme Corp"';

describe('draft.legend', () => {
  test('states the rules and lists each placeholder, with no instruction or paragraph text', async () => {
    const { value } = await withRuntime(RICH, async (context) =>
      prepareRewrite(context, await firstParagraph(context))
    );
    expect(value.legend).toBe(`${RULES}\n\n${LIST}`);
    expect(value.legend).not.toContain('the fee');
    expect(value.legend).not.toContain('<');
  });

  test('with keepPlaceholders, says to keep every placeholder', async () => {
    const { value } = await withRuntime(RICH, async (context) =>
      prepareRewrite(context, await firstParagraph(context), { keepPlaceholders: true })
    );
    expect(value.legend).toContain('Keep every placeholder, and copy each one exactly as written.');
    expect(value.legend).not.toContain('Leave a placeholder out');
    expect(value.legend).toEndWith(`\n\n${LIST}`);
  });

  test('is empty when the paragraph has no placeholder', async () => {
    const { value } = await withRuntime(docx(p('Pay the fee now.')), async (context) =>
      prepareRewrite(context, await firstParagraph(context))
    );
    expect(value.placeholders).toEqual([]);
    expect(value.legend).toBe('');
  });

  test('names the bracket pair the draft uses', async () => {
    const bytes = docx(`<w:p>${t('Literal ⟦1⟧ text, see ')}${REF}${t('.')}</w:p>`);
    const { value } = await withRuntime(bytes, async (context) =>
      prepareRewrite(context, await firstParagraph(context))
    );
    expect(value.text).toBe('Literal ⟦1⟧ text, see ⟪1⟫.');
    expect(value.legend).toStartWith('The text contains placeholders, such as ⟪1⟫.');
    expect(value.legend).toEndWith(
      '\n⟪1⟫ = field with code "REF _Ref1 \\\\h", reads "Section 4.2"'
    );
  });
});

describe('draft.check', () => {
  const refused: [string, string, boolean][] = [
    ['placeholder-moved', '⟦3⟧ Under ⟦1⟧ the fee ⟦2⟧ applies', false],
    ['placeholder-unknown', 'Under ⟦1⟧ the fee ⟦9⟧ applies', false],
    ['placeholder-repeated', 'Under ⟦1⟧ the fee ⟦1⟧ applies', false],
    ['invalid-output', 'Under ⟦1⟧ the fee\n⟦2⟧ applies', false],
    ['invalid-output', '   ', false],
    ['placeholder-missing', 'Under ⟦1⟧ the fee applies\tto ⟦3⟧ promptly.', true],
  ];
  for (const [code, output, keepPlaceholders] of refused) {
    test(`returns the error apply() throws: ${code} for ${JSON.stringify(output)}`, async () => {
      const { value } = await withRuntime(RICH, async (context) => {
        const paragraph = await firstParagraph(context);
        const draft = await prepareRewrite(context, paragraph, { keepPlaceholders });
        const checked = draft.check(output);
        const afterCheck = await readBack(context, paragraph);
        const thrown = await rejection(draft.apply(output));
        return { checked, thrown, afterCheck };
      });
      expect(value.checked).toBeInstanceOf(RewriteError);
      expect(value.checked).toMatchObject({ code, isModelError: true });
      expect(value.thrown).toMatchObject({
        code,
        message: (value.checked as RewriteError).message,
      });
      expect(value.afterCheck).toMatchObject({ text: RICH_ORIGINAL, authors: [] });
    });
  }

  test('returns placeholder-grouped for fields that share one place', async () => {
    const bare = (entry: string) =>
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      `<w:r><w:instrText xml:space="preserve"> XE "${entry}" </w:instrText></w:r>` +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const bytes = docx(`<w:p>${t('One ')}${bare('a')}${bare('b')}${t(' two.')}</w:p>`);
    const { value } = await withRuntime(bytes, async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      return { text: draft.text, checked: draft.check('One ⟦1⟧ two.') };
    });
    expect(value.text).toBe('One ⟦1⟧⟦2⟧ two.');
    expect(value.checked).toMatchObject({ code: 'placeholder-grouped', isModelError: true });
  });

  test('returns null for valid text, writes nothing, and apply() then succeeds', async () => {
    const { value } = await withRuntime(RICH, async (context) => {
      const paragraph = await firstParagraph(context);
      const draft = await prepareRewrite(context, paragraph);
      const output = draft.text.replace('fee', 'charge');
      const checked = draft.check(output);
      const afterCheck = await readBack(context, paragraph);
      const result = await draft.apply(output);
      return { checked, afterCheck, result };
    });
    expect(value.checked).toBeNull();
    expect(value.afterCheck).toMatchObject({ text: RICH_ORIGINAL, authors: [] });
    expect(value.result).toMatchObject({ original: RICH_ORIGINAL, changes: 1 });
  });

  test('returns draft-used once the draft wrote, as apply() throws', async () => {
    const { value } = await withRuntime(docx(p('Pay the fee now.')), async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      await draft.apply('Pay the fee today.');
      return {
        checked: draft.check('Pay the fee tomorrow.'),
        thrown: await rejection(draft.apply('Pay the fee tomorrow.')),
      };
    });
    expect(value.checked).toMatchObject({ code: 'draft-used', isModelError: false });
    expect(value.thrown).toMatchObject({ code: 'draft-used' });
  });

  test('a refused apply() leaves the draft usable, and check() says so', async () => {
    const { value } = await withRuntime(docx(p('Pay the fee now.')), async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      await rejection(draft.apply(''));
      return draft.check('Pay the fee today.');
    });
    expect(value).toBeNull();
  });
});
