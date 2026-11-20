/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An image file pasted while a picture, shape or text box is selected, between collaborating
// editors: the picture replicates, converges, undoes and redoes, and survives save and reopen.
// A remote edit that lands while the file is read leaves the target stale, and the paste
// refuses rather than landing somewhere the user did not choose.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  createDocxEditor,
  executeImageCommand,
  imageFilePastePlan,
  runImageFilePaste,
  type DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';
import {
  PNG_1X1,
  SHAPES_BODY,
  decodePort,
  drawingDocument,
  pasteEvent,
  picturesPerParagraph,
  savedDocumentXml,
  selectFixtureDrawing,
  type DrawingKind,
} from '../../../../core/src/editor/__tests__/drawing-image-paste-fixture.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('drawing-image-paste-room', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

function mounted(peer: Awaited<ReturnType<typeof harness.pair>>['alice']): DocxEditorInstance {
  peer.detach();
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: peer.room.document,
    imageDecodePort: decodePort,
    modules: [collaborationModule({ session: peer.room.session })],
  });
  editors.push(editor);
  return editor;
}

async function pair() {
  const peers = await harness.pair(drawingDocument(SHAPES_BODY));
  const alice = mounted(peers.alice);
  const bob = mounted(peers.bob);
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
  return { alice, bob, sync, converged, pause: peers.pause, resume: peers.resume };
}

/** The adapters' image-file lane: plan the paste, then insert the file where it says. */
function planPaste(editor: DocxEditorInstance, kind: DrawingKind) {
  const paragraph = selectFixtureDrawing(editor, kind);
  const plan = imageFilePastePlan(editor, pasteEvent({ file: true }).clipboardData);
  expect(plan?.at).toBeDefined();
  return { paragraph, plan: plan! };
}

const insert = (editor: DocxEditorInstance, plan: ReturnType<typeof planPaste>['plan']) =>
  executeImageCommand(editor, {
    type: 'insertImage',
    data: PNG_1X1,
    mime: 'image/png',
    widthPoints: 12,
    heightPoints: 12,
    at: plan.at!,
  });

test('a picture pasted at a selected drawing replicates, converges, undoes and redoes', async () => {
  const { alice, bob, converged } = await pair();
  const { paragraph, plan } = planPaste(alice, 'shape');
  expect((await insert(alice, plan)).ok).toBe(true);
  converged();
  const pasted = [0, 0, 0, 0];
  pasted[paragraph]! += 1;
  for (const editor of [alice, bob])
    expect(picturesPerParagraph(await savedDocumentXml(editor))).toEqual(pasted);

  expect(alice.exec({ type: 'undo' })).toMatchObject({ ok: true });
  converged();
  for (const editor of [alice, bob])
    expect(picturesPerParagraph(await savedDocumentXml(editor))).toEqual([0, 0, 0, 0]);
  expect(alice.exec({ type: 'redo' })).toMatchObject({ ok: true });
  converged();
  for (const editor of [alice, bob])
    expect(picturesPerParagraph(await savedDocumentXml(editor))).toEqual(pasted);

  // Save and reopen keeps the pasted picture and its media part.
  const reopened = createDocxEditor({
    container: document.createElement('div'),
    document: new Uint8Array(await bob.save()),
  });
  editors.push(reopened);
  expect(picturesPerParagraph(await savedDocumentXml(reopened))).toEqual(pasted);
});

test('concurrent pastes at selected drawings while the other participant types converge', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  pause();
  const fromAlice = planPaste(alice, 'shape');
  const fromBob = planPaste(bob, 'textBox');
  expect((await insert(alice, fromAlice.plan)).ok).toBe(true);
  expect((await insert(bob, fromBob.plan)).ok).toBe(true);
  // Bob types into the paragraph that anchors Alice's selected shape.
  const surface = bob.surface!;
  const paragraphId = surface.session.paragraphIds()[fromAlice.paragraph]!;
  surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 0 } });
  expect(bob.exec({ type: 'insertText', text: 'Typed ' }).ok).toBe(true);
  sync();
  resume();
  converged();
  const expected = [0, 0, 0, 0];
  expected[fromAlice.paragraph]! += 1;
  expected[fromBob.paragraph]! += 1;
  for (const editor of [alice, bob]) {
    expect(picturesPerParagraph(await savedDocumentXml(editor))).toEqual(expected);
    expect(editor.findMatches('Typed Bravo')).toHaveLength(1);
  }
});

test('a remote edit during the file read leaves the target stale, and the paste refuses', async () => {
  const { alice, bob, converged } = await pair();
  const { paragraph, plan } = planPaste(alice, 'shape');
  // Bob replaces the selected shape's paragraph text before Alice's file read finishes.
  const surface = bob.surface!;
  const paragraphId = surface.session.paragraphIds()[paragraph]!;
  surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 5 } });
  expect(bob.exec({ type: 'insertText', text: 'Changed' }).ok).toBe(true);
  converged();
  expect(await insert(alice, plan)).toMatchObject({ ok: false, code: 'notFound' });
  converged();
  for (const editor of [alice, bob])
    expect(picturesPerParagraph(await savedDocumentXml(editor))).toEqual([0, 0, 0, 0]);
});

test('a refused paste keeps focus where it is, even after a collaborator edits meanwhile', async () => {
  const { alice, bob, converged } = await pair();
  selectFixtureDrawing(alice, 'shape');
  let focused = 0;
  const host = {
    surface: alice.surface,
    canExecuteImageCommand: alice.canExecuteImageCommand.bind(alice),
    focus: () => {
      focused += 1;
      return alice.focus();
    },
  };
  let run: Promise<void> | null = null;
  document.body.addEventListener(
    'paste',
    (event) => {
      run = runImageFilePaste(
        host,
        event as ClipboardEvent,
        async (_transfer, at) => {
          // Bob types in another paragraph during the file read: the revision moves, the
          // captured target goes stale, and Alice's insert refuses.
          const surface = bob.surface!;
          const paragraphId = surface.session.paragraphIds().at(-1)!;
          surface.setSelection({
            anchor: { paragraphId, offset: 0 },
            head: { paragraphId, offset: 0 },
          });
          expect(bob.exec({ type: 'insertText', text: 'Peer ' }).ok).toBe(true);
          converged();
          const result = await executeImageCommand(alice, {
            type: 'insertImage',
            data: PNG_1X1,
            mime: 'image/png',
            widthPoints: 12,
            heightPoints: 12,
            ...(at ? { at } : {}),
          });
          expect(result).toMatchObject({ ok: false, code: 'notFound' });
        },
        () => undefined
      );
    },
    { once: true }
  );
  document.body.dispatchEvent(pasteEvent({ file: true }));
  expect(run).not.toBeNull();
  await run;
  expect(focused).toBe(0);
  expect(alice.snapshot().image).not.toBeNull();
  for (const editor of [alice, bob]) {
    expect(picturesPerParagraph(await savedDocumentXml(editor))).toEqual([0, 0, 0, 0]);
    expect(editor.findMatches('Peer Delta')).toHaveLength(1);
  }
});

test('a collaborator deletes the selected drawing during the file read: the paste refuses', async () => {
  const { alice, bob, converged } = await pair();
  selectFixtureDrawing(alice, 'shape');
  const shapes = (xml: string) => xml.split('<wps:wsp').length - 1;
  const shapesBefore = shapes(await savedDocumentXml(alice));
  let focused = 0;
  const host = {
    surface: alice.surface,
    canExecuteImageCommand: alice.canExecuteImageCommand.bind(alice),
    focus: () => {
      focused += 1;
      return alice.focus();
    },
  };
  let result: unknown = null;
  let run: Promise<void> | null = null;
  document.body.addEventListener(
    'paste',
    (event) => {
      run = runImageFilePaste(
        host,
        event as ClipboardEvent,
        async (_transfer, at) => {
          // Bob deletes the drawing Alice selected while her file is read.
          selectFixtureDrawing(bob, 'shape');
          expect(bob.exec({ type: 'deleteImage' })).toMatchObject({ ok: true, changed: true });
          converged();
          result = await executeImageCommand(alice, {
            type: 'insertImage',
            data: PNG_1X1,
            mime: 'image/png',
            widthPoints: 12,
            heightPoints: 12,
            ...(at ? { at } : {}),
          });
        },
        () => undefined
      );
    },
    { once: true }
  );
  document.body.dispatchEvent(pasteEvent({ file: true }));
  expect(run).not.toBeNull();
  await run;
  expect(result).toMatchObject({ ok: false, code: 'notFound' });
  // The drawing selection ended with the drawing, so the text takes the keyboard.
  expect(alice.snapshot().image).toBeNull();
  expect(focused).toBe(1);
  converged();
  for (const editor of [alice, bob]) {
    const xml = await savedDocumentXml(editor);
    expect(picturesPerParagraph(xml)).toEqual([0, 0, 0, 0]);
    expect(shapes(xml)).toBe(shapesBefore - 1);
  }
});
