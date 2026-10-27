/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt } from '@docx-editor.dev/core/layout';
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('exact-terminal-rule-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const paragraph = (text: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
interface ReferenceCase {
  align: 'center' | 'bottom';
  width: number;
  tightPage?: boolean;
}
function documentBody(options: ReferenceCase) {
  const borders = ['top', 'bottom', 'left', 'right']
    .map((s) => `<w:${s} w:val="single" w:sz="${s === 'top' ? 4 : options.width * 8}"/>`)
    .join('');
  const rows = ['First', 'Terminal']
    .map(
      (text, index) =>
        `<w:tr><w:trPr>${index === 0 ? '<w:tblHeader/>' : ''}<w:trHeight w:val="397" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:vAlign w:val="${options.align}"/></w:tcPr>${paragraph(text)}</w:tc></w:tr>`
    )
    .join('');
  const section = options.tightPage
    ? '<w:pgSz w:w="10000" w:h="1760"/><w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360"/>'
    : '';
  return `${paragraph('CASE')}<w:tbl><w:tblPr><w:tblW w:w="3600" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}<w:insideH w:val="single" w:sz="4"/></w:tblBorders><w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="3600"/></w:tblGrid>${rows}</w:tbl>${paragraph('AFTER')}<w:sectPr>${section}</w:sectPr>`;
}

function geometry(editor: Editor, options: ReferenceCase) {
  const layout = editor.surface!.layout();
  const table = layout.pages.flatMap((p) => p.fragments).find((f) => f.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('The table is missing');
  expect(table.box.height).toBeCloseTo(39.7 + options.width, 6);
  expect(table.rows).toHaveLength(2);
  const last = table.rows.at(-1)!;
  expect(last.box.height).toBeCloseTo(19.85 + options.width, 6);
  const text = last.cells[0]!.blocks[0]!;
  expect(text.box.y - last.box.y).toBeCloseTo(options.align === 'center' ? 4.175 : 7.85, 6);
  const after = layout.pages
    .flatMap((p) => p.fragments)
    .find(
      (f) => f.kind === 'paragraph' && f.lines.some((l) => l.spans.some((s) => s.text === 'AFTER'))
    );
  if (options.tightPage) {
    expect(last.box.y + 19.85).toBeLessThanOrEqual(52.001);
    expect(table.box.y + table.box.height).toBeGreaterThan(52);
    expect(layout.pages[1]!.fragments).toContain(after!);
  } else expect(after?.box.y).toBeCloseTo(table.box.y + table.box.height, 6);
  return {
    box: table.box,
    rows: table.rows.map((r) => ({
      box: r.box,
      cells: r.cells.map((c) => ({ box: c.box, borders: c.borders, blocks: c.blocks })),
    })),
    after: after?.box,
  };
}

for (const options of [
  { align: 'center', width: 0.625 },
  { align: 'bottom', width: 1.5, tightPage: true },
] satisfies ReferenceCase[])
  test(`the ${options.align} terminal rule converges through edits and cold reopen`, async () => {
    const peers = await harness.pair(zipDocument(documentBody(options)));
    const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
      peer.detach();
      const editor = createDocxEditor({
        container: document.createElement('div'),
        document: peer.room.document,
        modules: [collaborationModule({ session: peer.room.session })],
      });
      editors.push(editor);
      return editor;
    }) as [Editor, Editor];
    const sync = () => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
    };
    const converged = () => {
      sync();
      const left = alice.surface!.session.currentPackage();
      const right = bob.surface!.session.currentPackage();
      expect(packageFingerprint(right)).toBe(packageFingerprint(left));
      expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
      expect(geometry(bob, options)).toEqual(geometry(alice, options));
    };
    const select = (editor: Editor, offset: number) => {
      const paragraphId = editor.surface!.session.paragraphIds()[2]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset },
        head: { paragraphId, offset },
      });
    };
    converged();
    select(alice, 1);
    alice.surface!.type('A');
    converged();
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    converged();
    expect(alice.exec({ type: 'redo' }).ok).toBe(true);
    converged();
    applyAwarenessUpdate(
      peers.bob.awareness,
      encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
      'test'
    );
    const remote = peers.bob.room.session.remoteSelections()[0]!;
    const leftCaret = caretAt(alice.surface!.layout(), {
      paragraphId: remote.head.nodeId,
      offset: remote.head.offset,
    })!;
    const rightCaret = caretAt(bob.surface!.layout(), {
      paragraphId: remote.head.nodeId,
      offset: remote.head.offset,
    })!;
    expect(leftCaret).not.toBeNull();
    expect(rightCaret).toEqual(leftCaret);
    select(alice, 1);
    select(bob, 0);
    peers.pause();
    alice.surface!.deleteBackward();
    bob.surface!.type('Concurrent');
    sync();
    peers.resume();
    converged();
    expect(alice.findMatches('Concurrent')).toHaveLength(1);
    const late = await harness.join(peers.alice, 'late-peer');
    expect(saveReopenDigest(late.store.currentPackage())).toEqual(
      saveReopenDigest(alice.surface!.session.currentPackage())
    );
    const cold = createDocxEditor({
      container: document.createElement('div'),
      document: writeOoxmlPackage(alice.surface!.session.currentPackage()),
    });
    editors.push(cold);
    expect(geometry(cold, options)).toEqual(geometry(alice, options));
  });
