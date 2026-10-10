/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A `w:pict` picture with an `o:OLEObject` beside it projects as one read-only drawing atom,
// so it takes one paragraph offset. Each participant derives that offset from the shared tree
// on its own; edits on both sides of the object must still land where they were typed,
// converge, and keep the object XML through save and reopen.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, R, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('legacy-object-preview-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';

/** An inline preview picture with its embedded object, as a legacy `w:pict` stores it. */
const OBJECT_RUN =
  `<w:r><w:pict xmlns:v="${V}" xmlns:o="${O}">` +
  '<v:shape id="_x0000_s1026" type="#_x0000_t75" style="width:60pt;height:30pt">' +
  '<v:imagedata r:id="rPreview" o:title=""/></v:shape>' +
  '<o:OLEObject Type="Embed" ProgID="Package" ShapeID="_x0000_s1026" DrawAspect="Content" ObjectID="_1" r:id="rOle"/>' +
  '</w:pict></w:r>';

async function pair(object = OBJECT_RUN) {
  const peers = await harness.pair(
    zipDocument(
      `<w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r>${object}` +
        '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p><w:sectPr/>',
      {
        documentRels:
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rPreview" Type="${R}/image" Target="media/preview.png"/>` +
          `<Relationship Id="rOle" Type="${R}/oleObject" Target="embeddings/oleObject1.bin"/>` +
          '</Relationships>',
        overrides:
          '<Default Extension="png" ContentType="image/png"/>' +
          '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>',
        // Stand-in bytes: the preview and the object are carried, never decoded here.
        extraXml: {
          'word/media/preview.png': 'preview',
          'word/embeddings/oleObject1.bin': 'object',
        },
      }
    )
  );
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    editor.surface!.layout();
    return editor;
  }) as [Editor, Editor];
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const converged = () => {
    sync();
    alice.surface!.layout();
    bob.surface!.layout();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  };
  return { alice, bob, sync, converged, pause: peers.pause, resume: peers.resume };
}

/** Put the caret at the end of the first match of `text`. */
function caretAfter(editor: Editor, text: string): void {
  const match = editor.findMatches(text)[0]!;
  // The document holds one paragraph; `blockId` names it by path, the surface by node id.
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  const at = { paragraphId, offset: match.start + match.length };
  editor.surface!.setSelection({ anchor: at, head: at });
}

test('concurrent typing on both sides of the object converges and keeps it', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  caretAfter(alice, 'Before');
  caretAfter(bob, 'after');
  pause();
  expect(alice.exec({ type: 'insertText', text: ' A' }).ok).toBe(true);
  expect(bob.exec({ type: 'insertText', text: ' B' }).ok).toBe(true);
  sync();
  resume();
  converged();
  for (const editor of [alice, bob]) {
    expect(editor.findMatches('Before A')).toHaveLength(1);
    expect(editor.findMatches('after B')).toHaveLength(1);
  }
  const saved = new TextDecoder().decode(
    (await import('fflate')).unzipSync(new Uint8Array(await bob.save()))['word/document.xml']!
  );
  expect(saved).toContain('o:OLEObject');
  // The object stays between the two edits.
  expect(saved.indexOf('Before A')).toBeLessThan(saved.indexOf('o:OLEObject'));
  expect(saved.indexOf('o:OLEObject')).toBeLessThan(saved.indexOf('after B'));
});

test('undo and redo of typing after the object replicate', async () => {
  const { alice, bob, converged } = await pair();
  caretAfter(alice, 'after');
  expect(alice.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('after typed')).toHaveLength(1);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('typed')).toHaveLength(0);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('after typed')).toHaveLength(1);
});
