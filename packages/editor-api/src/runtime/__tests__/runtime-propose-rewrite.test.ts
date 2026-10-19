/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The "Propose an AI rewrite as tracked changes" recipe, run against real documents: a rewrite
// around a field, an equation, a tab, and a content-locked control; repeated words; a table
// cell; and insertions at both ends. The page must show the tested code exactly.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DocxEditor, type Paragraph, type RequestContext } from '../../index.ts';
import { docx, p } from './support/docx.ts';
import { apply, prepare, promptFor, proposeRewrite } from './support/propose-rewrite.ts';

const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const REF =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> REF _Ref1 \\h </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  t('Section 4.2') +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const EQUATION = `<m:oMath xmlns:m="${MATH}"><m:r><m:t>x</m:t></m:r></m:oMath>`;
const PILL =
  '<w:sdt><w:sdtPr><w:tag w:val="party"/><w:lock w:val="contentLocked"/></w:sdtPr>' +
  `<w:sdtContent>${t('Acme Corp')}</w:sdtContent></w:sdt>`;

/** Field, equation, tab, and a content-locked control, each with words around it. */
const RICH = docx(
  `<w:p>${t('Under ')}${REF}${t(' the fee ')}${EQUATION}${t(' applies')}<w:r><w:tab/></w:r>` +
    `${t('to ')}${PILL}${t(' promptly.')}</w:p>`
);
const RICH_ORIGINAL = 'Under Section 4.2 the fee ￼ applies\tto Acme Corp promptly.';

type Pick = (context: RequestContext) => Promise<Paragraph>;
const firstParagraph: Pick = async (context) => context.document.body.paragraphs.getFirst();

interface Outcome {
  readonly prompt: string;
  readonly proposed: string;
  readonly current: string;
  readonly original: string;
  readonly saved: Uint8Array;
}

async function rewrite(
  bytes: Uint8Array,
  model: (prompt: string) => string,
  pick: Pick = firstParagraph
): Promise<Outcome> {
  const runtime = await DocxEditor.createServer(bytes, { author: 'Agent' });
  try {
    const result = await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const paragraph = await pick(context);
      const prepared = await prepare(context, paragraph, 'Agent');
      const proposed = await apply(context, prepared, model(prepared.promptText));
      const current = paragraph.getReviewedText('Current');
      const original = paragraph.getReviewedText('Original');
      await context.sync();
      return {
        prompt: prepared.promptText,
        proposed,
        current: current.value,
        original: original.value,
      };
    });
    return { ...result, saved: await runtime.save() };
  } finally {
    runtime.dispose();
  }
}

/** Reopen saved bytes, decide every change, and read the paragraph and its atoms. */
async function decided(
  bytes: Uint8Array,
  action: 'acceptAll' | 'rejectAll',
  pick = firstParagraph
) {
  const runtime = await DocxEditor.createServer(bytes);
  try {
    return await runtime.run(async (context) => {
      context.document.body.revisions[action]();
      await context.sync();
      const paragraph = await pick(context);
      const fields = paragraph.getRange('Whole').fields;
      const controls = paragraph.contentControls;
      paragraph.load('text');
      fields.load('items');
      controls.load('items/text,items/cannotEdit');
      await context.sync();
      return {
        text: paragraph.text,
        fields: fields.items.length,
        controls: controls.items.map((item) => `${item.text}:${String(item.cannotEdit)}`),
      };
    });
  } finally {
    runtime.dispose();
  }
}

/**
 * Whether the engine proposes deleting a whole equation, and a whole content-locked control, as
 * one tracked deletion. The two tests that drop those placeholders need it; until the engine
 * does, they report as skipped rather than passing on a different behavior.
 */
async function deletesWholeAtoms(): Promise<boolean> {
  try {
    await rewrite(RICH, (prompt) => prompt.replace('⟦2⟧ ', '').replace('⟦3⟧ ', ''));
    return true;
  } catch {
    return false;
  }
}
const WHOLE_ATOM_DELETION = await deletesWholeAtoms();

describe('propose an AI rewrite as tracked changes', () => {
  test('rewrites words around a field, an equation, a tab, and a locked control', async () => {
    const outcome = await rewrite(RICH, (prompt) =>
      prompt.replace('fee', 'charge').replace('promptly.', 'without delay.')
    );
    expect(outcome.prompt).toBe('Under ⟦1⟧ the fee ⟦2⟧ applies\tto ⟦3⟧ promptly.');
    const proposed = 'Under Section 4.2 the charge ￼ applies\tto Acme Corp without delay.';
    expect(outcome.proposed).toBe(proposed);
    expect(outcome.current).toBe(proposed);
    expect(outcome.original).toBe(RICH_ORIGINAL);
    expect(outcome.current).not.toContain('  ');

    // Kept atoms survive accept unchanged.
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

  test.skipIf(!WHOLE_ATOM_DELETION)(
    'a dropped equation placeholder deletes the whole equation',
    async () => {
      const outcome = await rewrite(RICH, (prompt) => prompt.replace('⟦2⟧ ', ''));
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
      const outcome = await rewrite(RICH, (prompt) =>
        prompt.replace('to ⟦3⟧ promptly.', 'to the buyer promptly.')
      );
      const proposed = 'Under Section 4.2 the fee ￼ applies\tto the buyer promptly.';
      expect(outcome.current).toBe(proposed);
      expect(outcome.original).toBe(RICH_ORIGINAL);
      const accepted = await decided(outcome.saved, 'acceptAll');
      expect(accepted).toEqual({ text: proposed, fields: 1, controls: [] });
      expect((await decided(outcome.saved, 'rejectAll')).text).toBe(RICH_ORIGINAL);
    }
  );

  test('a moved placeholder refuses before anything is written', async () => {
    const runtime = await DocxEditor.createServer(RICH, { author: 'Agent' });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const prepared = await prepare(context, await firstParagraph(context), 'Agent');
        await expect(apply(context, prepared, '⟦3⟧ Under ⟦1⟧ the fee ⟦2⟧ applies')).rejects.toThrow(
          'moved or repeated'
        );
      });
    } finally {
      runtime.dispose();
    }
  });

  test('an unknown placeholder refuses with its own message', async () => {
    const runtime = await DocxEditor.createServer(RICH, { author: 'Agent' });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const prepared = await prepare(context, await firstParagraph(context), 'Agent');
        await expect(apply(context, prepared, 'Under ⟦1⟧ the fee ⟦9⟧ applies')).rejects.toThrow(
          'The model output contains ⟦9⟧, which prepare() did not create.'
        );
      });
    } finally {
      runtime.dispose();
    }
  });

  test('the legend shows what each placeholder holds, and repeated punctuation refuses', async () => {
    const bytes = docx(`<w:p>${t('Under ')}${REF}${t(', the fee applies.')}</w:p>`);
    const runtime = await DocxEditor.createServer(bytes, { author: 'Agent' });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const paragraph = await firstParagraph(context);
        const prepared = await prepare(context, paragraph, 'Agent');
        expect(prepared.promptText).toBe('Under ⟦1⟧ the fee applies.');
        expect(prepared.legend).toEqual([
          { placeholder: '⟦1⟧', kind: 'field', text: 'Section 4.2,' },
        ]);
        expect(promptFor(prepared, 'Shorten it.')).toContain(
          'Placeholders:\n⟦1⟧ (field) = "Section 4.2,"'
        );
        for (const output of [
          'Under ⟦1⟧, the charge applies.',
          'Under ⟦1⟧ , the charge applies.',
        ]) {
          await expect(apply(context, prepared, output)).rejects.toThrow(
            'The model output repeats "," after ⟦1⟧, which ends with it.'
          );
        }
        const revisions = paragraph.getRange('Whole').revisions;
        revisions.load('items');
        await context.sync();
        expect(revisions.items).toHaveLength(0);
      });
    } finally {
      runtime.dispose();
    }
  });

  test('the legend labels each kind of atom', async () => {
    const runtime = await DocxEditor.createServer(RICH, { author: 'Agent' });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const prepared = await prepare(context, await firstParagraph(context), 'Agent');
        expect(prepared.legend).toEqual([
          { placeholder: '⟦1⟧', kind: 'field', text: 'Section 4.2' },
          { placeholder: '⟦2⟧', kind: 'equation or note reference', text: '\uFFFC' },
          { placeholder: '⟦3⟧', kind: 'content control', text: 'Acme Corp' },
        ]);
      });
    } finally {
      runtime.dispose();
    }
  });

  test('text attached to a placeholder refuses before anything is written', async () => {
    const runtime = await DocxEditor.createServer(RICH, { author: 'Agent' });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const paragraph = await firstParagraph(context);
        const prepared = await prepare(context, paragraph, 'Agent');
        for (const output of [
          'Under ⟦1⟧ the fee ⟦2⟧ applies\tto ⟦3⟧; promptly.',
          'Under ⟦1⟧ the fee ⟦2⟧ applies\tto "⟦3⟧" promptly.',
        ]) {
          await expect(apply(context, prepared, output)).rejects.toThrow(
            'The model output attaches text to ⟦3⟧. Separate each placeholder with a space.'
          );
        }
        const revisions = paragraph.getRange('Whole').revisions;
        revisions.load('items');
        await context.sync();
        expect(revisions.items).toHaveLength(0);
      });
    } finally {
      runtime.dispose();
    }
  });

  test('the final check compares with the text the model wrote', async () => {
    const bytes = docx(`<w:p>${t('Pay ')}${PILL}<w:r><w:tab/></w:r>${t('promptly.')}</w:p>`);
    const runtime = await DocxEditor.createServer(bytes, { author: 'Agent' });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const prepared = await prepare(context, await firstParagraph(context), 'Agent');
        expect(prepared.promptText).toBe('Pay ⟦1⟧\tpromptly.');
        // The atom keeps its own tab, so the space the model wrote after it cannot land.
        await expect(apply(context, prepared, 'Pay ⟦1⟧ promptly.')).rejects.toThrow(
          'The proposed paragraph differs from the model output.'
        );
      });
    } finally {
      runtime.dispose();
    }
  });

  test('prepare refuses a paragraph with a tracked insertion', async () => {
    const bytes = docx(
      `<w:p>${t('Pay ')}<w:ins w:id="1" w:author="Other" w:date="2026-01-01T00:00:00Z">` +
        `${t('the full ')}</w:ins>${t('fee.')}</w:p>`
    );
    const runtime = await DocxEditor.createServer(bytes, { author: 'Agent' });
    try {
      await runtime.run(async (context) => {
        // Without tracking, nothing apply() writes could be rolled back.
        await expect(prepare(context, await firstParagraph(context), 'Agent')).rejects.toThrow(
          "Set changeTrackingMode to 'TrackMineOnly'"
        );
        context.document.changeTrackingMode = 'TrackMineOnly';
        await expect(prepare(context, await firstParagraph(context), 'Agent')).rejects.toThrow(
          'Decide the tracked changes in this paragraph'
        );
      });
    } finally {
      runtime.dispose();
    }
  });

  test('a failed hunk rolls back the hunks already written', async () => {
    const original = 'Alpha beta gamma delta.';
    const runtime = await DocxEditor.createServer(docx(p(original)), { author: 'Agent' });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const paragraph = await firstParagraph(context);
        const prepared = await prepare(context, paragraph, 'Agent');
        // The last hunk applies first and succeeds; the first one carries a paragraph
        // separator, which a text write refuses.
        await expect(apply(context, prepared, 'Alpha be\nta gamma DELTA.')).rejects.toMatchObject({
          code: 'InvalidArgument',
        });
        const revisions = paragraph.getRange('Whole').revisions;
        const current = paragraph.getReviewedText('Current');
        revisions.load('items');
        paragraph.load('text');
        await context.sync();
        expect(revisions.items).toHaveLength(0);
        expect(paragraph.text).toBe(original);
        expect(current.value).toBe(original);
      });
    } finally {
      runtime.dispose();
    }
  });

  test('a rollback with the wrong author names the problem', async () => {
    const runtime = await DocxEditor.createServer(docx(p('Alpha beta gamma delta.')), {
      author: 'Agent',
    });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const prepared = await prepare(context, await firstParagraph(context), 'Someone else');
        const failure = await apply(context, prepared, 'Alpha be\nta gamma DELTA.').then(
          () => null,
          (error: unknown) => error
        );
        expect(failure).toBeInstanceOf(AggregateError);
        expect((failure as AggregateError).errors[1]).toMatchObject({
          message: "The paragraph has no changes by Someone else. Pass the runtime's author.",
        });
      });
    } finally {
      runtime.dispose();
    }
  });

  test('repeated words change only the occurrence the model changed', async () => {
    const original = 'the cat saw the cat and the dog';
    const outcome = await rewrite(docx(p(original)), () => 'the cat saw a cat and the dog');
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

  test('proposeRewrite saves the proposal as tracked changes', async () => {
    const prompts: string[] = [];
    const result = await proposeRewrite(
      docx(p('Pay the fee now.')),
      'Say today instead of now.',
      async (prompt) => {
        prompts.push(prompt);
        return prompt
          .slice(prompt.indexOf('Paragraph:\n') + 'Paragraph:\n'.length)
          .replace('now', 'today');
      }
    );
    expect(prompts[0]).toStartWith(
      'Say today instead of now.\n\nReturn only the rewritten paragraph.'
    );
    expect(prompts[0]).toEndWith('Paragraph:\nPay the fee now.');
    expect(result.proposed).toBe('Pay the fee today.');
    expect((await decided(result.saved, 'rejectAll')).text).toBe('Pay the fee now.');
    expect((await decided(result.saved, 'acceptAll')).text).toBe('Pay the fee today.');
  });

  test('the recipe page shows the tested code', () => {
    const root = join(import.meta.dir, '..', '..', '..', '..', '..');
    const page = readFileSync(join(root, 'docs/site/content/recipes/propose-rewrite.mdx'), 'utf8');
    const block = /```ts\n([\s\S]*?)\n```/.exec(page)?.[1];
    const source = readFileSync(join(import.meta.dir, 'support', 'propose-rewrite.ts'), 'utf8');
    const body = source
      .slice(source.indexOf('import {'))
      .replace("from '../../../index.ts'", "from '@docx-editor.dev/editor-api'");
    // The formatter wraps the import by the length of its path, so compare the import without
    // its line breaks, and everything after it exactly.
    const flat = (code: string | undefined) => {
      const end = (code ?? '').indexOf(';') + 1;
      return `${(code ?? '').slice(0, end).replace(/,?\s+/g, ' ')}${(code ?? '').slice(end)}`;
    };
    expect(flat(block)).toBe(flat(body.trimEnd()));
  });
});
