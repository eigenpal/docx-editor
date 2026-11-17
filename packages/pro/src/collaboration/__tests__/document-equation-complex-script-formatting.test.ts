/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Equations with complex-script formatting (`w:bCs`, a `w:szCs` that differs from `w:sz`) on
// text and controls without complex-script characters. They draw from the shared tree, so both
// peers draw the same structures through edits, history, deletion, reconnect and reopen, and the
// source keeps those properties because compact replacement refuses to rewrite them.
import { expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
} from '../../../../core/src/editor/paginated-surface.ts';
import { linesOf, type TextMeasurer } from '@docx-editor.dev/core/layout';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const measurer: TextMeasurer = {
  measure: (text, style) => Array.from(text).length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({ height: style.fontSizePt * 1.15, baseline: style.fontSizePt * 0.9 }),
};
const FONTS = '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:cs="Public Complex"/>';
const CONTROL = `<m:ctrlPr><w:rPr>${FONTS}<w:bCs/><w:i/><w:sz w:val="28"/><w:szCs w:val="32"/></w:rPr></m:ctrlPr>`;
const run = (text: string) =>
  `<m:r><w:rPr>${FONTS}<w:sz w:val="28"/><w:szCs w:val="32"/></w:rPr><m:t>${text}</m:t></m:r>`;
const source = () =>
  zipDocument(
    `<w:p xmlns:m="${M}"><w:r><w:t>A</w:t></w:r><m:oMath>` +
      `<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/>${CONTROL}</m:dPr><m:e>` +
      `<m:f><m:fPr>${CONTROL}</m:fPr><m:num>${run('a-b')}</m:num><m:den>${run('c-d')}</m:den>` +
      `</m:f></m:e></m:d>${run('×100')}</m:oMath><w:r><w:t>Z</w:t></w:r></w:p>`
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
    spans: line.spans.map((span) => ({ box: span.box, equation: span.equation?.geometry })),
  }));

function select(view: View, offset: number, end = offset) {
  const paragraphId = view.surface.session.paragraphIds()[0]!;
  view.surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset: end },
  });
}

/** The equation draws as a bracketed 14pt fraction, and the source keeps its properties. */
function drawn(view: View) {
  const equation = linesOf(view.surface.layout())[0]!.spans.find(
    (span) => span.equation
  )!.equation!;
  const shape = JSON.stringify(equation.geometry);
  expect(shape).toContain('"kind":"delimiter"');
  expect(shape).toContain('"kind":"fraction"');
  expect(shape).toContain('"fontSizePt":14');
  const saved = xml(view);
  expect(saved.match(/<w:bCs\/>/g)).toHaveLength(2);
  expect(saved.match(/<w:szCs w:val="32"\/>/g)).toHaveLength(5);
}

function destroy(view: View) {
  view.surface.destroy();
  view.container.remove();
}

test('two shared editors draw complex-script-formatted equations through edits, history, deletion, reconnect and reopen', async () => {
  const harness = createPeerHarness('equation-complex-script-formatting', {
    offlineEditing: true,
  });
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
        drawn(left);
        drawn(right);
      }
    };
    same('A￼Z');
    // Compact syntax cannot spell these properties, so the popover refuses the rewrite.
    select(left, 1);
    const equation = left.surface.equations.equationAtCaret()!;
    expect(left.surface.equations.applyEquation(equation.id, 'x+y')).toBe(false);
    same('A￼Z');

    peers.pause();
    select(left, 0);
    select(right, 3);
    left.surface.type('L');
    right.surface.type('R');
    peers.resume();
    same('LA￼ZR');
    left.surface.undo();
    same('A￼ZR');
    left.surface.redo();
    same('LA￼ZR');

    // One peer deletes the equation while the other types beside it.
    peers.pause();
    select(left, 2, 3);
    select(right, 5);
    left.surface.deleteForward();
    right.surface.type('C');
    peers.resume();
    same('LAZRC', false);
    left.surface.undo();
    same('LA￼ZRC');

    const reopened = open(left.surface.save());
    views.push(reopened);
    drawn(reopened);
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
    drawn(third);
  } finally {
    for (const view of views) destroy(view);
    harness.cleanup();
  }
}, 10000);
