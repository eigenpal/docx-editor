/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A range read before its paragraph's text changed refuses instead of editing shifted text.
//
// Ranges are snapshots of model offsets. An edit committed by an earlier sync moves the offsets
// after it, so the old range names different text. The host refuses it with `StaleDocument`.
// A formatting edit moves no offset, edits in other paragraphs are unaffected, and edits in the
// same batch are rebased together.

import { expect, test } from 'bun:test';
import { DocxEditor, type DocxEditorServerRuntime, type RequestContext } from '../../index.ts';
import { docx, p } from './support/docx.ts';

const SAMPLE =
  p('Governed by the State of New York, with courts in New York County.') + p('Other clause.');

async function find(c: RequestContext, text: string) {
  const matches = c.document.body.search(text, { matchCase: true });
  matches.load('items');
  await c.sync();
  return matches.items[0]!;
}

async function bodyText(r: DocxEditorServerRuntime): Promise<string> {
  return r.run(async (c) => {
    const body = c.document.body;
    body.load('text');
    await c.sync();
    return body.text;
  });
}

for (const tracking of ['Off', 'TrackMineOnly'] as const) {
  test(`a range read before an earlier sync edited its paragraph refuses (${tracking})`, async () => {
    const r = await DocxEditor.createServer(docx(SAMPLE), { author: 'Agent' });
    try {
      await r.run(async (c) => {
        c.document.changeTrackingMode = tracking;
        const state = await find(c, 'the State of New York');
        const county = await find(c, 'New York County');
        state.insertText('the State of Delaware', 'Replace');
        await c.sync();
        county.insertText('New Castle County', 'Replace');
        await expect(c.sync()).rejects.toMatchObject({ code: 'StaleDocument' });
      });
      // Nothing landed at the shifted offsets.
      expect(await bodyText(r)).toContain('courts in New York County.');
    } finally {
      r.dispose();
    }
  });
}

test('searching again after the edit addresses the moved text', async () => {
  const r = await DocxEditor.createServer(docx(SAMPLE), { author: 'Agent' });
  try {
    await r.run(async (c) => {
      (await find(c, 'the State of New York')).insertText('the State of Delaware', 'Replace');
      await c.sync();
      (await find(c, 'New York County')).insertText('New Castle County', 'Replace');
      await c.sync();
    });
    expect(await bodyText(r)).toContain(
      'Governed by the State of Delaware, with courts in New Castle County.'
    );
  } finally {
    r.dispose();
  }
});

test('ranges stay usable after edits to other paragraphs and after formatting', async () => {
  const r = await DocxEditor.createServer(docx(SAMPLE), { author: 'Agent' });
  try {
    await r.run(async (c) => {
      const county = await find(c, 'New York County');
      const other = await find(c, 'Other');
      other.insertText('Another', 'Replace');
      await c.sync();
      county.font.bold = true;
      await c.sync();
      county.insertText('New Castle County', 'Replace');
      await c.sync();
    });
    expect(await bodyText(r)).toContain('courts in New Castle County.');
    expect(await bodyText(r)).toContain('Another clause.');
  } finally {
    r.dispose();
  }
});

test('edits to one paragraph in a single batch still rebase together', async () => {
  const r = await DocxEditor.createServer(docx(SAMPLE), { author: 'Agent' });
  try {
    await r.run(async (c) => {
      const state = await find(c, 'the State of New York');
      const county = await find(c, 'New York County');
      state.insertText('the State of Delaware', 'Replace');
      county.insertText('New Castle County', 'Replace');
      await c.sync();
    });
    expect(await bodyText(r)).toContain(
      'Governed by the State of Delaware, with courts in New Castle County.'
    );
  } finally {
    r.dispose();
  }
});

test('a range tracked across runs refuses once another run edited its paragraph', async () => {
  const r = await DocxEditor.createServer(docx(SAMPLE), { author: 'Agent' });
  try {
    const county = await r.run(async (c) => {
      const range = await find(c, 'New York County');
      c.trackedObjects.add(range);
      return range;
    });
    await r.run(async (c) => {
      (await find(c, 'the State of New York')).insertText('Delaware', 'Replace');
      await c.sync();
    });
    await r.run(county, async (c) => {
      county.insertText('New Castle County', 'Replace');
      await expect(c.sync()).rejects.toMatchObject({ code: 'StaleDocument' });
      c.trackedObjects.remove(county);
    });
  } finally {
    r.dispose();
  }
});
