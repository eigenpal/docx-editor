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
import { caretAt, linesOf, type TextMeasurer } from '@docx-editor.dev/core/layout';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const measurer: TextMeasurer = {
  measure: (text, style) => Array.from(text).length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({ height: style.fontSizePt * 1.15, baseline: style.fontSizePt * 0.9 }),
};
const source = () =>
  zipDocument(
    `<w:p xmlns:m="${M}"><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
      '<w:r><w:t>A</w:t></w:r><m:oMath>' +
      '<m:r><w:rPr><w:sz w:val="16"/></w:rPr><m:t>1</m:t></m:r>' +
      '<m:r><w:rPr><w:sz w:val="48"/></w:rPr><m:t>2</m:t></m:r>' +
      '</m:oMath><w:r><w:t>Z</w:t></w:r></w:p>'
  );

interface View {
  surface: PaginatedSurface;
  container: HTMLElement;
}

function open(bytes: Uint8Array, peer?: Peer): View {
  peer?.detach();
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, {
    scale: 1,
    measurer,
    ...(peer ? { collaborationModel: { session: peer.room.session } } : {}),
  });
  if (!opened.ok) throw new Error(opened.reason);
  return { surface: opened.surface, container };
}

const xml = (view: View) => strFromU8(unzipSync(view.surface.save())['word/document.xml']!);
const text = (view: View) => view.surface.session.bodyText().split('\n')[0];
const geometry = (view: View) =>
  linesOf(view.surface.layout()).map((line) => ({
    box: line.box,
    baseline: line.baseline,
    spans: line.spans.map((span) => ({ box: span.box, equation: span.equation?.geometry })),
  }));

function select(view: View, offset: number, end = offset) {
  const paragraphId = view.surface.session.paragraphIds()[0]!;
  view.surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset: end },
  });
}

function sized(view: View) {
  const equation = linesOf(view.surface.layout())[0]!.spans.find(
    (span) => span.equation
  )!.equation!;
  expect(equation.geometry.kind).toBe('row');
  if (equation.geometry.kind !== 'row') throw new Error('missing equation row');
  expect(
    equation.geometry.items.map((item) => (item.kind === 'text' ? item.fontSizePt : null))
  ).toEqual([8, 24]);
  expect(linesOf(view.surface.layout())[0]!.box.height).toBeCloseTo(27.6, 8);
  expect(
    [...view.container.querySelectorAll<HTMLElement>('.docx-equation-text')].map(
      (node) => node.style.fontSize
    )
  ).toEqual(['8px', '24px']);
  expect(xml(view)).toContain('w:val="16"');
  expect(xml(view)).toContain('w:val="48"');
}

function destroy(view: View) {
  view.surface.destroy();
  view.container.remove();
}

test('two shared editors retain mixed sizes through text edits, history, deletion, selections, reconnect and reopen', async () => {
  const harness = createPeerHarness('equation-mixed-run-size', { offlineEditing: true });
  const views: View[] = [];
  try {
    const peers = await harness.pair(source());
    const left = open(peers.alice.room.document, peers.alice);
    const right = open(peers.bob.room.document, peers.bob);
    views.push(left, right);
    const same = (expected: string, hasEquation = true) => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      expect(text(left)).toBe(expected);
      expect(text(right)).toBe(expected);
      expect(xml(left)).toBe(xml(right));
      expect(geometry(left)).toEqual(geometry(right));
      if (hasEquation) {
        sized(left);
        sized(right);
      }
    };
    same('A\uFFFCZ');
    select(left, 1);
    const equation = left.surface.equations.equationAtCaret()!;
    expect(left.surface.equations.applyEquation(equation.id, '3+4')).toBe(false);
    same('A\uFFFCZ');
    select(left, 1, 2);
    applyAwarenessUpdate(
      peers.bob.awareness,
      encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
      'test'
    );
    const remote = peers.bob.room.session.remoteSelections()[0]!;
    expect(
      caretAt(right.surface.layout(), {
        paragraphId: remote.head.nodeId,
        offset: remote.head.offset,
      })
    ).toEqual(caretAt(left.surface.layout(), left.surface.state().selection.head));
    peers.pause();
    select(left, 0);
    select(right, 3);
    left.surface.type('L');
    right.surface.type('R');
    peers.resume();
    same('LA\uFFFCZR');
    left.surface.undo();
    same('A\uFFFCZR');
    left.surface.redo();
    same('LA\uFFFCZR');
    peers.pause();
    select(left, 2, 3);
    select(right, 5);
    left.surface.deleteForward();
    right.surface.type('C');
    peers.resume();
    same('LAZRC', false);
    expect(left.container.querySelector('.docx-equation')).toBeNull();
    left.surface.undo();
    same('LA\uFFFCZRC');
    const reopened = open(left.surface.save());
    views.push(reopened);
    sized(reopened);
    expect(geometry(reopened)).toEqual(geometry(left));
    expect(xml(reopened)).toBe(xml(left));
    destroy(right);
    views.splice(views.indexOf(right), 1);
    harness.leave(peers.bob);
    select(left, 6);
    left.surface.type('D');
    const joined = await harness.join(peers.alice, 'joined');
    const third = open(joined.room.document, joined);
    views.push(third);
    expect(text(third)).toBe(text(left));
    expect(geometry(third)).toEqual(geometry(left));
    expect(xml(third)).toBe(xml(left));
    sized(third);
  } finally {
    for (const view of views) destroy(view);
    harness.cleanup();
  }
}, 10000);
