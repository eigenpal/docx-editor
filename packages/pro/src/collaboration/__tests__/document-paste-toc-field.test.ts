/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A table of contents pasted from word-processor HTML is a TOC field. It must reach every
// peer as one, converge with concurrent typing, refresh, undo, and survive a rejoin and a
// save and reopen.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  canonicalOoxmlFingerprint,
  detectBodyTocs,
  readOoxmlPackage,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { collaborationDocx } from './support.ts';

const field = (inner: string) => `<!--[if supportFields]>${inner}<![endif]-->`;
const begin = "<span style='mso-element:field-begin'></span>";
const separator = "<span style='mso-element:field-separator'></span>";
const end = "<span style='mso-element:field-end'></span>";
const entry = (level: number, text: string, bookmark: string, page: number, first = false) =>
  `<p class=MsoToc${level}>` +
  (first ? field(`${begin} TOC \\o &quot;1-3&quot; \\h \\z \\u ${separator}`) : '') +
  `<span class=MsoHyperlink><a href="#${bookmark}">${text}<span style='mso-tab-count:1 dotted'>. </span>` +
  `${field(`${begin} PAGEREF ${bookmark} \\h ${separator}`)}${page}${field(end)}</a></span></p>`;
const WORD_TOC =
  '<html xmlns:w="urn:schemas-microsoft-com:office:word"><body>' +
  entry(1, 'Introduction', '_Toc100000001', 1, true) +
  entry(2, 'Scope', '_Toc100000002', 2) +
  `<p class=MsoNormal>${field(end)}</p>` +
  '<h1><a name="_Toc100000001">Introduction</a></h1>' +
  '<h2><a name="_Toc100000002">Scope</a></h2>' +
  '</body></html>';

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'paste-toc-field',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: collaborationDocx() },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [collaborationModule({ session: room.session })],
  });
  return {
    ydoc,
    editor,
    destroy() {
      editor.destroy();
      container.remove();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
  };
}
type Peer = Awaited<ReturnType<typeof peer>>;

function sync(a: Peer, b: Peer) {
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}

async function mainOf(client: { save(): Promise<ArrayBuffer | Uint8Array> }) {
  const loaded = readOoxmlPackage(new Uint8Array(await client.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

async function converged(a: Peer, b: Peer, tocs: number) {
  const left = await mainOf(a.editor);
  const right = await mainOf(b.editor);
  expect(canonicalOoxmlFingerprint(left)).toBe(canonicalOoxmlFingerprint(right));
  expect(detectBodyTocs(left).length).toBe(tocs);
}

function caret(client: Peer, paragraph: number, offset: number) {
  const surface = client.editor.surface!;
  const paragraphId = surface.session.paragraphIds()[paragraph]!;
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

test('a pasted table of contents converges, refreshes, undoes and survives a reopen', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  let reopened: ReturnType<typeof createDocxEditor> | undefined;
  try {
    caret(a, 2, 0);
    expect(a.editor.exec({ type: 'paste', text: 'fallback', html: WORD_TOC })).toMatchObject({
      ok: true,
    });
    caret(b, 0, 0);
    expect(b.editor.exec({ type: 'insertText', text: 'B ' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b, 1);
    expect(b.editor.exec({ type: 'refreshToc', mode: 'entire' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b, 1);
    expect(b.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b, 1);
    rejoined = await peer('Rejoined', a);
    sync(a, rejoined);
    await converged(a, rejoined, 1);
    reopened = createDocxEditor({
      container: document.createElement('div'),
      document: new Uint8Array(await a.editor.save()),
    });
    expect(detectBodyTocs(await mainOf(reopened)).length).toBe(1);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b, 0);
  } finally {
    reopened?.destroy();
    rejoined?.destroy();
    b.destroy();
    a.destroy();
  }
});
