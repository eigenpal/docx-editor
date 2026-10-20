/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Range.revisions`: the tracked changes a range overlaps, from any story, and the
// range-scoped collection decisions.

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createServer } from '../../runtime/server.ts';
import type { RequestContext } from '../../runtime/request-context.ts';
import type { Range } from '../range.ts';
import type { RevisionCollection } from '../review.ts';
import { WITH_REVISION_FOOTNOTE } from './support/documents.ts';
import { REVIEW_DOCUMENT } from './support/review-documents.ts';

async function find(context: RequestContext, text: string): Promise<Range> {
  const matches = context.document.body.search(text, { matchCase: true });
  matches.load('items');
  await context.sync();
  const match = matches.items[0];
  if (!match) throw new Error(`no match for ${text}`);
  return match;
}

/** `type:author` for each member, loaded in two batches. */
async function described(context: RequestContext, revisions: RevisionCollection) {
  revisions.load('items');
  await context.sync();
  for (const revision of revisions.items) revision.load('type,author');
  await context.sync();
  return revisions.items.map((revision) => `${revision.type}:${revision.author}`);
}

async function withRuntime(
  bytes: Uint8Array,
  body: (context: RequestContext) => Promise<void>
): Promise<Uint8Array> {
  const runtime = await createServer(bytes);
  try {
    await runtime.run(body);
    return await runtime.save();
  } finally {
    runtime.dispose();
  }
}

const mainXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);

describe('Range.revisions', () => {
  test('lists the change inside one paragraph, the same object the body lists', async () => {
    await withRuntime(REVIEW_DOCUMENT, async (context) => {
      const range = await find(context, 'inserted');
      expect(await described(context, range.revisions)).toEqual(['Insert:Ada']);
      const changed = range.revisions.items[0]!.range;
      changed.load('text');
      await context.sync();
      expect(changed.text).toBe('inserted');
    });
  });

  test('lists a change the range only partly covers, and nothing for unchanged text', async () => {
    await withRuntime(REVIEW_DOCUMENT, async (context) => {
      expect(await described(context, (await find(context, 'nser')).revisions)).toEqual([
        'Insert:Ada',
      ]);
      expect(await described(context, (await find(context, 'plain')).revisions)).toEqual([]);
      expect(await described(context, (await find(context, 'second ')).revisions)).toEqual([]);
    });
  });

  test('lists every change across paragraphs, including both replacement halves', async () => {
    await withRuntime(REVIEW_DOCUMENT, async (context) => {
      const range = context.document.comments.getFirst().getRange();
      range.load('text');
      expect(await described(context, range.revisions)).toEqual([
        'Delete:Ada',
        'Insert:Ada',
        'Insert:Ada',
      ]);
      expect(range.text).toBe('keep goneadded tail\rsecond inserted');
    });
  });

  test('lists a table cell change and a nested change pair', async () => {
    await withRuntime(REVIEW_DOCUMENT, async (context) => {
      expect(await described(context, (await find(context, 'cellins')).revisions)).toEqual([
        'Insert:Ada',
      ]);
      expect(await described(context, (await find(context, 'both')).revisions)).toEqual([
        'Insert:Ada',
        'Delete:Grace',
      ]);
    });
  });

  test('keeps to the range story: header and footnote changes stay in their own story', async () => {
    await withRuntime(REVIEW_DOCUMENT, async (context) => {
      const header = context.document.sections.getFirst().getHeader('Primary').getRange('Whole');
      expect(await described(context, header.revisions)).toEqual(['Insert:Linus']);
      const body = context.document.body.getRange('Whole');
      expect(await described(context, body.revisions)).not.toContain('Insert:Linus');
    });
    await withRuntime(WITH_REVISION_FOOTNOTE, async (context) => {
      const note = context.document.body.footnotes.getFirst().body.getRange('Whole');
      expect(await described(context, note.revisions)).toEqual(['Delete:Ada', 'Insert:Ada']);
      const body = context.document.body.getRange('Whole');
      expect(await described(context, body.revisions)).toEqual([]);
    });
  });

  test('accepts one member and leaves the rest of the story pending', async () => {
    const saved = await withRuntime(REVIEW_DOCUMENT, async (context) => {
      const range = await find(context, 'inserted');
      range.revisions.load('items');
      await context.sync();
      range.revisions.items[0]!.accept();
      await context.sync();
      expect(await described(context, context.document.body.revisions)).toHaveLength(5);
    });
    expect(mainXml(saved)).not.toContain('w:id="3"');
    expect(mainXml(saved)).toContain('w:id="4"');
  });

  for (const action of ['acceptAll', 'rejectAll'] as const) {
    test(`${action} resolves exactly the listed changes`, async () => {
      const saved = await withRuntime(REVIEW_DOCUMENT, async (context) => {
        const range = context.document.comments.getFirst().getRange();
        range.revisions[action]();
        await context.sync();
        expect(await described(context, context.document.body.revisions)).toEqual([
          'Insert:Ada',
          'Insert:Ada',
          'Delete:Grace',
        ]);
      });
      const xml = mainXml(saved);
      expect(xml.includes('added')).toBe(action === 'acceptAll');
      expect(xml.includes('gone')).toBe(action === 'rejectAll');
      expect(xml).toContain('cellins');
    });
  }

  test('a range without changes accepts nothing and keeps the document unchanged', async () => {
    const before = await withRuntime(REVIEW_DOCUMENT, async () => {});
    const after = await withRuntime(REVIEW_DOCUMENT, async (context) => {
      (await find(context, 'plain')).revisions.acceptAll();
      await context.sync();
    });
    expect(mainXml(after)).toBe(mainXml(before));
  });

  test('refuses the story-only additions on a range collection', async () => {
    await withRuntime(REVIEW_DOCUMENT, async (context) => {
      const revisions = (await find(context, 'inserted')).revisions;
      expect(() => revisions.resolve('accept')).toThrow(
        expect.objectContaining({ code: 'NotSupported' })
      );
      expect(() => revisions.setAuthor('Someone')).toThrow(
        expect.objectContaining({ code: 'NotSupported' })
      );
    });
  });
});
