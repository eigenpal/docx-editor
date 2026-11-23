/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A styles part with no `w:default` paragraph style: every peer resolves the paragraph style named
// "Normal" as the default, and shared edits never write that resolution into the document.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  readOoxmlPackage,
  canonicalOoxmlFingerprint,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { collaborationDocx } from './support.ts';

const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const files = unzipSync(collaborationDocx());
files['[Content_Types].xml'] = strToU8(
  strFromU8(files['[Content_Types].xml']!).replace(
    '</Types>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
  )
);
files['word/_rels/document.xml.rels'] = strToU8(
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
);
files['word/styles.xml'] = strToU8(
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:styleId="a"><w:name w:val="Normal"/>' +
    '<w:rPr><w:sz w:val="32"/></w:rPr></w:style></w:styles>'
);
const fixture = zipSync(files);

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'default-normal-paragraph-style',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: fixture },
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

function caret(client: Peer, index: number, offset: number) {
  const paragraphId = client.editor.surface!.session.paragraphIds()[index]!;
  const position = { paragraphId, offset };
  expect(client.editor.surface!.setSelection({ anchor: position, head: position })).not.toBe(false);
}

/** The style and size the toolbar reports at a caret: the resolved default for unstyled text. */
function defaultAt(client: Peer, index: number) {
  caret(client, index, 1);
  const formatting = client.editor.snapshot().formatting;
  return { styleId: formatting?.styleId, fontSizePt: formatting?.fontSizePt };
}

async function verify(a: Peer, b: Peer) {
  const [left, right] = await Promise.all([a.editor.save(), b.editor.save()]);
  const parts = (bytes: ArrayBuffer) => {
    const loaded = readOoxmlPackage(new Uint8Array(bytes));
    if (!loaded.ok) throw new Error(loaded.reason);
    return loaded.package;
  };
  const one = parts(left),
    two = parts(right);
  const main = (pkg: typeof one) => pkg.parts.get(pkg.mainDocumentPart)!;
  expect(canonicalOoxmlFingerprint(main(one))).toBe(canonicalOoxmlFingerprint(main(two)));
  expect(serializeOoxmlPart(main(one))).not.toContain('w:pStyle');
  const styles = strFromU8(unzipSync(new Uint8Array(left))['word/styles.xml']!);
  expect(styles).not.toContain('w:default');
  expect(styles).toBe(strFromU8(unzipSync(new Uint8Array(right))['word/styles.xml']!));
}

test('two editors resolve the paragraph style named "Normal" through shared edits', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  try {
    for (const client of [a, b])
      expect(defaultAt(client, 0)).toEqual({ styleId: 'a', fontSizePt: 16 });
    // Concurrent: Alice splits the first paragraph while Bob deletes text inside it.
    caret(a, 0, 5);
    expect(a.editor.exec({ type: 'splitParagraph' })).toMatchObject({ ok: true, changed: true });
    b.editor.surface!.setSelection({
      anchor: { paragraphId: b.editor.surface!.session.paragraphIds()[0]!, offset: 2 },
      head: { paragraphId: b.editor.surface!.session.paragraphIds()[0]!, offset: 8 },
    });
    expect(b.editor.surface!.deleteSelection()).toBe(true);
    sync(a, b);
    await verify(a, b);
    for (const client of [a, b]) {
      expect(client.editor.surface!.session.paragraphIds()).toHaveLength(4);
      expect(defaultAt(client, 1)).toEqual({ styleId: 'a', fontSizePt: 16 });
    }
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b);
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b);
    rejoined = await peer('Rejoined', a);
    await verify(a, rejoined);
    expect(defaultAt(rejoined, 1)).toEqual({ styleId: 'a', fontSizePt: 16 });
  } finally {
    rejoined?.destroy();
    a.destroy();
    b.destroy();
  }
});
