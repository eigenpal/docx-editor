/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor, type DocxEditorServerRuntime, type RequestContext } from '../../index.ts';
import { docx, p } from './support/docx.ts';

const sample = docx(p('First clause.') + p('Second clause.') + p('Third clause.'));
const open = () => DocxEditor.createServer(sample, { author: 'Agent' });
async function markup(r: DocxEditorServerRuntime) {
  return strFromU8(unzipSync(await r.save())['word/document.xml']!);
}
async function mode(r: DocxEditorServerRuntime) {
  return r.run(async (c) => {
    c.document.load('changeTrackingMode');
    await c.sync();
    return c.document.changeTrackingMode;
  });
}
async function match(c: RequestContext, quote = 'First') {
  const range = c.document.body.search(quote).getFirstOrNullObject();
  await c.sync();
  return range;
}

test('mode reads require load, setters queue, and mode survives context lifetime', async () => {
  const r = await open();
  try {
    await r.run(async (c) => {
      expect(() => c.document.changeTrackingMode).toThrow();
      c.document.load('changeTrackingMode');
      await c.sync();
      expect<string>(c.document.changeTrackingMode).toBe('Off');
      c.document.changeTrackingMode = 'TrackMineOnly';
      expect<string>(c.document.changeTrackingMode).toBe('Off');
      await c.sync();
      expect<string>(c.document.changeTrackingMode).toBe('TrackMineOnly');
    });
    expect(await mode(r)).toBe('TrackMineOnly');
    await r.run(async (c) => {
      const range = await match(c);
      range.insertText('New', 'Replace');
      await c.sync();
    });
    expect(await markup(r)).toContain('<w:ins');
  } finally {
    r.dispose();
  }
});

test('mode changes and reads follow FIFO order within one successful batch', async () => {
  const r = await open();
  try {
    await r.run(async (c) => {
      const paragraphs = c.document.body.paragraphs;
      paragraphs.load('items');
      await c.sync();
      c.document.changeTrackingMode = 'TrackMineOnly';
      paragraphs.items[0]!.insertText('Tracked', 'Replace');
      c.document.changeTrackingMode = 'Off';
      paragraphs.items[1]!.insertText('Plain', 'Replace');
      c.document.changeTrackingMode = 'TrackMineOnly';
      c.document.load('changeTrackingMode');
      paragraphs.items[2]!.insertText('Also tracked', 'End');
      await c.sync();
      expect<string>(c.document.changeTrackingMode).toBe('TrackMineOnly');
    });
    const xml = await markup(r);
    expect(xml).toContain('First clause.');
    expect(xml).not.toContain('Second clause.');
    expect(xml.match(/<w:ins\b/g)).toHaveLength(2);
    expect(xml.match(/<w:del\b/g)).toHaveLength(1);
  } finally {
    r.dispose();
  }
});

test('failed trailing operation rolls back edits, mode, revision, and loaded property', async () => {
  const r = await open();
  try {
    const before = await markup(r);
    await r.run(async (c) => {
      const range = await match(c);
      c.document.load('changeTrackingMode');
      await c.sync();
      c.document.changeTrackingMode = 'TrackMineOnly';
      range.insertText('New', 'Replace');
      c.document.body.font.bold = true; // unsupported tracked mutation
      await expect(c.sync()).rejects.toMatchObject({ code: 'NotSupported' });
      expect<string>(c.document.changeTrackingMode).toBe('Off');
      expect(await markup(r)).toBe(before);
      range.insertText('Plain', 'Replace'); // same read revision still valid
      await c.sync();
    });
    expect(await mode(r)).toBe('Off');
    expect(await markup(r)).not.toContain('<w:ins');
  } finally {
    r.dispose();
  }
});

test('failed disabling batch leaves tracking on', async () => {
  const r = await open();
  try {
    await r.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      await c.sync();
      c.document.changeTrackingMode = 'Off';
      c.document.changeTrackingMode = 'TrackAll';
      await expect(c.sync()).rejects.toMatchObject({ code: 'NotSupported' });
      expect<string>(c.document.changeTrackingMode).toBe('TrackMineOnly');
    });
    expect(await mode(r)).toBe('TrackMineOnly');
  } finally {
    r.dispose();
  }
});

test('returned replacement range names only inserted text and supports later formatting', async () => {
  const r = await open();
  try {
    await r.run(async (c) => {
      const range = await match(c);
      c.document.changeTrackingMode = 'TrackMineOnly';
      const inserted = range.insertText('Replacement', 'Replace');
      await c.sync();
      inserted.load('text');
      await c.sync();
      expect(inserted.text).toBe('Replacement');
      c.document.changeTrackingMode = 'Off'; // formatting revisions are not yet supported
      inserted.font.italic = true;
      await c.sync();
      c.document.revisions.acceptAll();
      await c.sync();
    });
    expect(await markup(r)).toContain('<w:i');
    expect(await markup(r)).not.toContain('First');
  } finally {
    r.dispose();
  }
});

for (const operation of ['delete', 'clear', 'emptyReplace'] as const) {
  test(`${operation} authors a deletion through standard range APIs`, async () => {
    const r = await open();
    try {
      await r.run(async (c) => {
        const range = await match(c);
        c.document.changeTrackingMode = 'TrackMineOnly';
        if (operation === 'emptyReplace') range.insertText('', 'Replace');
        else range[operation]();
        await c.sync();
      });
      expect(await markup(r)).toContain('<w:del');
      expect(await markup(r)).not.toContain('<w:ins');
    } finally {
      r.dispose();
    }
  });
}

test('collapsed replacement inserts and empty insertion is a no-op', async () => {
  const r = await open();
  try {
    await r.run(async (c) => {
      const range = await match(c);
      c.document.changeTrackingMode = 'TrackMineOnly';
      const empty = range.insertText('', 'Before');
      await c.sync();
      expect(await markup(r)).not.toContain('<w:ins');
      const written = empty.insertText('Prefix ', 'Replace');
      await c.sync();
      written.load('text');
      await c.sync();
      expect(written.text).toBe('Prefix ');
    });
    expect(await markup(r)).toContain('<w:ins');
  } finally {
    r.dispose();
  }
});

test('unsupported structural edits refuse without silently making permanent changes', async () => {
  const r = await open();
  try {
    await r.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      await c.sync();
      const before = await markup(r);
      c.document.body.clear();
      await expect(c.sync()).rejects.toMatchObject({ code: 'NotSupported' });
      expect(await markup(r)).toBe(before);
    });
  } finally {
    r.dispose();
  }
});
