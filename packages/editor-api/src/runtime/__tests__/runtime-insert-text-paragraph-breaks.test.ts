/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `insertText` treats `\n`, `\r`, and `\r\n` as paragraph breaks, tracked or not.
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor, type DocxEditorServerRuntime, type RequestContext } from '../../index.ts';
import { isDocxEditorError } from '../errors.ts';
import { docx, p } from './support/docx.ts';
import { WITH_FURNITURE } from '../../model/__tests__/support/documents.ts';

const open = (document: string | Uint8Array) =>
  DocxEditor.createServer(typeof document === 'string' ? docx(document) : document, {
    author: 'Agent',
  });

async function markup(r: DocxEditorServerRuntime, part = 'word/document.xml') {
  return strFromU8(unzipSync(await r.save())[part]!);
}

async function texts(r: DocxEditorServerRuntime): Promise<string[]> {
  return r.run(async (c) => {
    const paragraphs = c.document.body.paragraphs;
    paragraphs.load('items/text');
    await c.sync();
    return paragraphs.items.map((paragraph) => paragraph.text);
  });
}

async function reopen(r: DocxEditorServerRuntime) {
  return DocxEditor.createServer(await r.save(), { author: 'Agent' });
}

async function decideAll(r: DocxEditorServerRuntime, decision: 'accept' | 'reject') {
  await r.run(async (c) => {
    c.document.changeTrackingMode = 'Off';
    if (decision === 'accept') c.document.body.revisions.acceptAll();
    else c.document.body.revisions.rejectAll();
    await c.sync();
  });
}

async function first(c: RequestContext, quote: string) {
  const range = c.document.body.search(quote).getFirst();
  await c.sync();
  return range;
}

/** Runs one write, optionally tracked, and answers the text of the range it returned. */
async function write(
  r: DocxEditorServerRuntime,
  tracked: boolean,
  edit: (c: RequestContext) => Promise<{ load(names: 'text'): unknown; text: string }>
): Promise<string> {
  return r.run(async (c) => {
    if (tracked) c.document.changeTrackingMode = 'TrackMineOnly';
    const written = await edit(c);
    await c.sync();
    written.load('text');
    await c.sync();
    return written.text;
  });
}

async function refusal(
  r: DocxEditorServerRuntime,
  tracked: boolean,
  edit: (c: RequestContext) => Promise<unknown>
) {
  try {
    await r.run(async (c) => {
      if (tracked) c.document.changeTrackingMode = 'TrackMineOnly';
      await edit(c);
      await c.sync();
    });
  } catch (error) {
    if (!isDocxEditorError(error)) throw error;
    const inner = error.debugInfo.innerError as { code?: string } | undefined;
    return { code: error.code, inner: inner?.code };
  }
  throw new Error('the write did not refuse');
}

/** Paragraph marks proposed as insertions: `w:ins` inside the mark's `w:rPr`. */
const markIns = (xml: string) =>
  xml.match(/<w:rPr><w:ins\b[^>]*\/><\/w:rPr><\/w:pPr>/g)?.length ?? 0;

describe('untracked paragraph breaks', () => {
  test('split the paragraph at each break, CRLF counts once, and an empty segment is an empty paragraph', async () => {
    const r = await open(p('Hello world'));
    const written = await write(r, false, async (c) =>
      (await first(c, 'world')).insertText('a\r\nb\n\nc', 'Before')
    );
    expect(written).toBe('a\rb\r\rc');
    expect(await texts(r)).toEqual(['Hello a', 'b', '', 'cworld']);
    expect(await markup(r)).not.toContain('<w:ins');
    expect(await texts(await reopen(r))).toEqual(['Hello a', 'b', '', 'cworld']);
  });

  test('a trailing break leaves the rest of the paragraph in a new paragraph', async () => {
    const r = await open(p('Hello world'));
    expect(
      await write(r, false, async (c) => (await first(c, 'Hello')).insertText('X\n', 'After'))
    ).toBe('X\r');
    expect(await texts(r)).toEqual(['HelloX', ' world']);
  });

  test('Replace writes over the range, also across paragraphs', async () => {
    const single = await open(p('Hello world'));
    expect(
      await write(single, false, async (c) =>
        (await first(c, 'world')).insertText('big\nplanet', 'Replace')
      )
    ).toBe('big\rplanet');
    expect(await texts(single)).toEqual(['Hello big', 'planet']);

    const across = await open(p('Hello world') + p('second line'));
    await write(across, false, async (c) => {
      const from = await first(c, 'world');
      const to = await first(c, 'second');
      return from.expandTo(to).insertText('X\nY', 'Replace');
    });
    expect(await texts(across)).toEqual(['Hello X', 'Y line']);
  });

  test('paragraph and body locations', async () => {
    const r = await open(p('Hello world'));
    await write(r, false, async (c) => c.document.body.insertText('top\n', 'Start'));
    await write(r, false, async (c) => c.document.body.insertText('\nbottom', 'End'));
    expect(await texts(r)).toEqual(['top', 'Hello world', 'bottom']);
    await write(r, false, async (c) => {
      const paragraphs = c.document.body.paragraphs;
      paragraphs.load('items');
      await c.sync();
      return paragraphs.items[1]!.insertText('one\ntwo', 'Replace');
    });
    expect(await texts(r)).toEqual(['top', 'one', 'two', 'bottom']);
    await write(r, false, async (c) => c.document.body.insertText('only\nthis', 'Replace'));
    expect(await texts(r)).toEqual(['only', 'this']);
  });

  test('a new list paragraph keeps the numbering', async () => {
    const r = await open(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>item one</w:t></w:r></w:p>'
    );
    await write(r, false, async (c) => (await first(c, 'one')).insertText('\nitem two', 'After'));
    expect(await texts(r)).toEqual(['item one', 'item two']);
    expect((await markup(r)).match(/<w:numId w:val="1"\/>/g)).toHaveLength(2);
  });

  test('a break in a table cell stays in the cell', async () => {
    const r = await open(
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        p('after')
    );
    await write(r, false, async (c) => (await first(c, 'cell')).insertText('A\nB', 'After'));
    const xml = await markup(r);
    expect(xml).toMatch(/<w:tc><w:p[^>]*>.*cellA.*<\/w:p><w:p[^>]*>.*B text.*<\/w:p><\/w:tc>/);
  });

  test('a break in a header splits the header paragraph', async () => {
    const r = await open(WITH_FURNITURE);
    await write(r, false, async (c) => {
      const sections = c.document.sections;
      sections.load('items');
      await c.sync();
      const header = sections.items[0]!.getHeader('Primary');
      await c.sync();
      const found = header.search('header').getFirst();
      await c.sync();
      return found.insertText('\nsecond line', 'After');
    });
    const header = await markup(r, 'word/header1.xml');
    expect(header.match(/<w:p\b/g)).toHaveLength(2);
    expect(header).toContain('second line');
  });
});

describe('tracked paragraph breaks', () => {
  test('propose the text and each new paragraph mark; reject restores, accept keeps', async () => {
    const r = await open(p('Hello world'));
    const written = await write(r, true, async (c) =>
      (await first(c, 'world')).insertText('a\nb\n\nc', 'Before')
    );
    expect(written).toBe('a\rb\r\rc');
    expect(await texts(r)).toEqual(['Hello a', 'b', '', 'cworld']);
    const xml = await markup(r);
    expect(markIns(xml)).toBe(3);
    expect(xml).toContain('w:author="Agent"');

    const rejected = await reopen(r);
    await decideAll(rejected, 'reject');
    expect(await texts(rejected)).toEqual(['Hello world']);
    expect(await markup(rejected)).not.toContain('<w:ins');

    const accepted = await reopen(r);
    await decideAll(accepted, 'accept');
    expect(await texts(accepted)).toEqual(['Hello a', 'b', '', 'cworld']);
    expect(await texts(await reopen(accepted))).toEqual(['Hello a', 'b', '', 'cworld']);
  });

  test('a lone break is a proposed paragraph mark', async () => {
    const r = await open(p('Hello world'));
    expect(
      await write(r, true, async (c) => (await first(c, 'world')).insertText('\n', 'Before'))
    ).toBe('\r');
    expect(await texts(r)).toEqual(['Hello ', 'world']);
    expect(markIns(await markup(r))).toBe(1);
    await decideAll(r, 'reject');
    expect(await texts(r)).toEqual(['Hello world']);
  });

  test('Replace strikes the range and proposes the split text after it', async () => {
    const r = await open(p('Hello world'));
    await write(r, true, async (c) =>
      (await first(c, 'world')).insertText('big\nplanet', 'Replace')
    );
    const xml = await markup(r);
    expect(xml).toContain('<w:delText>world</w:delText>');
    expect(markIns(xml)).toBe(1);
    await decideAll(r, 'reject');
    expect(await texts(r)).toEqual(['Hello world']);
  });

  test('list, table cell, and paragraph end', async () => {
    const r = await open(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>item one</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        p('last')
    );
    await write(r, true, async (c) => (await first(c, 'one')).insertText('\nitem two', 'After'));
    await write(r, true, async (c) => (await first(c, 'cell')).insertText('A\nB', 'After'));
    await write(r, true, async (c) => {
      const paragraphs = c.document.body.paragraphs;
      paragraphs.load('items');
      await c.sync();
      return paragraphs.items[paragraphs.items.length - 1]!.insertText('\nnew end', 'End');
    });
    expect(await texts(r)).toEqual(['item one', 'item two', 'cellA', 'B text', 'last', 'new end']);
    expect(markIns(await markup(r))).toBe(3);
    const reopened = await reopen(r);
    await decideAll(reopened, 'reject');
    expect(await texts(reopened)).toEqual(['item one', 'cell text', 'last']);
  });

  test("a write inside another author's insertion stays a separate decision", async () => {
    const r = await open(
      '<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r>' +
        '<w:ins w:id="9" w:author="Other" w:date="2026-01-01T00:00:00Z"><w:r><w:t>their words</w:t></w:r></w:ins></w:p>'
    );
    await write(r, true, async (c) => (await first(c, 'their')).insertText('A\nB', 'After'));
    expect(await texts(r)).toEqual(['keep theirA', 'B words']);
    await decideAll(r, 'reject');
    expect(await texts(r)).toEqual(['keep ']);
  });

  test('whole-body Replace with a break refuses while tracking, as without one', async () => {
    const r = await open(p('Hello world'));
    expect(
      await refusal(r, true, async (c) => c.document.body.insertText('one\ntwo', 'Replace'))
    ).toEqual({ code: 'NotSupported', inner: 'edit.tracked-operation-unsupported' });
    expect(await texts(r)).toEqual(['Hello world']);
  });
});

describe('refused paragraph breaks', () => {
  for (const tracked of [false, true]) {
    test(`a break inside an inline content control (tracked: ${String(tracked)})`, async () => {
      const r = await open(
        '<w:p><w:r><w:t xml:space="preserve">pre </w:t></w:r><w:sdt><w:sdtPr><w:id w:val="5"/></w:sdtPr>' +
          '<w:sdtContent><w:r><w:t>inside control</w:t></w:r></w:sdtContent></w:sdt></w:p>'
      );
      expect(
        await refusal(r, tracked, async (c) =>
          (await first(c, 'inside')).insertText('A\nB', 'After')
        )
      ).toEqual({ code: 'NotSupported', inner: 'edit.indivisible-content' });
      expect(await texts(r)).toEqual(['pre inside control']);
    });

    test(`a break beside another text edit in the same paragraph (tracked: ${String(tracked)})`, async () => {
      const r = await open(p('Hello world'));
      const refused = await refusal(r, tracked, async (c) => {
        const hello = await first(c, 'Hello');
        const world = await first(c, 'world');
        hello.insertText('X', 'After');
        world.insertText('\nY', 'After');
      });
      expect(refused.code).toBe('ConflictingChanges');
      expect(await texts(r)).toEqual(['Hello world']);
    });
  }

  test('form feeds and Unicode separators refuse at the call', async () => {
    const r = await open(p('Hello world'));
    for (const text of ['a\fb', 'a b', 'a b'])
      expect(
        await refusal(r, false, async (c) => (await first(c, 'world')).insertText(text, 'Before'))
      ).toMatchObject({ code: 'InvalidArgument' });
    expect(await texts(r)).toEqual(['Hello world']);
  });
});

describe('new paragraph marks never take the original mark revision', () => {
  const OTHER_DELETED_MARK =
    '<w:p><w:pPr><w:rPr><w:del w:id="9" w:author="Other" w:date="2026-01-01T00:00:00Z"/>' +
    '</w:rPr></w:pPr><w:r><w:t>Hello world</w:t></w:r></w:p>' +
    p('Next');

  // Each paragraph mark revision has an id no other revision uses. The halves of one text
  // insertion that a split divides keep that insertion's id on purpose.
  const markIdsUnique = (xml: string): void => {
    const marks = [
      ...xml.matchAll(/<w:pPr>(?:(?!<\/w:pPr>).)*?<w:rPr>(?:(?!<\/w:rPr>).)*?w:id="([^"]+)"/g),
    ].map((match) => match[1]!);
    const all = [...xml.matchAll(/<w:(?:ins|del) [^>]*w:id="([^"]+)"/g)].map((match) => match[1]!);
    for (const id of marks) expect(all.filter((other) => other === id)).toHaveLength(1);
  };

  test('a tracked replacement across a mark splits again; accept and reject both resolve', async () => {
    for (const decision of ['accept', 'reject'] as const) {
      const r = await open(p('Hello world') + p('Second line'));
      try {
        await r.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          const from = c.document.body.search('world').getFirst();
          const to = c.document.body.search('Second').getFirst();
          from.expandTo(to).insertText('x\ny', 'Replace');
          await c.sync();
        });
        const xml = await markup(r);
        markIdsUnique(xml);
        await decideAll(r, decision);
        expect(await texts(r)).toEqual(
          decision === 'accept' ? ['Hello x', 'y line'] : ['Hello world', 'Second line']
        );
      } finally {
        r.dispose();
      }
    }
  });

  for (const tracked of [false, true]) {
    test(`a split before text whose mark another author deleted, ${tracked ? 'tracked' : 'untracked'}`, async () => {
      const r = await open(OTHER_DELETED_MARK);
      try {
        await r.run(async (c) => {
          if (tracked) c.document.changeTrackingMode = 'TrackMineOnly';
          c.document.body.search('world').getFirst().insertText('x\ny', 'Before');
          await c.sync();
        });
        const xml = await markup(r);
        // Only the last piece keeps the other author's deleted mark, under its own id.
        expect(xml.match(/w:author="Other"/g)).toHaveLength(1);
        markIdsUnique(xml);
        await decideAll(r, 'accept');
        expect(await texts(r)).toEqual(['Hello x', 'yworldNext']);
      } finally {
        r.dispose();
      }
    });
  }

  for (const shape of [
    p('Hello world'),
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Hello world</w:t></w:r></w:p>',
  ])
    test(`accepting a tracked split leaves no empty mark properties behind ${shape.length}`, async () => {
      const r = await open(shape);
      try {
        await r.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          c.document.body.search('world').getFirst().insertText('\n', 'Before');
          await c.sync();
        });
        for (const runtime of [r, await reopen(r)]) {
          await decideAll(runtime, 'accept');
          expect(await texts(runtime)).toEqual(['Hello ', 'world']);
          const xml = await markup(runtime);
          expect(xml).not.toContain('<w:rPr/>');
          expect(xml).not.toContain('<w:pPr/>');
          expect(xml).not.toContain('<w:pPr></w:pPr>');
          if (runtime !== r) runtime.dispose();
        }
      } finally {
        r.dispose();
      }
    });
});
