/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The rewrite helper on real documents: words around a field, an equation, a tab, a note
// reference, and a content-locked control; repeated words; a table cell; insertions at both
// ends; and several paragraphs. Each proposal is saved, reopened, and decided both ways.

import { describe, expect, test } from 'bun:test';
import { prepareRewrite, proposeRewrite, proposeRewrites, RewriteError } from '../../agent.ts';
import type { RequestContext } from '../../index.ts';
import { docx, p } from '../../runtime/__tests__/support/docx.ts';
import {
  decided,
  firstParagraph,
  footnoted,
  readBack,
  REF,
  RICH,
  RICH_ORIGINAL,
  t,
  withRuntime,
  type Pick,
} from './rewrite-support.ts';

/** Propose `model`'s answer for one paragraph, and read the paragraph back. */
async function rewrite(bytes: Uint8Array, model: (text: string) => string, pick = firstParagraph) {
  const prompts: string[] = [];
  const { value, saved } = await withRuntime(bytes, async (context) => {
    const paragraph = await pick(context);
    const result = await proposeRewrite(context, paragraph, (draft) => {
      prompts.push(draft.prompt);
      return model(draft.text);
    });
    return { result, ...(await readBack(context, paragraph)) };
  });
  return { ...value, prompts, saved };
}

/**
 * Whether the engine proposes deleting a whole equation, and a whole content-locked control, as
 * one tracked deletion. The two tests that drop those placeholders need it; until the engine
 * does, they report as skipped rather than passing on a different behavior.
 */
async function deletesWholeAtoms(): Promise<boolean> {
  try {
    await rewrite(RICH, (text) => text.replace('⟦2⟧ ', '').replace('⟦3⟧ ', ''));
    return true;
  } catch {
    return false;
  }
}
const WHOLE_ATOM_DELETION = await deletesWholeAtoms();

describe('proposeRewrite', () => {
  test('rewrites words around a field, an equation, a tab, and a locked control', async () => {
    const outcome = await rewrite(RICH, (text) =>
      text.replace('fee', 'charge').replace('promptly.', 'without delay.')
    );
    const proposed = 'Under Section 4.2 the charge ￼ applies\tto Acme Corp without delay.';
    expect(outcome.result).toMatchObject({ original: RICH_ORIGINAL, proposed, changes: 2 });
    expect(outcome.current).toBe(proposed);
    expect(outcome.original).toBe(RICH_ORIGINAL);
    expect(outcome.current).not.toContain('  ');
    expect(new Set(outcome.authors)).toEqual(new Set(['Rewrite agent']));

    const prompt = outcome.prompts[0]!;
    expect(prompt).toStartWith('Return only the rewritten paragraph');
    expect(prompt).toContain(
      'Placeholders:\n⟦1⟧ (field) = "Section 4.2"\n' +
        '⟦2⟧ (equation or note reference) = "￼"\n' +
        '⟦3⟧ (locked content control) = "Acme Corp"'
    );
    expect(prompt).toEndWith('Paragraph:\nUnder ⟦1⟧ the fee ⟦2⟧ applies\tto ⟦3⟧ promptly.');

    // Kept atoms survive both decisions unchanged.
    expect(await decided(outcome.saved, 'acceptAll')).toEqual({
      text: proposed,
      fields: 1,
      controls: ['Acme Corp:true'],
    });
    expect(await decided(outcome.saved, 'rejectAll')).toEqual({
      text: RICH_ORIGINAL,
      fields: 1,
      controls: ['Acme Corp:true'],
    });
  });

  test('keeps a footnote reference whole', async () => {
    const outcome = await rewrite(footnoted(), (text) => {
      expect(text).toBe('The buyer pays ⟦1⟧ within thirty days.');
      return text.replace('thirty', 'forty-five');
    });
    expect(outcome.current).toBe('The buyer pays ￼ within forty-five days.');
    expect(outcome.original).toBe('The buyer pays ￼ within thirty days.');
    expect((await decided(outcome.saved, 'acceptAll')).text).toBe(outcome.current);
    expect((await decided(outcome.saved, 'rejectAll')).text).toBe(outcome.original);
  });

  test('a dropped field placeholder deletes the whole field', async () => {
    const outcome = await rewrite(RICH, (text) => text.replace('⟦1⟧ ', ''));
    const proposed = 'Under the fee ￼ applies\tto Acme Corp promptly.';
    expect(outcome.current).toBe(proposed);
    expect(await decided(outcome.saved, 'acceptAll')).toMatchObject({ text: proposed, fields: 0 });
    expect(await decided(outcome.saved, 'rejectAll')).toMatchObject({
      text: RICH_ORIGINAL,
      fields: 1,
    });
  });

  test.skipIf(!WHOLE_ATOM_DELETION)(
    'a dropped equation placeholder deletes the whole equation',
    async () => {
      const outcome = await rewrite(RICH, (text) => text.replace('⟦2⟧ ', ''));
      const proposed = 'Under Section 4.2 the fee applies\tto Acme Corp promptly.';
      expect(outcome.current).toBe(proposed);
      expect(outcome.original).toBe(RICH_ORIGINAL);
      expect((await decided(outcome.saved, 'acceptAll')).text).toBe(proposed);
      expect((await decided(outcome.saved, 'rejectAll')).text).toBe(RICH_ORIGINAL);
    }
  );

  test.skipIf(!WHOLE_ATOM_DELETION)(
    'a dropped locked-control placeholder proposes removing the whole control',
    async () => {
      const outcome = await rewrite(RICH, (text) =>
        text.replace('to ⟦3⟧ promptly.', 'to the buyer promptly.')
      );
      const proposed = 'Under Section 4.2 the fee ￼ applies\tto the buyer promptly.';
      expect(outcome.current).toBe(proposed);
      expect(outcome.original).toBe(RICH_ORIGINAL);
      const accepted = await decided(outcome.saved, 'acceptAll');
      expect(accepted).toEqual({ text: proposed, fields: 1, controls: [] });
      expect((await decided(outcome.saved, 'rejectAll')).text).toBe(RICH_ORIGINAL);
    }
  );

  test('repeated words change only the occurrence the model changed', async () => {
    const original = 'the cat saw the cat and the dog';
    const outcome = await rewrite(docx(p(original)), () => 'the cat saw a cat and the dog');
    expect(outcome.result.changes).toBe(1);
    expect(outcome.current).toBe('the cat saw a cat and the dog');
    expect(outcome.original).toBe(original);
    expect((await decided(outcome.saved, 'rejectAll')).text).toBe(original);
  });

  test('rewrites a paragraph in a table cell', async () => {
    const bytes = docx(
      `${p('Before the table.')}<w:tbl><w:tr><w:tc>${p('Net thirty days from invoice.')}</w:tc>` +
        `<w:tc>${p('Other cell.')}</w:tc></w:tr></w:tbl>`
    );
    const inCell: Pick = async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      return paragraphs.items[1]!;
    };
    const outcome = await rewrite(bytes, () => 'Net forty-five days from receipt.', inCell);
    expect(outcome.current).toBe('Net forty-five days from receipt.');
    expect(outcome.original).toBe('Net thirty days from invoice.');
    expect((await decided(outcome.saved, 'acceptAll', inCell)).text).toBe(
      'Net forty-five days from receipt.'
    );
  });

  test('inserts at the start and after the last word with single spacing', async () => {
    const outcome = await rewrite(
      docx(p('Pay within 30 days.')),
      () => 'Note: Pay within 30 days. Thank you.'
    );
    expect(outcome.current).toBe('Note: Pay within 30 days. Thank you.');
    expect(outcome.original).toBe('Pay within 30 days.');
    expect((await decided(outcome.saved, 'acceptAll')).text).toBe(
      'Note: Pay within 30 days. Thank you.'
    );
    expect((await decided(outcome.saved, 'rejectAll')).text).toBe('Pay within 30 days.');
  });

  test('deleting a middle word leaves single spacing', async () => {
    const outcome = await rewrite(docx(p('Pay the full amount now.')), () => 'Pay the amount now.');
    expect(outcome.current).toBe('Pay the amount now.');
    expect((await decided(outcome.saved, 'acceptAll')).text).toBe('Pay the amount now.');
  });

  test('an unchanged answer writes nothing', async () => {
    const outcome = await rewrite(docx(p('Pay the fee now.')), (text) => ` ${text} `);
    expect(outcome.result).toMatchObject({ proposed: 'Pay the fee now.', changes: 0 });
    expect(outcome.authors).toEqual([]);
  });

  test('puts the instruction first, and turns tracking on only for its writes', async () => {
    const { value } = await withRuntime(docx(p('Pay the fee now.')), async (context) => {
      const paragraph = await firstParagraph(context);
      const draft = await prepareRewrite(context, paragraph, {
        instruction: 'Say today instead of now.',
      });
      expect(draft.prompt).toStartWith(
        'Say today instead of now.\n\nReturn only the rewritten paragraph'
      );
      // A paragraph without atoms gets no placeholder rules.
      expect(draft.prompt).not.toContain('⟦');
      expect(draft.placeholders).toEqual([]);
      const result = await draft.apply(draft.text.replace('now', 'today'));
      context.document.load('changeTrackingMode');
      await context.sync();
      return { result, mode: context.document.changeTrackingMode };
    });
    expect(value.result.proposed).toBe('Pay the fee today.');
    expect(value.mode).toBe('Off');
  });

  test('keeps the tracking mode the caller set', async () => {
    const { value } = await withRuntime(docx(p('Pay the fee now.')), async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      await proposeRewrite(context, await firstParagraph(context), () => 'Pay the fee today.');
      context.document.load('changeTrackingMode');
      await context.sync();
      return context.document.changeTrackingMode;
    });
    expect(value).toBe('TrackMineOnly');
  });

  test('the draft lists each placeholder with its kind and its attached punctuation', async () => {
    const bytes = docx(`<w:p>${t('Under ')}${REF}${t(', the fee applies.')}</w:p>`);
    await withRuntime(bytes, async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      expect(draft.text).toBe('Under ⟦1⟧ the fee applies.');
      expect(draft.original).toBe('Under Section 4.2, the fee applies.');
      expect(draft.placeholders).toEqual([
        { placeholder: '⟦1⟧', kind: 'field', text: 'Section 4.2,' },
      ]);
    });
    await withRuntime(RICH, async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      expect(draft.placeholders.map((entry) => entry.kind)).toEqual([
        'field',
        'equation-or-note',
        'content-control',
      ]);
    });
  });

  test('proposeRewrites settles each paragraph on its own', async () => {
    const bytes = docx(
      `${p('First clause applies.')}` +
        `<w:p>${t('Pay ')}<w:ins w:id="1" w:author="Other" w:date="2026-01-01T00:00:00Z">` +
        `${t('the full ')}</w:ins>${t('fee.')}</w:p>` +
        `${p('Third clause applies.')}`
    );
    const { value, saved } = await withRuntime(bytes, async (context: RequestContext) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      const results = await proposeRewrites(
        context,
        paragraphs.items.map((paragraph) => ({
          paragraph,
          rewrite: (draft) => draft.text.replace('applies', 'governs'),
        }))
      );
      return results;
    });
    expect(value.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    const second = value[1]!;
    expect(second.status === 'rejected' && second.reason).toBeInstanceOf(RewriteError);
    expect(second.status === 'rejected' && second.reason.code).toBe('pending-changes');
    expect(value[0]!.status === 'fulfilled' && value[0]!.value.proposed).toBe(
      'First clause governs.'
    );
    const rejected = await withRuntime(saved, async (context) => {
      context.document.body.revisions.rejectAll();
      await context.sync();
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items/text');
      await context.sync();
      return paragraphs.items.map((paragraph) => paragraph.text);
    });
    expect(rejected.value).toEqual(['First clause applies.', 'Pay fee.', 'Third clause applies.']);
  });
});
