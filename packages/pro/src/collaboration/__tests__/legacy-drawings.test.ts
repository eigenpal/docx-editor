/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Read-only legacy drawings in two collaborating editors: a shape group with text, a
// horizontal rule, and an unsupported shape that keeps its box as a placeholder. They render
// alike through concurrent typing beside them, undo, redo, deleting one while the other
// participant types, and a peer that joins later; the saved XML converges.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { readOoxmlPackage, canonicalOoxmlFingerprint } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';

const GROUP =
  '<w:pict><v:group style="width:300pt;height:60pt" coordsize="21600,21600">' +
  '<v:roundrect style="position:absolute;width:9000;height:16200;top:2700" fillcolor="#dce6f2" arcsize="10923f">' +
  '<v:textbox><w:txbxContent><w:p><w:r><w:t>Start</w:t></w:r></w:p></w:txbxContent></v:textbox></v:roundrect>' +
  '<v:oval style="position:absolute;left:12600;width:9000;height:16200;top:2700" fillcolor="#fce4d6"/>' +
  '</v:group></w:pict>';
const RULE =
  '<w:pict><v:rect o:hralign="center" o:hrstd="t" o:hr="t" style="width:0pt;height:1.5pt" fillcolor="#a0a0a0" stroked="f"/></w:pict>';
// A turned rectangle is outside the painted subset, so it keeps its box as a placeholder.
const UNSUPPORTED =
  '<w:pict><v:rect style="width:60pt;height:30pt;rotation:30" fillcolor="red"/></w:pict>';

function fixture(): Uint8Array {
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:v="${V}" xmlns:o="${O}"><w:body>` +
    '<w:p><w:r><w:t>Alpha paragraph</w:t></w:r></w:p>' +
    `<w:p><w:r>${GROUP}</w:r></w:p>` +
    `<w:p><w:r>${RULE}</w:r></w:p>` +
    `<w:p><w:r>${UNSUPPORTED}<w:t>after</w:t></w:r></w:p>` +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(document),
  });
}
const FIXTURE = fixture();

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'legacy-drawings',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: FIXTURE },
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
    container,
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

async function fingerprint(client: Peer): Promise<string> {
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return canonicalOoxmlFingerprint(loaded.package.parts.get(loaded.package.mainDocumentPart)!);
}

/** Painted shapes (the group and the rule) and placeholders, per client. */
function drawn(client: Peer) {
  return {
    shapes: client.container.querySelectorAll('.docx-drawing-shape').length,
    placeholders: client.container.querySelectorAll('.docx-drawing-placeholder').length,
    text: [...client.container.querySelectorAll('.docx-drawing-group-text')]
      .map((layer) => layer.textContent ?? '')
      .join('|'),
  };
}

async function verify(a: Peer, b: Peer, shapes: number) {
  expect(await fingerprint(a)).toBe(await fingerprint(b));
  for (const client of [a, b]) {
    expect(drawn(client)).toMatchObject({ shapes, placeholders: 1 });
    expect(drawn(client).text).toContain('Start');
  }
}

function caretAt(client: Peer, paragraph: number, offset: number) {
  const id = client.editor.surface!.session.paragraphIds()[paragraph]!;
  expect(
    client.editor.surface!.setSelection({
      anchor: { paragraphId: id, offset },
      head: { paragraphId: id, offset },
    })
  ).not.toBe(false);
}

test('two editors keep legacy drawings through edits, deletion and a late join', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let late: Peer | undefined;
  try {
    for (const client of [a, b])
      expect(drawn(client)).toMatchObject({ shapes: 2, placeholders: 1 });
    // Bob types after the placeholder, one offset past it, while Alice types at the start.
    caretAt(a, 0, 0);
    expect(a.editor.exec({ type: 'insertText', text: 'A' })).toMatchObject({ changed: true });
    caretAt(b, 3, 1);
    expect(b.editor.exec({ type: 'insertText', text: 'B' })).toMatchObject({ changed: true });
    sync(a, b);
    await verify(a, b, 2);
    expect(await fingerprint(a)).toContain('Bafter');
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b, 2);
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b, 2);
    // Alice deletes the rule while Bob types in the first paragraph.
    const ruleParagraph = a.editor.surface!.session.paragraphIds()[2]!;
    a.editor.surface!.setSelection({
      anchor: { paragraphId: ruleParagraph, offset: 0 },
      head: { paragraphId: ruleParagraph, offset: 1 },
    });
    expect(a.editor.surface!.deleteSelection()).toBe(true);
    caretAt(b, 0, 1);
    expect(b.editor.exec({ type: 'insertText', text: ' concurrent' })).toMatchObject({
      changed: true,
    });
    sync(a, b);
    await verify(a, b, 1);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b, 2);
    late = await peer('Late', a);
    await verify(a, late, 2);
  } finally {
    late?.destroy();
    a.destroy();
    b.destroy();
  }
});
