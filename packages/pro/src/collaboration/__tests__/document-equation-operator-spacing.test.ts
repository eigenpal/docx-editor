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
// Relations take 5/18 em on each side and binary operators 4/18 em, at the 12 pt default size.
const THICK = (5 / 18) * 12;
const MEDIUM = (4 / 18) * 12;
const source = () =>
  zipDocument(
    `<w:p xmlns:m="${M}"><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
      '<w:r><w:t>A</w:t></w:r><m:oMath><m:r><m:t>x=y+1</m:t></m:r></m:oMath><w:r><w:t>Z</w:t></w:r></w:p>'
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

/** Assert the operator spacing of the equation, and that the caret steps over all of it. */
function spaced(view: View, glyphs: string[], spaces: number[]) {
  const layout = view.surface.layout();
  const span = linesOf(layout)[0]!.spans.find((candidate) => candidate.equation)!;
  const row = span.equation!.geometry;
  if (row.kind !== 'row') throw new Error('expected a spaced equation row');
  expect(row.items.map((item) => (item.kind === 'text' ? item.text : item.kind))).toEqual(glyphs);
  expect(
    row.items.map((item, index) => {
      const previous = row.items[index - 1];
      return previous ? item.box.x - (previous.box.x + previous.box.width) : item.box.x;
    })
  ).toEqual(spaces.map((space) => expect.closeTo(space, 9)));
  const glyphWidth = glyphs.length * 6;
  const width = glyphWidth + spaces.reduce((sum, space) => sum + space, 0);
  expect(row.box.width).toBeCloseTo(width, 9);
  const before = caretAt(layout, {
    paragraphId: span.range.paragraphId,
    offset: span.range.start,
  })!;
  const after = caretAt(layout, { paragraphId: span.range.paragraphId, offset: span.range.end })!;
  expect(after.x - before.x).toBeCloseTo(width, 9);
  expect(span.box.width).toBeCloseTo(width, 9);
}

const original = (view: View) =>
  spaced(view, ['𝑥', '=', '𝑦', '+', '1'], [0, THICK, THICK, MEDIUM, MEDIUM]);

function destroy(view: View) {
  view.surface.destroy();
  view.container.remove();
}

test('two shared editors keep operator spacing through edits, replacement, history, deletion, selections, reconnect and reopen', async () => {
  const harness = createPeerHarness('equation-operator-spacing', { offlineEditing: true });
  const views: View[] = [];
  try {
    const peers = await harness.pair(source());
    const left = open(peers.alice.room.document, peers.alice);
    const right = open(peers.bob.room.document, peers.bob);
    views.push(left, right);
    const same = (expected: string, check: ((view: View) => void) | null = original) => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      expect(text(left)).toBe(expected);
      expect(text(right)).toBe(expected);
      expect(xml(left)).toBe(xml(right));
      expect(geometry(left)).toEqual(geometry(right));
      if (check) {
        check(left);
        check(right);
      }
    };
    same('A\uFFFCZ');
    expect(xml(left)).toContain('<m:t>x=y+1</m:t>');
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
    // A compact replacement on one peer respaces the equation on both.
    select(left, 2);
    const equation = left.surface.equations.equationAtCaret()!;
    expect(left.surface.equations.applyEquation(equation.id, 'a-b<c')).toBe(true);
    const replaced = (view: View) =>
      spaced(view, ['𝑎', '\u2212', '𝑏', '<', '𝑐'], [0, MEDIUM, MEDIUM, THICK, THICK]);
    same('LA\uFFFCZR', replaced);
    left.surface.undo();
    same('LA\uFFFCZR');
    left.surface.redo();
    same('LA\uFFFCZR', replaced);
    left.surface.undo();
    same('LA\uFFFCZR');
    peers.pause();
    select(left, 2, 3);
    select(right, 5);
    left.surface.deleteForward();
    right.surface.type('C');
    peers.resume();
    same('LAZRC', null);
    expect(left.container.querySelector('.docx-equation')).toBeNull();
    left.surface.undo();
    same('LA\uFFFCZRC');
    const reopened = open(left.surface.save());
    views.push(reopened);
    original(reopened);
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
    original(third);
  } finally {
    for (const view of views) destroy(view);
    harness.cleanup();
  }
}, 10000);
