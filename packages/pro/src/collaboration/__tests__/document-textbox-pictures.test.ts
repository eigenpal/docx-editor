/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { forEachSemanticDrawing } from '@docx-editor.dev/core/layout';
import type { ImageDecodePort } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { CT, R, REL, createPeerHarness } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('textbox-pictures-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

/** A page-anchored VML picture and a VML text box in one paragraph. */
function documentBytes(): Uint8Array {
  const picture =
    `<w:r><w:pict xmlns:v="${V}"><v:shape id="picture" type="#_x0000_t75" ` +
    'style="width:100pt;height:30pt;margin-top:6pt;margin-left:60pt;' +
    'mso-position-horizontal-relative:page;mso-position-vertical-relative:page;' +
    'position:absolute;z-index:2"><v:imagedata r:id="rPicture"/></v:shape></w:pict></w:r>';
  const box =
    `<w:r><w:pict xmlns:v="${V}"><v:shape id="box" type="#_x0000_t202" ` +
    'style="width:144pt;height:48pt;margin-top:60pt;margin-left:200pt;' +
    'mso-position-horizontal-relative:page;mso-position-vertical-relative:page;' +
    'position:absolute;z-index:1" filled="f"><v:textbox><w:txbxContent>' +
    '<w:p><w:r><w:t>Shared</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rPicture" Type="${IMG}" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        `<w:p><w:r><w:t xml:space="preserve">Body </w:t></w:r>${picture}${box}</w:p>` +
        '<w:p><w:r><w:t>Tail</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
    ),
  });
}

async function pair() {
  const peers = await harness.pair(documentBytes());
  const decodes = { alice: 0, bob: 0 };
  const mounted = (['alice', 'bob'] as const).map((name) => {
    const peer = peers[name];
    peer.detach();
    const imageDecodePort: ImageDecodePort = {
      decode: async () => {
        decodes[name] += 1;
        return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
      },
    };
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
      imageDecodePort,
    });
    editors.push(editor);
    return editor;
  });
  const [alice, bob] = mounted as [Editor, Editor];
  function sync() {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  }
  function converged() {
    sync();
    alice.surface!.layout();
    bob.surface!.layout();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  }
  return { alice, bob, decodes, sync, converged, pause: peers.pause, resume: peers.resume };
}

/** The picture's resource state in the editor's current layout. */
function picture(editor: Editor) {
  const states: { kind: string; handle?: unknown }[] = [];
  forEachSemanticDrawing(editor.surface!.layout(), ({ drawing }) => {
    const resource = drawing.resource;
    // The text box is a shape: its own resource is never a picture.
    if (drawing.textboxStory) return;
    states.push({
      kind: resource.kind,
      ...(resource.kind === 'ready' ? { handle: resource.validatedHandle } : {}),
    });
  });
  return states;
}

async function settled(editor: Editor) {
  for (let turn = 0; turn < 50 && picture(editor)[0]?.kind !== 'ready'; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const [state] = picture(editor);
  expect(state?.kind).toBe('ready');
  return state!;
}

function enterBox(editor: Editor, text: string): void {
  const match = editor.findMatches(text)[0]!;
  expect(match.scope?.kind).toBe('frame');
  expect(editor.surface!.setActiveScope(match.scope!)).toBe(true);
  const end = { paragraphId: match.blockId, offset: match.start + match.length };
  editor.surface!.setSelection({ anchor: end, head: end });
}

/** The picture stays ready with the same decoded bytes, and no editor decodes it again. */
function expectPictureKept(
  editor: Editor,
  before: { handle?: unknown },
  decodes: number,
  now: number
) {
  expect(picture(editor)).toEqual([{ kind: 'ready', handle: before.handle }]);
  expect(now).toBe(decodes);
}

test('local and remote typing in a text box keep the picture beside it decoded', async () => {
  const { alice, bob, decodes, converged } = await pair();
  const aliceBefore = await settled(alice);
  const bobBefore = await settled(bob);
  const counted = { ...decodes };

  enterBox(alice, 'Shared');
  for (const text of [' o', 'n', 'e']) {
    expect(alice.exec({ type: 'insertText', text }).ok).toBe(true);
    converged();
    expectPictureKept(alice, aliceBefore, counted.alice, decodes.alice);
    expectPictureKept(bob, bobBefore, counted.bob, decodes.bob);
  }
  expect(bob.findMatches('Shared one')[0]?.scope?.kind).toBe('frame');
});

test('concurrent typing, undo, and redo keep the picture decoded and converge', async () => {
  const { alice, bob, decodes, sync, converged, pause, resume } = await pair();
  const aliceBefore = await settled(alice);
  const bobBefore = await settled(bob);
  const counted = { ...decodes };

  enterBox(alice, 'Shared');
  enterBox(bob, 'Shared');
  pause();
  expect(alice.exec({ type: 'insertText', text: ' Alice' }).ok).toBe(true);
  expect(bob.exec({ type: 'insertText', text: ' Bob' }).ok).toBe(true);
  sync();
  resume();
  converged();
  expect(alice.findMatches('Alice')).toHaveLength(1);
  expect(alice.findMatches('Bob')).toHaveLength(1);
  expectPictureKept(alice, aliceBefore, counted.alice, decodes.alice);
  expectPictureKept(bob, bobBefore, counted.bob, decodes.bob);

  expect(alice.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
  converged();
  expect(bob.findMatches('Alice')).toHaveLength(0);
  expect(bob.findMatches('Bob')).toHaveLength(1);
  expect(alice.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
  converged();
  expect(bob.findMatches('Alice')).toHaveLength(1);
  expectPictureKept(alice, aliceBefore, counted.alice, decodes.alice);
  expectPictureKept(bob, bobBefore, counted.bob, decodes.bob);
});

test('a picture deleted while another participant types comes back with undo', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  await settled(alice);
  await settled(bob);

  enterBox(alice, 'Shared');
  const body = bob.findMatches('Body')[0]!;
  // Select the body paragraph's text and both drawings, then delete them.
  bob.surface!.setSelection({
    anchor: { paragraphId: body.blockId, offset: 0 },
    head: { paragraphId: body.blockId, offset: body.length + 3 },
  });
  pause();
  expect(alice.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
  expect(bob.surface!.deleteSelection()).toBe(true);
  sync();
  resume();
  converged();
  expect(picture(alice)).toEqual([]);
  expect(picture(bob)).toEqual([]);

  expect(bob.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
  converged();
  expect((await settled(alice)).kind).toBe('ready');
  expect((await settled(bob)).kind).toBe('ready');

  const saved = new Uint8Array(await bob.save());
  const reopened = createDocxEditor({
    container: document.createElement('div'),
    document: saved,
    imageDecodePort: {
      decode: async () => ({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 }),
    },
  });
  editors.push(reopened);
  expect(reopened.findMatches('Shared typed')[0]?.scope?.kind).toBe('frame');
  await settled(reopened);
  expect(picture(reopened)).toHaveLength(1);
});
