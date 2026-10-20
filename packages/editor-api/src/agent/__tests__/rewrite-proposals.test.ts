/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The rewrite helper on real documents: words around a field, an equation, a tab, a note
// reference, and a content-locked control; repeated words; a table cell; insertions at both
// ends; and several paragraphs. Each proposal is saved, reopened, and decided both ways.

import { describe, expect, test } from 'bun:test';
import { prepareRewrite, RewriteError, type RewriteDraft } from '../../agent.ts';
import type { RequestContext } from '../../index.ts';
import { docx, p } from '../../runtime/__tests__/support/docx.ts';
import {
  decided,
  firstParagraph,
  footnoted,
  readBack,
  REF,
  rewriteParagraph,
  RICH,
  RICH_ORIGINAL,
  EQUATION,
  PILL,
  pictured,
  t,
  withRuntime,
  type Pick,
} from './rewrite-support.ts';

/** Propose `model`'s text for one paragraph, and read the paragraph back. */
async function rewrite(bytes: Uint8Array, model: (text: string) => string, pick = firstParagraph) {
  const drafts: RewriteDraft[] = [];
  const { value, saved } = await withRuntime(bytes, async (context) => {
    const paragraph = await pick(context);
    const result = await rewriteParagraph(context, paragraph, (text, draft) => {
      drafts.push(draft);
      return model(text);
    });
    return { result, ...(await readBack(context, paragraph)) };
  });
  return { ...value, draft: drafts[0]!, saved };
}

/** The legend of the paragraph with a field, an equation, and a locked control. */
const RICH_LEGEND_LINES =
  'Placeholders:\n' +
  '⟦1⟧ = field with code "REF _Ref1 \\\\h", reads "Section 4.2"\n' +
  '⟦2⟧ = equation\n' +
  '⟦3⟧ = locked content control named "party", reads "Acme Corp"';

describe('prepareRewrite and apply', () => {
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

    expect(outcome.draft.text).toBe('Under ⟦1⟧ the fee ⟦2⟧ applies\tto ⟦3⟧ promptly.');
    expect(outcome.draft.legend).toEndWith(`\n\n${RICH_LEGEND_LINES}`);

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
      expect(text).toBe('The buyer pays⟦1⟧ within thirty days.');
      return text.replace('thirty', 'forty-five');
    });
    expect(outcome.current).toBe('The buyer pays\uFFFC within forty-five days.');
    expect(outcome.original).toBe('The buyer pays\uFFFC within thirty days.');
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

  test('a dropped equation placeholder deletes the whole equation', async () => {
    const outcome = await rewrite(RICH, (text) => text.replace('⟦2⟧ ', ''));
    const proposed = 'Under Section 4.2 the fee applies\tto Acme Corp promptly.';
    expect(outcome.current).toBe(proposed);
    expect(outcome.original).toBe(RICH_ORIGINAL);
    expect((await decided(outcome.saved, 'acceptAll')).text).toBe(proposed);
    expect((await decided(outcome.saved, 'rejectAll')).text).toBe(RICH_ORIGINAL);
  });

  test('a dropped locked-control placeholder proposes removing the whole control', async () => {
    const outcome = await rewrite(RICH, (text) =>
      text.replace('to ⟦3⟧ promptly.', 'to the buyer promptly.')
    );
    const proposed = 'Under Section 4.2 the fee ￼ applies\tto the buyer promptly.';
    expect(outcome.current).toBe(proposed);
    expect(outcome.original).toBe(RICH_ORIGINAL);
    const accepted = await decided(outcome.saved, 'acceptAll');
    expect(accepted).toEqual({ text: proposed, fields: 1, controls: [] });
    expect((await decided(outcome.saved, 'rejectAll')).text).toBe(RICH_ORIGINAL);
  });

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

  test('turns tracking on only for its writes', async () => {
    const { value } = await withRuntime(docx(p('Pay the fee now.')), async (context) => {
      const paragraph = await firstParagraph(context);
      const draft = await prepareRewrite(context, paragraph);
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
      await context.sync();
      await rewriteParagraph(context, await firstParagraph(context), () => 'Pay the fee today.');
      context.document.load('changeTrackingMode');
      await context.sync();
      return context.document.changeTrackingMode;
    });
    expect(value).toBe('TrackMineOnly');
  });

  test('a placeholder covers only its atom, and the text beside it stays editable', async () => {
    const bytes = docx(
      `<w:p>${t('Subject to ')}${REF}${t(', the fee herein')}${EQUATION}${t('. applies to (')}` +
        `${PILL}${t('); see "')}${REF}${t('".')}</w:p>`
    );
    const original =
      'Subject to Section 4.2, the fee herein\uFFFC. applies to (Acme Corp); see "Section 4.2".';
    let draftText = '';
    const outcome = await rewrite(bytes, (text) => {
      draftText = text;
      // The model rewrites the text beside every atom and keeps each atom.
      return text
        .replace('⟦1⟧,', '⟦1⟧;')
        .replace('herein⟦2⟧.', 'hereinafter⟦2⟧:')
        .replace('(⟦3⟧);', '⟦3⟧,')
        .replace('"⟦4⟧".', '⟦4⟧.');
    });
    expect(draftText).toBe('Subject to ⟦1⟧, the fee herein⟦2⟧. applies to (⟦3⟧); see "⟦4⟧".');
    const proposed =
      'Subject to Section 4.2; the fee hereinafter\uFFFC: applies to Acme Corp, see Section 4.2.';
    expect(outcome.current).toBe(proposed);
    expect(outcome.original).toBe(original);
    expect(await decided(outcome.saved, 'acceptAll')).toEqual({
      text: proposed,
      fields: 2,
      controls: ['Acme Corp:true'],
    });
    expect((await decided(outcome.saved, 'rejectAll')).text).toBe(original);
  });

  test('the model can put punctuation back beside a placeholder', async () => {
    const bytes = docx(`<w:p>${t('Under ')}${REF}${t(', the fee applies.')}</w:p>`);
    const outcome = await rewrite(bytes, (text) => {
      expect(text).toBe('Under ⟦1⟧, the fee applies.');
      return 'Under ⟦1⟧, the charge applies.';
    });
    expect(outcome.current).toBe('Under Section 4.2, the charge applies.');
    expect(outcome.result.changes).toBe(1);
  });

  test('the legend describes each atom by what it is', async () => {
    await withRuntime(RICH, async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      expect(draft.placeholders).toEqual([
        {
          placeholder: '⟦1⟧',
          kind: 'field',
          text: 'Section 4.2',
          description: 'field with code "REF _Ref1 \\\\h", reads "Section 4.2"',
        },
        { placeholder: '⟦2⟧', kind: 'equation', text: '\uFFFC', description: 'equation' },
        {
          placeholder: '⟦3⟧',
          kind: 'content-control',
          text: 'Acme Corp',
          description: 'locked content control named "party", reads "Acme Corp"',
        },
      ]);
    });
    await withRuntime(footnoted(), async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      expect(draft.placeholders).toEqual([
        {
          placeholder: '⟦1⟧',
          kind: 'note-reference',
          text: '\uFFFC',
          description: 'footnote or endnote reference mark',
        },
      ]);
    });
    await withRuntime(await pictured(), async (context) => {
      const draft = await prepareRewrite(context, await firstParagraph(context));
      expect(draft.text).toBe('See the logo⟦1⟧ above.');
      expect(draft.placeholders).toEqual([
        {
          placeholder: '⟦1⟧',
          kind: 'picture',
          text: '\uFFFC',
          description: 'picture, described as "Company logo"',
        },
      ]);
    });
  });

  test('several paragraphs: prepare all, then apply one after another', async () => {
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
      const drafts: (RewriteDraft | RewriteError)[] = [];
      for (const paragraph of paragraphs.items) {
        drafts.push(
          await prepareRewrite(context, paragraph).catch((error: unknown) => {
            if (error instanceof RewriteError) return error;
            throw error;
          })
        );
      }
      // The model calls take plain text only, so they can run at once.
      const texts = await Promise.all(
        drafts.map(async (draft) =>
          draft instanceof RewriteError ? null : draft.text.replace('applies', 'governs')
        )
      );
      const results = [];
      for (const [index, draft] of drafts.entries()) {
        const text = texts[index];
        if (draft instanceof RewriteError || text == null) results.push(draft);
        else results.push(await draft.apply(text));
      }
      return results;
    });
    expect(value[0]).toMatchObject({ proposed: 'First clause governs.', changes: 1 });
    expect(value[1]).toBeInstanceOf(RewriteError);
    expect(value[1]).toMatchObject({ code: 'pending-changes' });
    expect(value[2]).toMatchObject({ proposed: 'Third clause governs.', changes: 1 });
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

  test('two applies at once on one context: the second is refused with busy', async () => {
    const bytes = docx(p('One applies.') + p('Two applies.'));
    const { value } = await withRuntime(bytes, async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      const first = await prepareRewrite(context, paragraphs.items[0]!);
      const second = await prepareRewrite(context, paragraphs.items[1]!);
      const settled = await Promise.allSettled([
        first.apply('One governs.'),
        second.apply('Two governs.'),
      ]);
      // The refused draft did not write, so it applies once the first apply ends.
      const later = await second.apply('Two governs.');
      return { settled, later, after: await readBack(context, paragraphs.items[1]!) };
    });
    expect(value.settled[0]).toMatchObject({
      status: 'fulfilled',
      value: { proposed: 'One governs.' },
    });
    expect(value.settled[1]).toMatchObject({ status: 'rejected', reason: { code: 'busy' } });
    const reason = (value.settled[1] as PromiseRejectedResult).reason as RewriteError;
    expect(reason.message).toContain('apply drafts one after another');
    expect(value.later.proposed).toBe('Two governs.');
    expect(value.after.current).toBe('Two governs.');
  });
});
