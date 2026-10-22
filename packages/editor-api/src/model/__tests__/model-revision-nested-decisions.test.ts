/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One `accept()` or `reject()` resolves a change that sits inside or beside another change.
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createServer } from '../../runtime/server.ts';
import { docx } from './support/documents.ts';

const DATE = '2026-10-01T10:00:00Z';
const BOLD = '<w:rPr><w:b/><w:rPrChange w:id="1" w:author="Ada"><w:rPr/></w:rPrChange></w:rPr>';
const xml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);

async function decideEach(bytes: Uint8Array, action: 'accept' | 'reject') {
  const runtime = await createServer(bytes, { author: 'Reviewer' });
  try {
    const counts: number[] = [];
    await runtime.run(async (context) => {
      for (;;) {
        const revisions = context.document.body.revisions;
        revisions.load('items');
        await context.sync();
        counts.push(revisions.items.length);
        if (!revisions.items.length) break;
        if (action === 'accept') revisions.items[0]!.accept();
        else revisions.items[0]!.reject();
        await context.sync();
      }
    });
    return { counts, saved: xml(await runtime.save()) };
  } finally {
    runtime.dispose();
  }
}

for (const action of ['accept', 'reject'] as const) {
  test(`${action}() resolves formatting inside another author's insertion, then the insertion`, async () => {
    const { counts, saved } = await decideEach(
      docx(
        `<w:p><w:ins w:id="2" w:author="Grace" w:date="${DATE}"><w:r>${BOLD}<w:t>Added</w:t></w:r></w:ins></w:p>`
      ),
      action
    );
    expect(counts.at(-1)).toBe(0);
    expect(saved).not.toMatch(/<w:(ins|rPrChange)\b/);
  });

  test(`${action}() on a deleted paragraph with another author's paragraph change`, async () => {
    const { counts, saved } = await decideEach(
      docx(
        '<w:p><w:r><w:t>Keep</w:t></w:r></w:p>' +
          `<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:del w:id="3" w:author="Ada" w:date="${DATE}"/></w:rPr>` +
          `<w:pPrChange w:id="4" w:author="Grace" w:date="${DATE}"><w:pPr/></w:pPrChange></w:pPr>` +
          `<w:del w:id="5" w:author="Ada" w:date="${DATE}"><w:r><w:delText>Gone</w:delText></w:r></w:del></w:p>` +
          '<w:p><w:r><w:t>After</w:t></w:r></w:p>'
      ),
      action
    );
    expect(counts.at(-1)).toBe(0);
    expect(saved).not.toMatch(/<w:(del|pPrChange)\b/);
  });

  test(`${action}() in one sync on a deleted paragraph and on the change inside it`, async () => {
    const runtime = await createServer(
      docx(
        '<w:p><w:r><w:t>Keep</w:t></w:r></w:p>' +
          `<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:del w:id="3" w:author="Ada" w:date="${DATE}"/></w:rPr>` +
          `<w:pPrChange w:id="4" w:author="Grace" w:date="${DATE}"><w:pPr/></w:pPrChange></w:pPr>` +
          `<w:del w:id="5" w:author="Ada" w:date="${DATE}"><w:r><w:delText>Gone</w:delText></w:r></w:del></w:p>` +
          '<w:p><w:r><w:t>After</w:t></w:r></w:p>'
      ),
      { author: 'Reviewer' }
    );
    try {
      await runtime.run(async (context) => {
        const revisions = context.document.body.revisions;
        revisions.load('items/type');
        await context.sync();
        const deletion = revisions.items.find((revision) => revision.type === 'Delete')!;
        const others = revisions.items.filter((revision) => revision !== deletion);
        // Accepting the deletion removes the paragraph, so the decision on the change inside
        // it is skipped in the same sync rather than failing.
        deletion.accept();
        for (const revision of others) {
          if (action === 'accept') revision.accept();
          else revision.reject();
        }
        await context.sync();
        const left = context.document.body.revisions;
        left.load('items');
        await context.sync();
        expect(left.items).toHaveLength(0);
      });
    } finally {
      runtime.dispose();
    }
  });

  test(`${action}() on one half of a move resolves the move`, async () => {
    const half = (kind: 'moveFrom' | 'moveTo', id: number, author: string) =>
      `<w:p><w:${kind}RangeStart w:id="${id}" w:name="move"/><w:${kind} w:id="${id + 1}" w:author="${author}" w:date="${DATE}"><w:r><w:t>moved</w:t></w:r></w:${kind}><w:${kind}RangeEnd w:id="${id}"/></w:p>`;
    const { counts, saved } = await decideEach(
      docx(
        half('moveFrom', 10, 'Ada') +
          '<w:p><w:r><w:t>between</w:t></w:r></w:p>' +
          half('moveTo', 12, 'Grace')
      ),
      action
    );
    expect(counts).toEqual([2, 0]);
    expect(saved.match(/moved/g)).toHaveLength(1);
    expect(saved).not.toMatch(/<w:move(From|To)\b/);
  });
}

const cell = (content: string, properties = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${properties}</w:tcPr>${content}</w:tc>`;
const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const table = (...rows: string[]) =>
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows.join('')}</w:tbl>`;
const stamp = (id: number) => `w:id="${id}" w:author="Ada" w:date="${DATE}"`;

test('tracked cells and cell merges are listed by type and decided one at a time', async () => {
  const bytes = docx(
    table(
      `<w:tr>${cell(para('top'), `<w:cellMerge ${stamp(20)} w:vMerge="rest"/>`)}${cell(para('new'), `<w:cellIns ${stamp(22)}/>`)}</w:tr>`,
      `<w:tr>${cell(para('below'), `<w:cellMerge ${stamp(21)} w:vMerge="cont"/>`)}${cell(para('b'))}</w:tr>`
    ) + para('After')
  );
  const runtime = await createServer(bytes, { author: 'Reviewer' });
  try {
    await runtime.run(async (context) => {
      const revisions = context.document.body.revisions;
      revisions.load('items/type');
      await context.sync();
      expect(revisions.items.map((revision) => revision.type).sort()).toEqual([
        'CellInsertion',
        'CellMerge',
        'CellMerge',
      ]);
      for (;;) {
        const pending = context.document.body.revisions;
        pending.load('items');
        await context.sync();
        if (!pending.items.length) break;
        pending.items[0]!.accept();
        await context.sync();
      }
    });
    expect(xml(await runtime.save())).not.toMatch(/cellMerge|cellIns/);
  } finally {
    runtime.dispose();
  }
});

test('a strict decision refuses a row that must stay to keep a nested table', async () => {
  const inserted = (id: number, text: string) =>
    `<w:p><w:pPr><w:rPr><w:ins ${stamp(id)}/></w:rPr></w:pPr><w:ins ${stamp(id + 1)}><w:r><w:t>${text}</w:t></w:r></w:ins></w:p>`;
  const nested =
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1500"/></w:tblGrid>' +
    // Untracked text keeps the nested table: a table whose text the decision removes goes.
    `<w:tr>${cell(para('inner'))}</w:tr></w:tbl>`;
  const bytes = docx(
    table(
      `<w:tr>${cell(para('a'))}${cell(para('b'))}</w:tr>`,
      `<w:tr><w:trPr><w:ins ${stamp(30)}/></w:trPr>${cell(nested + inserted(32, ''))}${cell(inserted(34, 'n2'))}</w:tr>`
    ) + para('After')
  );
  const runtime = await createServer(bytes, { author: 'Reviewer' });
  try {
    const failure = await runtime
      .run(async (context) => {
        context.document.body.revisions.rejectAll();
        await context.sync();
      })
      .then(
        () => null,
        (error: unknown) => error as { code: string; debugInfo: { innerError?: { code: string } } }
      );
    expect(failure?.code).toBe('NotImplemented');
    expect(failure?.debugInfo.innerError?.code).toBe('review.retained-structure');
  } finally {
    runtime.dispose();
  }
});

for (const action of ['accept', 'reject'] as const)
  test(`resolve() with named revisions decides them as single calls would (${action})`, async () => {
    // Ada's insertion holds Grace's deletion; Ada's deleted paragraph holds Grace's alignment.
    const bytes = docx(
      `<w:p><w:ins w:id="1" w:author="Ada" w:date="${DATE}"><w:r><w:t>new </w:t></w:r>` +
        `<w:del w:id="2" w:author="Grace" w:date="${DATE}"><w:r><w:delText>old</w:delText></w:r></w:del></w:ins></w:p>` +
        `<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:del w:id="3" w:author="Ada" w:date="${DATE}"/></w:rPr>` +
        `<w:pPrChange w:id="4" w:author="Grace" w:date="${DATE}"><w:pPr/></w:pPrChange></w:pPr>` +
        `<w:del w:id="5" w:author="Ada" w:date="${DATE}"><w:r><w:delText>Gone</w:delText></w:r></w:del></w:p>` +
        para('After')
    );
    const runtime = await createServer(bytes, { author: 'Reviewer' });
    try {
      await runtime.run(async (context) => {
        const revisions = context.document.body.revisions;
        revisions.load('items/author');
        await context.sync();
        const result = revisions.resolve(
          action,
          revisions.items.filter((revision) => revision.author === 'Ada')
        );
        await context.sync();
        expect(result.value.skipped).toEqual([]);
        // One of Grace's changes goes with Ada's and is reported with it: her alignment with the
        // accepted paragraph deletion, or her deletion with the rejected insertion.
        const authors = result.value.resolved.map((entry) => entry.author);
        expect(authors.filter((author) => author === 'Ada')).toHaveLength(2);
        expect(authors.filter((author) => author !== 'Ada')).toEqual(['Grace']);
      });
    } finally {
      runtime.dispose();
    }
  });

test('resolve() with one named revision matches the single call when it empties another change', async () => {
  // Ada inserted "both"; Bob struck all of it. Accepting the strike leaves no insertion behind.
  const body =
    para('X ') +
    `<w:p><w:ins w:id="1" w:author="Ada" w:date="${DATE}"><w:del w:id="2" w:author="Bob" w:date="${DATE}">` +
    '<w:r><w:delText>both</w:delText></w:r></w:del></w:ins></w:p>';
  const decided = async (batch: boolean) => {
    const runtime = await createServer(docx(body), { author: 'Reviewer' });
    try {
      await runtime.run(async (context) => {
        const revisions = context.document.body.revisions;
        revisions.load('items/author');
        await context.sync();
        const bob = revisions.items.find((revision) => revision.author === 'Bob')!;
        if (batch) revisions.resolve('accept', [bob]);
        else bob.accept();
        await context.sync();
      });
      return xml(await runtime.save());
    } finally {
      runtime.dispose();
    }
  };
  const single = await decided(false);
  expect(single).not.toMatch(/<w:(ins|del)\b/);
  expect(await decided(true)).toBe(single);
});
