/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A checkbox glyph replaced through the document API on two collaborating editors (#1144).
//
// The replacement plans the same op as setting the checkbox value, so it replicates as a
// control value change: both peers keep the glyph inside the control with the flag set, and
// save the same bytes.

import { afterAll, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument } from './document-peer-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

const OPTIONS =
  `<w:p><w:sdt><w:sdtPr><w:id w:val="1"/><w14:checkbox xmlns:w14="${W14}">` +
  `<w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
  `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>` +
  `<w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:hAnsi="MS Gothic"/></w:rPr>` +
  `<w:t>☐</w:t></w:r></w:sdtContent></w:sdt>` +
  `<w:r><w:t xml:space="preserve"> Option A</w:t></w:r></w:p>` +
  '<w:p><w:r><w:t>Notes</w:t></w:r></w:p>';

async function room() {
  const harness = createPeerHarness('checkbox-glyph-replace', { offlineEditing: true });
  const pair = await harness.pair(zipDocument(OPTIONS));
  const peers = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    return {
      ...peer,
      editor,
      runtime: DocxEditor.createBrowser(editor, { author: 'Writer' }),
      container,
    };
  });
  return {
    pair,
    peers,
    sync() {
      for (const peer of peers) peer.room.session.flushPendingJournals();
    },
    async savedXml() {
      const saved = await Promise.all(
        peers.map(async (peer) => new Uint8Array(await peer.editor.save()))
      );
      return saved.map((bytes) => strFromU8(unzipSync(bytes)['word/document.xml']!));
    },
    close() {
      for (const peer of peers) {
        peer.runtime.dispose();
        peer.editor.destroy();
        peer.container.remove();
      }
      harness.cleanup();
    },
  };
}

type Runtime = ReturnType<typeof DocxEditor.createBrowser>;

async function tick(runtime: Runtime, glyph: string): Promise<void> {
  await runtime.run(async (context) => {
    const control = context.document.contentControls.getFirst();
    control.getRange('Content').insertText(glyph, 'Replace');
    await context.sync();
  });
}

function controlOf(xml: string): string {
  return xml.slice(xml.indexOf('<w:sdt>'), xml.indexOf('</w:sdt>'));
}

test('a replaced glyph ticks the box on both peers while the other edits nearby', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await tick(alice!.runtime, '☒');
    await bob!.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().insertText(' (preferred)', 'End');
      await context.sync();
    });
    r.pair.resume();
    r.sync();
    const xml = await r.savedXml();
    expect(xml[0]).toBe(xml[1]!);
    expect(xml[0]).toMatch(/<w:p [^>]*><w:sdt>/);
    expect(controlOf(xml[0]!)).toContain('<w14:checked w14:val="1"/>');
    expect(controlOf(xml[0]!)).toContain('<w:sym w:char="2612" w:font="MS Gothic"/>');
    expect(xml[0]).toContain(' Option A (preferred)');
  } finally {
    r.close();
  }
});

test('undo and redo of a replaced glyph replicate to the other peer', async () => {
  const r = await room();
  try {
    const [alice] = r.peers;
    await tick(alice!.runtime, '☒');
    r.sync();
    expect(controlOf((await r.savedXml())[1]!)).toContain('<w14:checked w14:val="1"/>');
    expect(alice!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    let xml = await r.savedXml();
    expect(xml[0]).toBe(xml[1]!);
    expect(controlOf(xml[1]!)).toContain('<w14:checked w14:val="0"/>');
    expect(controlOf(xml[1]!)).toContain('☐');
    expect(alice!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    xml = await r.savedXml();
    expect(xml[0]).toBe(xml[1]!);
    expect(controlOf(xml[1]!)).toContain('<w14:checked w14:val="1"/>');
  } finally {
    r.close();
  }
});

test('ticking while the other peer deletes the paragraph converges', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await tick(alice!.runtime, '☒');
    await bob!.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().delete();
      await context.sync();
    });
    r.pair.resume();
    r.sync();
    const xml = await r.savedXml();
    expect(xml[0]).toBe(xml[1]!);
    expect(xml[0]).not.toContain('<w:sdtContent/>');
  } finally {
    r.close();
  }
});
