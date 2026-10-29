/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
} from '../../../../core/src/editor/paginated-surface.ts';
import { caretAt, linesOf } from '@docx-editor.dev/core/layout';
import {
  floatSpaceMeasurer,
  floatSpacePackage,
  floatSpaceText,
} from '../../../../core/src/layout/__tests__/paragraph-float-space-shrink-package-fixture.ts';
import { createPeerHarness, type Peer } from './document-peer-support.ts';

interface View {
  readonly surface: PaginatedSurface;
  readonly container: HTMLElement;
}
function open(bytes: Uint8Array, peer?: Peer): View {
  peer?.detach();
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, bytes, {
    scale: 1,
    measurer: floatSpaceMeasurer,
    ...(peer ? { collaborationModel: { session: peer.room.session } } : {}),
  });
  if (!result.ok) throw Error(result.reason);
  return { surface: result.surface, container };
}
const text = (view: View) =>
  view.surface.session
    .bodyText()
    .replace(/\uFFFC/gu, '')
    .trim();
const xml = (view: View) => strFromU8(unzipSync(view.surface.save())['word/document.xml']!);
const geometry = (view: View) => ({
  lines: linesOf(view.surface.layout()).map((line) => ({
    box: line.box,
    spans: line.spans.map((span) => ({ text: span.text, box: span.box, style: span.style })),
  })),
  pictures: view.surface
    .layout()
    .pages.map((page) =>
      page.anchoredDrawings?.map(({ x, y, width, height }) => ({ x, y, width, height }))
    ),
});
const passage = (view: View) =>
  linesOf(view.surface.layout())[0]!
    .spans.filter((span) => span.box.x >= 270)
    .map((span) => span.text)
    .join('')
    .trimEnd();
function select(view: View, start: number, end = start) {
  const paragraphId = view.surface.session.paragraphIds()[0]!;
  // The anchor consumes the first model unit. Text starts after that unit.
  view.surface.setSelection({
    anchor: { paragraphId, offset: start + 1 },
    head: { paragraphId, offset: end + 1 },
  });
}
function destroy(view: View) {
  view.surface.destroy();
  view.container.remove();
}
function outsidePicture(view: View) {
  const picture = view.surface.layout().pages[0]!.anchoredDrawings![0]!;
  expect(picture.x).toBe(162);
  expect(picture.width).toBe(108);
  for (const line of linesOf(view.surface.layout())) {
    for (const span of line.spans) {
      if (!span.text.trimEnd()) continue;
      const end = span.box.x + floatSpaceMeasurer.measure(span.text.trimEnd(), span.style);
      expect(end <= 162.001 || span.box.x >= 269.999).toBe(true);
    }
  }
}

test('a remote right-to-left word keeps passage compression in its left-to-right paragraph', async () => {
  const harness = createPeerHarness('float-space-shrink-rtl', { offlineEditing: true });
  const views: View[] = [];
  try {
    const peers = await harness.pair(floatSpacePackage());
    const left = open(peers.alice.room.document, peers.alice);
    const right = open(peers.bob.room.document, peers.bob);
    views.push(left, right);
    const same = (expected: string) => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      expect(text(left)).toBe(expected);
      expect(text(right)).toBe(expected);
      expect(xml(left)).toBe(xml(right));
      expect(geometry(left)).toEqual(geometry(right));
      outsidePicture(left);
      outsidePicture(right);
    };
    select(right, floatSpaceText.length);
    right.surface.type(' אב');
    same(`${floatSpaceText} אב`);
    // The Hebrew word sits on a later line, and the first passage still compresses.
    expect(passage(left)).toBe('hh ii jj');
    right.surface.undo();
    same(floatSpaceText);
    right.surface.redo();
    same(`${floatSpaceText} אב`);
    const reopened = open(left.surface.save());
    views.push(reopened);
    expect(geometry(reopened)).toEqual(geometry(left));
    expect(passage(reopened)).toBe('hh ii jj');
  } finally {
    for (const view of views) destroy(view);
    harness.cleanup();
  }
}, 10000);

test('picture passage compression converges through concurrent edits, history, deletion, and reopen', async () => {
  const harness = createPeerHarness('float-space-shrink', { offlineEditing: true });
  const views: View[] = [];
  try {
    const peers = await harness.pair(floatSpacePackage());
    const left = open(peers.alice.room.document, peers.alice);
    const right = open(peers.bob.room.document, peers.bob);
    views.push(left, right);
    const same = (expected: string) => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      expect(text(left)).toBe(expected);
      expect(text(right)).toBe(expected);
      expect(xml(left)).toBe(xml(right));
      expect(geometry(left)).toEqual(geometry(right));
      outsidePicture(left);
      outsidePicture(right);
    };
    same(floatSpaceText);
    expect(passage(left)).toBe('hh ii jj');
    select(left, 21, 26);
    applyAwarenessUpdate(
      peers.bob.awareness,
      encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
      'test'
    );
    const remote = peers.bob.room.session.remoteSelections()[0]!;
    for (const end of ['anchor', 'head'] as const) {
      expect(caretAt(left.surface.layout(), left.surface.state().selection[end])).not.toBeNull();
      expect(
        caretAt(right.surface.layout(), {
          paragraphId: remote[end].nodeId,
          offset: remote[end].offset,
        })
      ).toEqual(caretAt(left.surface.layout(), left.surface.state().selection[end]));
    }
    peers.pause();
    select(left, 0);
    select(right, floatSpaceText.length);
    left.surface.type('x');
    right.surface.type(' zz');
    peers.resume();
    same('x' + floatSpaceText + ' zz');
    expect(passage(left)).toBe('gg hh ii');
    left.surface.undo();
    same(floatSpaceText + ' zz');
    expect(passage(left)).toBe('hh ii jj');
    left.surface.redo();
    same('x' + floatSpaceText + ' zz');
    expect(passage(left)).toBe('gg hh ii');
    peers.pause();
    select(left, 0, 1);
    select(right, 0);
    left.surface.deleteForward();
    right.surface.type('y');
    peers.resume();
    same('y' + floatSpaceText + ' zz');
    const reopened = open(left.surface.save());
    views.push(reopened);
    expect(text(reopened)).toBe(text(left));
    expect(geometry(reopened)).toEqual(geometry(left));
    outsidePicture(reopened);
    expect(unzipSync(reopened.surface.save())['word/media/image1.png']).toEqual(
      unzipSync(floatSpacePackage())['word/media/image1.png']
    );
    destroy(right);
    views.splice(views.indexOf(right), 1);
    harness.leave(peers.bob);
    select(left, text(left).length);
    left.surface.type(' qq');
    const joined = await harness.join(peers.alice, 'joined');
    const third = open(joined.room.document, joined);
    views.push(third);
    expect(xml(third)).toBe(xml(left));
    expect(geometry(third)).toEqual(geometry(left));
    outsidePicture(third);
  } finally {
    for (const view of views) destroy(view);
    harness.cleanup();
  }
}, 10000);
