/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Ranges over words for an agent that rewrites a paragraph: `getTextRanges` to split it, `expandTo` and
// `getRange` to address a run of words, and `getReviewedText` to read the proposed result back.

import { describe, expect, test } from 'bun:test';
import { DocxEditor, type DocxEditorServerRuntime, type Range } from '../../index.ts';
import { docx, p } from './support/docx.ts';

const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

/** One paragraph with a field, a tab, an equation, and an inline content control. */
const RICH =
  '<w:p>' +
  t('The fee is ') +
  '<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>' +
  t(' per unit') +
  '<w:r><w:tab/></w:r>' +
  t('as ') +
  `<m:oMath xmlns:m="${MATH}"><m:r><m:t>x</m:t></m:r></m:oMath>` +
  t(' shows and ') +
  '<w:sdt><w:sdtPr><w:id w:val="5"/></w:sdtPr><w:sdtContent>' +
  t('Acme Corp') +
  '</w:sdtContent></w:sdt>' +
  t(' agrees promptly.') +
  '</w:p>';

const open = (bytes: Uint8Array) => DocxEditor.createServer(bytes, { author: 'Agent' });

async function words(
  runtime: DocxEditorServerRuntime,
  marks: string[],
  trimSpacing?: boolean
): Promise<string[]> {
  return runtime.run(async (context) => {
    const ranges = context.document.body.paragraphs.getFirst().getTextRanges(marks, trimSpacing);
    ranges.load('items/text');
    await context.sync();
    return ranges.items.map((range) => range.text);
  });
}

async function reviewed(runtime: DocxEditorServerRuntime) {
  return runtime.run(async (context) => {
    const paragraph = context.document.body.paragraphs.getFirst();
    const current = paragraph.getReviewedText('Current');
    const original = paragraph.getReviewedText('Original');
    const fallback = paragraph.getReviewedText();
    paragraph.load('text');
    await context.sync();
    return {
      current: current.value,
      original: original.value,
      fallback: fallback.value,
      text: paragraph.text,
    };
  });
}

describe('getTextRanges', () => {
  test('splits after each mark and keeps the mark without trimSpacing', async () => {
    const runtime = await open(docx(p('Alpha beta  gamma.')));
    try {
      expect(await words(runtime, [' '])).toEqual(['Alpha ', 'beta ', ' ', 'gamma.']);
      expect(await words(runtime, [' '], true)).toEqual(['Alpha', 'beta', 'gamma.']);
      expect(await words(runtime, ['.', ' '], false)).toEqual(['Alpha ', 'beta ', ' ', 'gamma.']);
    } finally {
      runtime.dispose();
    }
  });

  test('keeps fields, equations, and content controls inside tokens', async () => {
    const runtime = await open(docx(RICH));
    try {
      expect(await words(runtime, [' ', '\t'], true)).toEqual([
        'The',
        'fee',
        'is',
        '7',
        'per',
        'unit',
        'as',
        '￼',
        'shows',
        'and',
        'Acme',
        'Corp',
        'agrees',
        'promptly.',
      ]);
      // A tab is spacing, not a mark: it joins the words around it unless listed.
      expect(await words(runtime, [' '], true)).toContain('unit\tas');
    } finally {
      runtime.dispose();
    }
  });

  test('a range splits only its own span and stops at each paragraph end', async () => {
    const runtime = await open(docx(p('one two three') + p('four five')));
    try {
      const texts = await runtime.run(async (context) => {
        const middle = context.document.body.search('two three').getFirst();
        const body = context.document.body.getRange('Whole');
        const inMatch = middle.getTextRanges([' ']);
        const inBody = body.getTextRanges([' '], true);
        inMatch.load('items/text');
        inBody.load('items/text');
        await context.sync();
        return {
          match: inMatch.items.map((range) => range.text),
          body: inBody.items.map((range) => range.text),
        };
      });
      expect(texts.match).toEqual(['two ', 'three']);
      expect(texts.body).toEqual(['one', 'two', 'three', 'four', 'five']);
    } finally {
      runtime.dispose();
    }
  });

  test('refuses bad marks at the call', async () => {
    const runtime = await open(docx(p('a b')));
    try {
      await runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        expect(() => paragraph.getTextRanges([])).toThrow(
          expect.objectContaining({ code: 'InvalidArgument' })
        );
        expect(() => paragraph.getTextRanges([''])).toThrow(
          expect.objectContaining({ code: 'InvalidArgument' })
        );
        expect(() => paragraph.getTextRanges([' '], 'yes' as never)).toThrow(
          expect.objectContaining({ code: 'InvalidArgument' })
        );
      });
    } finally {
      runtime.dispose();
    }
  });
});

describe('expandTo and getRange', () => {
  test('expandTo covers both ranges in either order and across paragraphs', async () => {
    const runtime = await open(docx(p('one two three') + p('four five')));
    try {
      const texts = await runtime.run(async (context) => {
        const first = context.document.body.paragraphs.getFirst().getTextRanges([' '], true);
        const last = context.document.body.paragraphs.getLast().getTextRanges([' '], true);
        first.load('items');
        last.load('items');
        await context.sync();
        const forward = first.items[1]!.expandTo(first.items[2]!);
        const backward = first.items[2]!.expandTo(first.items[0]!);
        const across = first.items[1]!.expandTo(last.items[0]!);
        forward.load('text');
        backward.load('text');
        across.load('text');
        await context.sync();
        return [forward.text, backward.text, across.text];
      });
      expect(texts).toEqual(['two three', 'one two three', 'two three\rfour']);
    } finally {
      runtime.dispose();
    }
  });

  test('getRange answers the whole range or one endpoint and refuses After', async () => {
    const runtime = await open(docx(p('alpha beta')));
    try {
      await runtime.run(async (context) => {
        const match = context.document.body.search('beta').getFirst();
        const whole = match.getRange();
        const content = match.getRange('Content');
        const start = match.getRange('Start');
        const end = match.getRange('End');
        for (const range of [whole, content, start, end]) range.load('text');
        await context.sync();
        expect([whole.text, content.text, start.text, end.text]).toEqual(['beta', 'beta', '', '']);
        expect(() => match.getRange('After')).toThrow(
          expect.objectContaining({ code: 'NotSupported' })
        );
        expect(() => match.getRange('Before' as never)).toThrow(
          expect.objectContaining({ code: 'InvalidArgument' })
        );
        // An endpoint is an insertion point for a write in the same sync.
        match.getRange('Start').insertText('the ', 'Start');
        await context.sync();
        const paragraph = context.document.body.paragraphs.getFirst();
        paragraph.load('text');
        await context.sync();
        expect(paragraph.text).toBe('alpha the beta');
      });
    } finally {
      runtime.dispose();
    }
  });

  test('expandTo refuses a range from another run', async () => {
    const runtime = await open(docx(p('alpha beta')));
    try {
      let outside: Range | undefined;
      await runtime.run(async (context) => {
        outside = context.document.body.search('alpha').getFirst();
        await context.sync();
      });
      await runtime.run(async (context) => {
        const match = context.document.body.search('beta').getFirst();
        expect(() => match.expandTo(outside!)).toThrow(
          expect.objectContaining({ code: 'InvalidArgument' })
        );
      });
    } finally {
      runtime.dispose();
    }
  });
});

describe('a tracked rewrite through word ranges', () => {
  test('replace, insert after, and delete tokens, then read the result back', async () => {
    const runtime = await open(docx(RICH));
    try {
      const tokens = await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const words = context.document.body.paragraphs.getFirst().getTextRanges([' ']);
        words.load('items/text');
        await context.sync();
        const texts = words.items.map((range) => range.text);
        // Plan by token index and apply from the last index to the first: an edit after a range
        // keeps it valid, so every range read before the first edit stays usable. Each token
        // carries its trailing space, so a deletion leaves single spaces.
        words.items[7]!.delete();
        await context.sync();
        words.items[4]!.insertText('net ', 'After');
        await context.sync();
        words.items[0]!.expandTo(words.items[1]!).insertText('Each charge ', 'Replace');
        await context.sync();
        return texts;
      });
      expect(tokens).toEqual([
        'The ',
        'fee ',
        'is ',
        '7 ',
        'per ',
        'unit\tas ',
        '\uFFFC ',
        'shows ',
        'and ',
        'Acme ',
        'Corp ',
        'agrees ',
        'promptly.',
      ]);

      const proposed = 'Each charge is 7 per net unit\tas \uFFFC and Acme Corp agrees promptly.';
      const before = 'The fee is 7 per unit\tas \uFFFC shows and Acme Corp agrees promptly.';
      const read = await reviewed(runtime);
      expect(read.current).toBe(proposed);
      expect(read.fallback).toBe(proposed);
      expect(read.original).toBe(before);
      // The plain text reads both versions at once.
      expect(read.text).toContain('The fee');
      expect(read.text).toContain('Each charge');

      const saved = await runtime.save();
      const reopened = await open(saved);
      try {
        expect(await reviewed(reopened)).toMatchObject({ current: proposed, original: before });
        await reopened.run(async (context) => {
          context.document.body.revisions.acceptAll();
          await context.sync();
        });
        const accepted = await reviewed(reopened);
        expect(accepted).toMatchObject({ current: proposed, original: proposed, text: proposed });
      } finally {
        reopened.dispose();
      }

      const rejecting = await open(saved);
      try {
        await rejecting.run(async (context) => {
          context.document.body.revisions.rejectAll();
          await context.sync();
        });
        expect(await reviewed(rejecting)).toMatchObject({
          current: before,
          original: before,
          text: before,
        });
      } finally {
        rejecting.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  test('reviewed text joins paragraphs whose mark is proposed for deletion', async () => {
    const runtime = await open(docx(p('First clause.') + p('Second clause.') + p('Third.')));
    try {
      const read = await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        paragraphs.items[1]!.delete();
        await context.sync();
        const whole = context.document.body.getRange('Whole');
        const current = whole.getReviewedText('Current');
        const original = whole.getReviewedText('Original');
        await context.sync();
        return { current: current.value, original: original.value };
      });
      expect(read.original).toBe('First clause.\rSecond clause.\rThird.');
      expect(read.current).toBe('First clause.\rThird.');
    } finally {
      runtime.dispose();
    }
  });

  test('getReviewedText refuses an unknown version at the call', async () => {
    const runtime = await open(docx(p('a b')));
    try {
      await runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        expect(() => paragraph.getReviewedText('current' as never)).toThrow(
          expect.objectContaining({ code: 'InvalidArgument' })
        );
      });
    } finally {
      runtime.dispose();
    }
  });

  test('the original text view leaves out tokens that only an insertion holds', async () => {
    const bytes = docx(
      '<w:p>' +
        t('keep ') +
        '<w:ins w:id="1" w:author="Ada"><w:r><w:t xml:space="preserve">added </w:t></w:r></w:ins>' +
        t('end') +
        '</w:p>'
    );
    const runtime = await DocxEditor.createServer(bytes, { revisionTextView: 'original' });
    try {
      expect(await words(runtime, [' '], true)).toEqual(['keep', 'end']);
    } finally {
      runtime.dispose();
    }
  });

  test('a range never reaches hidden text at its edges', async () => {
    const bytes = docx(
      '<w:p>' +
        t('The quick') +
        '<w:ins w:id="1" w:author="Other" w:date="2026-01-01T00:00:00Z">' +
        t('slow') +
        '</w:ins>' +
        t(' fox') +
        '</w:p>'
    );
    const runtime = await DocxEditor.createServer(bytes, {
      author: 'Agent',
      revisionTextView: 'original',
    });
    try {
      const read = await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const paragraph = context.document.body.paragraphs.getFirst();
        const tokens = paragraph.getTextRanges([' '], true);
        tokens.load('items/text');
        await context.sync();
        const texts = tokens.items.map((range) => range.text);
        tokens.items[1]!.insertText('fast', 'Replace');
        await context.sync();
        const current = paragraph.getReviewedText('Current');
        const original = paragraph.getReviewedText('Original');
        await context.sync();
        return { texts, current: current.value, original: original.value };
      });
      expect(read.texts).toEqual(['The', 'quick', 'fox']);
      // The other author's pending insertion stays: the edit replaced only what the range read.
      expect(read.current).toBe('The fastslow fox');
      expect(read.original).toBe('The quick fox');
    } finally {
      runtime.dispose();
    }
  });

  test('a mark inside hidden text does not split a shown word', async () => {
    const bytes = docx(
      '<w:p>' +
        t('foo') +
        '<w:ins w:id="1" w:author="Other" w:date="2026-01-01T00:00:00Z">' +
        t(' ') +
        '</w:ins>' +
        t('bar baz') +
        '</w:p>'
    );
    const runtime = await DocxEditor.createServer(bytes, { revisionTextView: 'original' });
    try {
      expect(await words(runtime, [' '], true)).toEqual(['foobar', 'baz']);
    } finally {
      runtime.dispose();
    }
  });

  test('refuses a mark with an unpaired surrogate', async () => {
    const runtime = await open(docx(p('a \u{1F600} b')));
    try {
      await runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        for (const mark of ['\uD83D', '\uDE00', 'a\uD83D'])
          expect(() => paragraph.getTextRanges([mark])).toThrow(
            expect.objectContaining({ code: 'InvalidArgument' })
          );
      });
      expect(await words(runtime, ['\u{1F600}'], true)).toEqual(['a \u{1F600}', 'b']);
    } finally {
      runtime.dispose();
    }
  });
});
