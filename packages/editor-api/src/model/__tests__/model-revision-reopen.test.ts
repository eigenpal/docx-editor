/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Saving gives every revision annotation its own `w:id`. The tracked changes this API records
// must read back after save and reopen as the same decisions: the same items, and the same
// result for accepting or rejecting each one.

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPackage,
  reviewItemKey,
  revisionItemsOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createServer } from '../../runtime/server.ts';
import type { DocxEditorServerRuntime } from '../../runtime/runtime.ts';
import type { RequestContext } from '../../runtime/request-context.ts';
import { docx, p } from './support/documents.ts';

type Build = () => Promise<DocxEditorServerRuntime>;

const cell = (text: string) => `<w:tc>${p(text)}</w:tc>`;
const TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  `<w:tr>${cell('A')}${cell('B')}</w:tr></w:tbl>`;
const TWO_RUNS =
  '<w:p><w:r><w:t xml:space="preserve">Delta </w:t></w:r>' +
  '<w:r><w:rPr><w:i/></w:rPr><w:t>four</w:t></w:r></w:p>';
const OTHER = 'w:author="Other" w:date="2020-01-01T00:00:00Z"';

async function edited(body: string, edit: (context: RequestContext) => Promise<void>) {
  const runtime = await createServer(docx(body), { author: 'Rev' });
  await runtime.run(async (context) => {
    context.document.changeTrackingMode = 'TrackMineOnly';
    await edit(context);
  });
  return runtime;
}

async function paragraphs(context: RequestContext) {
  const found = context.document.body.paragraphs;
  found.load('items');
  await context.sync();
  return found.items;
}

function insertRows(count: number): Build {
  const values = [
    ['C', 'D'],
    ['E', 'F'],
  ].slice(0, count);
  return () =>
    edited(TABLE + p('Tail'), async (context) => {
      const table = context.document.body.tables.getFirst();
      table.rows.load('items');
      await context.sync();
      table.rows.items[0]!.insertRows('After', count, values);
      await context.sync();
    });
}

const SCENARIOS: Record<string, Build> = {
  'one inserted row': insertRows(1),
  'two inserted rows': insertRows(2),
  'formatting over several runs and paragraphs': () =>
    edited(TWO_RUNS + TWO_RUNS + p('Plain'), async (context) => {
      const [first, second] = await paragraphs(context);
      first!.font.bold = true;
      second!.font.bold = true;
      await context.sync();
    }),
  'deletion over several paragraphs': () =>
    edited(p('Alpha one') + p('Beta two') + p('Gamma three'), async (context) => {
      const [first, second] = await paragraphs(context);
      first!.delete();
      second!.delete();
      await context.sync();
    }),
  'typing inside another author insertion': () =>
    edited(
      `<w:p><w:ins w:id="1" ${OTHER}><w:r><w:t>abcdef</w:t></w:r></w:ins></w:p>`,
      async (context) => {
        const found = context.document.body.search('def', { matchCase: true });
        found.load('items');
        await context.sync();
        found.items[0]!.insertText('XY', 'Start');
        await context.sync();
      }
    ),
  'a move': () =>
    createServer(
      docx(
        `<w:p><w:moveFromRangeStart w:id="1" w:name="m" ${OTHER}/>` +
          `<w:moveFrom w:id="2" ${OTHER}><w:r><w:t>moved</w:t></w:r></w:moveFrom>` +
          '<w:moveFromRangeEnd w:id="1"/><w:r><w:t xml:space="preserve"> stays</w:t></w:r></w:p>' +
          `<w:p><w:moveToRangeStart w:id="3" w:name="m" ${OTHER}/>` +
          `<w:moveTo w:id="4" ${OTHER}><w:r><w:t>moved</w:t></w:r></w:moveTo>` +
          '<w:moveToRangeEnd w:id="3"/></w:p>'
      )
    ),
};

interface Listed {
  readonly type: string;
  readonly author: string;
  readonly text: string;
}

async function listing(runtime: DocxEditorServerRuntime): Promise<Listed[]> {
  let listed: Listed[] = [];
  await runtime.run(async (context) => {
    const revisions = context.document.body.revisions;
    revisions.load('items/type,items/author');
    await context.sync();
    const ranges = revisions.items.map((revision) => {
      const range = revision.range;
      range.load('text');
      return range;
    });
    await context.sync();
    listed = revisions.items.map((revision, index) => ({
      type: revision.type,
      author: revision.author,
      text: ranges[index]!.text,
    }));
  });
  return listed;
}

/**
 * Saved markup without the attributes a save is free to renumber or restamp. Rejecting a mark
 * deletion read from a file also leaves an empty `w:pPr/w:rPr`, with or without new ids; that
 * empty container says nothing and is dropped here too.
 */
async function savedBody(runtime: DocxEditorServerRuntime): Promise<string> {
  const xml = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
  return xml.replace(/ w:(id|date)="[^"]*"/g, '').replaceAll('<w:pPr><w:rPr/></w:pPr>', '');
}

async function decide(
  runtime: DocxEditorServerRuntime,
  index: number,
  action: 'accept' | 'reject'
): Promise<{ readonly refused?: string; readonly items: Listed[]; readonly body: string }> {
  let refused: string | undefined;
  await runtime.run(async (context) => {
    const revisions = context.document.body.revisions;
    revisions.load('items');
    await context.sync();
    revisions.items[index]![action]();
    try {
      await context.sync();
    } catch (error) {
      refused = (error as { code?: string }).code ?? 'error';
    }
  });
  return {
    ...(refused ? { refused } : {}),
    items: await listing(runtime),
    body: await savedBody(runtime),
  };
}

async function decideAll(
  runtime: DocxEditorServerRuntime,
  action: 'acceptAll' | 'rejectAll'
): Promise<string> {
  await runtime.run(async (context) => {
    context.document.body.revisions[action]();
    await context.sync();
  });
  return savedBody(runtime);
}

/** The review cards the editor shows for the saved file's main document. */
function cards(bytes: Uint8Array): string[] {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(read.reason);
  const main = read.package.parts.get(read.package.mainDocumentPart)!;
  return revisionItemsOf(main).map(
    (item) =>
      `${item.revisionKind}:${(item.structuralChanges ?? []).join('+')}:${item.author}:${item.text}`
  );
}

describe('tracked changes read back as the same decisions after save and reopen', () => {
  for (const [name, build] of Object.entries(SCENARIOS)) {
    test(name, async () => {
      const live = await build();
      const before = await listing(live);
      const saved = await live.save();
      live.dispose();
      const reopened = await createServer(saved);
      const after = await listing(reopened);
      reopened.dispose();
      // A complete tracked row is not listed (its subtype has no Office name), so the row
      // scenarios compare the collection decisions below and the cards in their own test.
      if (!name.includes('row')) expect(before.length).toBeGreaterThan(0);
      expect(after).toEqual(before);
      // A second save of the reopened file lists the same review cards again.
      const again = await createServer(saved);
      expect(cards(await again.save())).toEqual(cards(saved));
      again.dispose();

      for (const action of ['acceptAll', 'rejectAll'] as const) {
        const fresh = await build();
        const expected = await decideAll(fresh, action);
        fresh.dispose();
        const copy = await createServer(saved);
        const actual = await decideAll(copy, action);
        copy.dispose();
        expect(actual).toEqual(expected);
      }
      for (let index = 0; index < before.length; index += 1) {
        for (const action of ['accept', 'reject'] as const) {
          const fresh = await build();
          const expected = await decide(fresh, index, action);
          fresh.dispose();
          const copy = await createServer(saved);
          const actual = await decide(copy, index, action);
          copy.dispose();
          expect(actual).toEqual(expected);
        }
      }
    });
  }

  test('after reopen, an inserted row and its cell records are one review decision', async () => {
    const live = await insertRows(1)();
    const saved = await live.save();
    live.dispose();
    // The saved file gives the row record and each cell record its own id.
    const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
    const ids = [...xml.matchAll(/<w:(?:ins|cellIns)\b[^>]*\bw:id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const read = readOoxmlPackage(saved);
    if (!read.ok) throw new Error(read.reason);
    const main = read.package.parts.get(read.package.mainDocumentPart)!;
    const rows = revisionItemsOf(main);
    // One decision: the row record, its cell records, and the text the row holds.
    expect(rows.map((item) => [item.structuralChanges, item.text])).toEqual([
      [['rowInsert', 'cellInsert'], 'C\nD'],
    ]);
    // Rejecting it removes the whole row; no cell is left behind.
    const plan = planRevisionBatch(main, 'reject', [reviewItemKey(rows[0]!)]);
    let rejected = main;
    for (const op of plan.ops) {
      const applied = applyTreeOp(rejected, op);
      if (!applied.ok) throw new Error(applied.reason);
      rejected = applied.part;
    }
    const after = serializeOoxmlPart(rejected);
    expect(after.match(/<w:tr\b/g)).toHaveLength(1);
    expect(after.match(/<w:tc>/g)).toHaveLength(2);
  });

  test('separate formatting changes by one author at one date stay separate', async () => {
    const change = (id: number) =>
      `<w:rPrChange w:id="${id}" ${OTHER.replace('Other', 'Rev')}><w:rPr/></w:rPrChange>`;
    const bold = (id: number, text: string) =>
      `<w:r><w:rPr><w:b/>${change(id)}</w:rPr><w:t>${text}</w:t></w:r>`;
    const bytes = docx(
      `<w:p>${bold(1, 'one')}<w:r><w:t xml:space="preserve"> two </w:t></w:r>${bold(2, 'three')}</w:p>`
    );
    const runtime = await createServer(bytes);
    expect((await listing(runtime)).map((item) => item.text)).toEqual(['one', 'three']);
    runtime.dispose();
  });
});
