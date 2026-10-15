/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Range- and key-scoped revision decisions: several in one sync, read-only and structural
// changes, and the changes one review key names.

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createServer } from '../../runtime/server.ts';
import type { RequestContext } from '../../runtime/request-context.ts';
import type { Range } from '../range.ts';
import { getReviewItemRevisions } from '../review-items.ts';
import { docx } from './support/documents.ts';
import { del, ins, para, run } from './support/review-documents.ts';

async function find(context: RequestContext, text: string): Promise<readonly Range[]> {
  const matches = context.document.body.search(text, { matchCase: true });
  matches.load('items');
  await context.sync();
  return matches.items;
}

async function pending(context: RequestContext): Promise<number> {
  const revisions = context.document.body.revisions;
  revisions.load('items');
  await context.sync();
  return revisions.items.length;
}

async function withRuntime(
  bytes: Uint8Array,
  body: (context: RequestContext) => Promise<void>
): Promise<string> {
  const runtime = await createServer(bytes);
  try {
    await runtime.run(body);
    return strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
  } finally {
    runtime.dispose();
  }
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (caught: unknown) => (caught as { code?: string }).code
  );

const SHARED = docx(para(run('x '), ins(1, 'term one term'), run(' y term '), ins(2, 'zz')));

describe('several decisions in one sync', () => {
  test('two matches that overlap one change accept it once', async () => {
    const xml = await withRuntime(SHARED, async (context) => {
      const matches = await find(context, 'term');
      expect(matches).toHaveLength(3);
      for (const match of matches) match.revisions.acceptAll();
      await context.sync();
      expect(await pending(context)).toBe(1);
    });
    expect(xml).not.toContain('w:id="1"');
    expect(xml).toContain('w:id="2"');
  });

  test('contrary decisions on one change refuse the whole sync', async () => {
    const xml = await withRuntime(SHARED, async (context) => {
      const [first, second] = await find(context, 'term');
      first!.revisions.acceptAll();
      second!.revisions.rejectAll();
      expect(await failure(context.sync())).toBe('ConflictingChanges');
      expect(await pending(context)).toBe(2);
    });
    expect(xml).toContain('w:id="1"');
  });

  test('a story-wide decision after a range decision refuses', async () => {
    await withRuntime(SHARED, async (context) => {
      const [first] = await find(context, 'term');
      first!.revisions.acceptAll();
      context.document.body.revisions.acceptAll();
      expect(await failure(context.sync())).toBe('ConflictingChanges');
      expect(await pending(context)).toBe(2);
    });
  });

  test('a single revision accepted after its range decision is skipped', async () => {
    await withRuntime(SHARED, async (context) => {
      const [first] = await find(context, 'term');
      const revisions = first!.revisions;
      revisions.load('items');
      await context.sync();
      revisions.acceptAll();
      revisions.items[0]!.accept();
      await context.sync();
      expect(await pending(context)).toBe(1);
    });
  });
});

describe('what a range decision covers', () => {
  test('a read-only change in the range refuses the decision', async () => {
    const bytes = docx(
      para(run('a '), ins(1, 'good'), run(' b '), `<w:ins w:id="2">${run('noauthor')}</w:ins>`)
    );
    const xml = await withRuntime(bytes, async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst().getRange('Whole');
      paragraph.revisions.load('items');
      await context.sync();
      expect(paragraph.revisions.items).toHaveLength(1);
      paragraph.revisions.acceptAll();
      expect(await failure(context.sync())).toBe('NotImplemented');
    });
    expect(xml).toContain('w:id="1"');
    expect(xml).toContain('w:id="2"');
  });

  test('a read-only change outside the range does not block it', async () => {
    const bytes = docx(
      para(run('a '), ins(1, 'good')) + para(`<w:ins w:id="2">${run('noauthor')}</w:ins>`)
    );
    const xml = await withRuntime(bytes, async (context) => {
      const [good] = await find(context, 'good');
      good!.revisions.acceptAll();
      await context.sync();
    });
    expect(xml).not.toContain('w:id="1"');
    expect(xml).toContain('w:id="2"');
  });

  test('a complete tracked row absent from items resolves with the range', async () => {
    const bytes = docx(
      para(run('before')) +
        '<w:tbl><w:tr><w:trPr><w:ins w:id="20" w:author="Grace"/></w:trPr><w:tc>' +
        '<w:tcPr><w:cellIns w:id="20" w:author="Grace"/></w:tcPr>' +
        para(run('row text')) +
        '</w:tc></w:tr></w:tbl>' +
        para(run('after'))
    );
    const xml = await withRuntime(bytes, async (context) => {
      const range = context.document.body.getRange('Whole');
      range.revisions.load('items');
      await context.sync();
      expect(range.revisions.items).toHaveLength(0);
      range.revisions.rejectAll();
      await context.sync();
    });
    expect(xml).not.toContain('row text');
  });
});

describe('changes nested inside another change', () => {
  // Ada's insertion holds Grace's deletion of "beta" and Bob's deletion of "gamma".
  const NESTED = docx(
    para(
      run('lead '),
      '<w:ins w:id="5" w:author="Ada">' +
        run('alpha ') +
        '<w:del w:id="6" w:author="Grace"><w:r><w:delText>beta</w:delText></w:r></w:del>' +
        run(' mid ') +
        '<w:del w:id="7" w:author="Bob"><w:r><w:delText>gamma</w:delText></w:r></w:del></w:ins>',
      run(' tail')
    )
  );

  async function byAuthor(context: RequestContext) {
    const revisions = context.document.body.revisions;
    revisions.load('items');
    await context.sync();
    for (const revision of revisions.items) revision.load('author');
    await context.sync();
    const of = (name: string) => revisions.items.find((revision) => revision.author === name)!;
    return { ada: of('Ada'), grace: of('Grace') };
  }

  test('rejecting a range over part of the group removes the nested changes with it', async () => {
    const xml = await withRuntime(NESTED, async (context) => {
      const [match] = await find(context, 'beta');
      match!.revisions.load('items');
      await context.sync();
      expect(match!.revisions.items).toHaveLength(2);
      match!.revisions.rejectAll();
      await context.sync();
      expect(await pending(context)).toBe(0);
    });
    expect(xml).not.toContain('alpha');
    expect(xml).not.toContain('gamma');
  });

  test('accepting a range over part of the group leaves the other nested change pending', async () => {
    const xml = await withRuntime(NESTED, async (context) => {
      const [match] = await find(context, 'beta');
      match!.revisions.acceptAll();
      await context.sync();
      expect(await pending(context)).toBe(1);
    });
    expect(xml).not.toContain('beta');
    expect(xml).toContain('w:author="Bob"');
  });

  test('a nested change removed by an earlier rejection refuses a contrary decision', async () => {
    const xml = await withRuntime(NESTED, async (context) => {
      const { ada, grace } = await byAuthor(context);
      ada.reject();
      grace.accept();
      expect(await failure(context.sync())).toBe('ConflictingChanges');
      expect(await pending(context)).toBe(3);
    });
    expect(xml).toContain('w:author="Ada"');
  });

  test('a nested change removed by an earlier rejection is skipped by the same decision', async () => {
    const xml = await withRuntime(NESTED, async (context) => {
      const { ada, grace } = await byAuthor(context);
      ada.reject();
      grace.reject();
      await context.sync();
      expect(await pending(context)).toBe(0);
    });
    expect(xml).not.toContain('alpha');
  });
});

describe('paragraph marks', () => {
  const MARK = docx(
    '<w:p><w:pPr><w:rPr><w:ins w:id="8" w:author="Grace"/></w:rPr></w:pPr>' +
      run('first end') +
      '</w:p>' +
      para(run('second'))
  );

  test('a match at the end of a paragraph leaves its mark change alone', async () => {
    await withRuntime(MARK, async (context) => {
      const [match] = await find(context, 'end');
      match!.revisions.load('items');
      await context.sync();
      expect(match!.revisions.items).toEqual([]);
      match!.revisions.rejectAll();
      await context.sync();
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      expect(paragraphs.items).toHaveLength(2);
      expect(await pending(context)).toBe(1);
    });
  });

  test('a Content range excludes the mark, and a range into the next paragraph includes it', async () => {
    await withRuntime(MARK, async (context) => {
      const content = context.document.body.paragraphs.getFirst().getRange('Content');
      const whole = context.document.body.getRange('Whole');
      content.revisions.load('items');
      whole.revisions.load('items');
      await context.sync();
      expect(content.revisions.items).toEqual([]);
      expect(whole.revisions.items).toHaveLength(1);
    });
  });
});

describe('getReviewItemRevisions', () => {
  const NESTED = docx(
    para(
      run('nested '),
      '<w:ins w:id="5" w:author="Ada"><w:del w:id="6" w:author="Grace">' +
        '<w:r><w:delText>both</w:delText></w:r></w:del></w:ins>'
    ) + para(run('keep '), del(1, 'gone'), ins(2, 'added'))
  );

  test('a key that names nothing lists nothing and refuses a decision', async () => {
    await withRuntime(NESTED, async (context) => {
      expect(await pending(context)).toBe(4);
      const stale = getReviewItemRevisions(context, 'revision-gone');
      stale.load('items');
      await context.sync();
      expect(stale.items).toEqual([]);
      getReviewItemRevisions(context, 'revision-gone').acceptAll();
      expect(await failure(context.sync())).toBe('InvalidObjectPath');
    });
  });

  test('refuses comment, custom and empty keys at the call', async () => {
    await withRuntime(NESTED, async (context) => {
      for (const [key, code] of [
        ['comment-1', 'NotSupported'],
        ['custom-1', 'NotSupported'],
        ['', 'InvalidArgument'],
      ] as const) {
        expect(() => getReviewItemRevisions(context, key)).toThrow(
          expect.objectContaining({ code })
        );
      }
      const revisions = getReviewItemRevisions(context, 'revision-x');
      expect(() => revisions.resolve('accept')).toThrow(
        expect.objectContaining({ code: 'NotSupported' })
      );
    });
  });
});
