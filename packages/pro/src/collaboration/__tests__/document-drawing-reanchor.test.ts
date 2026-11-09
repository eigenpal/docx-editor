/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('drawing-reanchor-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const EMU = 12_700;
const LINE = 'The quick brown fox jumps over the lazy dog again and again. ';
const BODY =
  [1, 2, 3, 4]
    .map((n) => `<w:p><w:r><w:t>Paragraph ${n}. ${LINE.repeat(3)}</w:t></w:r></w:p>`)
    .join('') + '<w:sectPr/>';

function mount(
  document_: Uint8Array,
  session: Parameters<typeof collaborationModule>[0]['session']
) {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: document_,
    modules: [collaborationModule({ session })],
  });
  editors.push(editor);
  return editor;
}

async function pair() {
  const peers = await harness.pair(zipDocument(BODY));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount(peer.room.document, peer.room.session);
  }) as [Editor, Editor];
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
  async function join() {
    const peer = await harness.join(peers.alice, 'late-peer');
    peer.detach();
    return mount(peer.room.document, peer.room.session);
  }
  return { alice, bob, sync, converged, join, pause: peers.pause, resume: peers.resume };
}

function chartRecord(editor: Editor) {
  for (const page of editor.surface!.layout().pages) {
    const record = page.anchoredDrawings?.[0];
    if (record) return record;
  }
  return null;
}

function paragraphTop(editor: Editor, paragraphId: string): number {
  const fragment = editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .find((f) => f.kind === 'paragraph' && f.paragraphId === paragraphId);
  if (!fragment) throw new Error(`no fragment for ${paragraphId}`);
  return fragment.box.y;
}

/** Alice inserts a square-wrapped chart in the last paragraph; both peers converge. */
async function withFloatingChart() {
  const peers = await pair();
  const { alice, converged } = peers;
  const last = alice.surface!.session.paragraphIds().at(-1)!;
  alice.surface!.setSelection({
    anchor: { paragraphId: last, offset: 0 },
    head: { paragraphId: last, offset: 0 },
  });
  expect(alice.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
  expect(alice.exec({ type: 'setImageWrapType', target: 'square' }).ok).toBe(true);
  converged();
  return peers;
}

/** Moves Alice's selected chart so its frame top lands just inside `paragraphId`. */
function moveInto(editor: Editor, paragraphId: string) {
  const record = chartRecord(editor)!;
  const top = paragraphTop(editor, paragraphId) + 2;
  return editor.exec({
    type: 'setImagePosition',
    verticalEmu: Math.round((top - record.verticalFrameOrigin) * EMU),
  });
}

test('a re-anchored chart replicates, undoes, and reaches a late peer', async () => {
  const { alice, bob, converged, join } = await withFloatingChart();
  const ids = alice.surface!.session.paragraphIds();
  expect(moveInto(alice, ids[0]!).ok).toBe(true);
  converged();
  expect(chartRecord(bob)?.anchorParagraphId).toBe(ids[0]!);
  const late = await join();
  expect(chartRecord(late)?.anchorParagraphId).toBe(ids[0]!);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(chartRecord(bob)?.anchorParagraphId).toBe(ids.at(-1)!);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(chartRecord(bob)?.anchorParagraphId).toBe(ids[0]!);
});

test('a re-anchor converges with typing in the target paragraph', async () => {
  const { alice, bob, converged, sync, pause, resume } = await withFloatingChart();
  const ids = alice.surface!.session.paragraphIds();
  pause();
  bob.surface!.setSelection({
    anchor: { paragraphId: ids[1]!, offset: 0 },
    head: { paragraphId: ids[1]!, offset: 0 },
  });
  expect(bob.exec({ type: 'insertText', text: 'Typed first. ' }).ok).toBe(true);
  expect(moveInto(alice, ids[1]!).ok).toBe(true);
  sync();
  resume();
  converged();
  expect(chartRecord(bob)?.anchorParagraphId).toBe(ids[1]!);
  expect(bob.findMatches('Typed first.')).toHaveLength(1);
});

test('a re-anchor converges with a delete of the chart by another peer', async () => {
  const { alice, bob, converged, sync, pause, resume } = await withFloatingChart();
  const ids = alice.surface!.session.paragraphIds();
  const chartId = chartRecord(bob)!.drawingNodeId;
  expect(bob.surface!.selectDrawing(chartId, ids.at(-1)!)).toBe(true);
  pause();
  expect(bob.exec({ type: 'deleteImage' }).ok).toBe(true);
  expect(moveInto(alice, ids[1]!).ok).toBe(true);
  sync();
  resume();
  converged();
  // Both peers agree on one outcome, and no chart remains twice.
  const left = alice.surface!.layout().pages.flatMap((p) => p.anchoredDrawings ?? []);
  expect(left.length).toBeLessThanOrEqual(1);
});
