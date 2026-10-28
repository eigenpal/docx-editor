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
  /** Compatibility mode 15 with a 31pt terminal row: the repeated header yields to its rule. */
  headerYields?: boolean;
  /** Three rows on a 54pt band: the middle row ends page 1 and the last row opens page 2. */
  pageEdge?: boolean;
  /** No compatibility mode, a 40pt last row: the repeat stays and the row runs past the margin. */
  overflows?: boolean;
  /** No compatibility mode: a six-line row that cannot split stays whole past the 52pt band. */
  tallRow?: boolean;
  /** With `tallRow`: its second line references a two-line footnote. */
  footnote?: boolean;
  /** No compatibility mode: a splittable row opens with a 40pt line, so it stays whole. */
  splitStart?: boolean;
  /** With `splitStart`: a nested table holds that 40pt line. */
  nested?: boolean;
}
const nestedTable = (content: string) =>
  `<w:tbl><w:tblPr><w:tblW w:w="3000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>`;
const SETTINGS = 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
const settingsPackage = {
  overrides: `<Override PartName="/word/settings.xml" ContentType="${SETTINGS}"/>`,
  documentRels:
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
  extraXml: {
    'word/settings.xml':
      '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
  },
};
const FOOTNOTES = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const note = (id: number, content: string, type?: string) =>
  `<w:footnote${type ? ` w:type="${type}"` : ''} w:id="${id}"><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>${content}</w:p></w:footnote>`;
const footnotePackage = {
  overrides: `<Override PartName="/word/footnotes.xml" ContentType="${FOOTNOTES}"/>`,
  documentRels:
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>',
  extraXml: {
    'word/footnotes.xml': `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${note(-1, '<w:r><w:separator/></w:r>', 'separator')}${note(0, '<w:r><w:continuationSeparator/></w:r>', 'continuationSeparator')}${note(1, '<w:r><w:footnoteRef/></w:r><w:r><w:t>Note</w:t><w:br/><w:t>More</w:t></w:r>')}</w:footnotes>`,
  },
};
const citing = (text: string) =>
  paragraph(text).replace('</w:p>', '<w:r><w:footnoteReference w:id="1"/></w:r></w:p>');
function documentBody(options: ReferenceCase) {
  const borders = ['top', 'bottom', 'left', 'right']
    .map(
      (s) =>
        `<w:${s} w:val="single" w:sz="${s === 'top' && !options.pageEdge ? 4 : options.width * 8}"/>`
    )
    .join('');
  const rows = (options.pageEdge ? ['First', 'Middle', 'Terminal'] : ['First', 'Terminal'])
    .map((text, index) =>
      options.splitStart && index === 1
        ? `<w:tr><w:tc>${(options.nested ? nestedTable : (xml: string) => xml)(paragraph(`${text}1`).replace('w:line="240"', 'w:line="800"'))}${paragraph(`${text}2`)}</w:tc></w:tr>`
        : options.tallRow && index === 1
          ? `<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:vAlign w:val="${options.align}"/></w:tcPr>${[1, 2, 3, 4, 5, 6].map((line) => (options.footnote && line === 2 ? citing : paragraph)(`${text}${line}`)).join('')}</w:tc></w:tr>`
          : `<w:tr><w:trPr>${index === 0 && !options.pageEdge ? '<w:tblHeader/>' : ''}<w:trHeight w:val="${index === 1 && options.headerYields ? 620 : index === 1 && options.overflows ? 800 : 397}" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:vAlign w:val="${options.align}"/></w:tcPr>${paragraph(text)}</w:tc></w:tr>`
    )
    .join('');
  const section = options.tightPage
    ? `<w:pgSz w:w="10000" w:h="${options.pageEdge ? 1800 : 1760}"/><w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360"/>`
    : '';
  return `${paragraph('CASE')}<w:tbl><w:tblPr><w:tblW w:w="3600" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}<w:insideH w:val="single" w:sz="4"/></w:tblBorders><w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="3600"/></w:tblGrid>${rows}</w:tbl>${paragraph('AFTER')}<w:sectPr>${section}</w:sectPr>`;
}

function geometry(editor: Editor, options: ReferenceCase) {
  const layout = editor.surface!.layout();
  const tables = layout.pages.map((p) => p.fragments.filter((f) => f.kind === 'table'));
  // The fragment that holds the terminal row is the table's last one.
  const table = tables.flat().at(-1);
  if (!table || table.kind !== 'table') throw new Error('The table is missing');
  const after = layout.pages
    .flatMap((p) => p.fragments)
    .find(
      (f) => f.kind === 'paragraph' && f.lines.some((l) => l.spans.some((s) => s.text === 'AFTER'))
    );
  if (options.pageEdge) {
    // Page 1: 12pt + 19.85pt + 19.85pt, and the middle row's 1.5pt closing rule below it.
    const first = tables[0]![0]!;
    const middle = first.kind === 'table' ? first.rows.at(-1) : undefined;
    expect(middle?.box.height).toBeCloseTo(19.85 + options.width, 6);
    expect(middle!.cells[0]!.blocks[0]!.box.y - middle!.box.y).toBeCloseTo(7.85, 6);
    // Page 2: the 1.5pt top rule replaces the 0.5pt inside rule. 1pt sits above the row.
    expect(tables[1]).toEqual([table]);
    const last = table.rows[0]!;
    expect(last.box.height).toBeCloseTo(1 + 19.85 + options.width, 6);
    expect(last.cells[0]!.blocks[0]!.box.y - last.box.y).toBeCloseTo(8.85, 6);
    return { middle: middle!.box, rows: table.rows.map((r) => r.box), after: after?.box };
  }
  if (options.tallRow) {
    // Page 2: the repeated header, then all six 12pt lines of the row, past the 52pt band.
    expect(tables[1]).toEqual([table]);
    const [repeat, last] = table.rows;
    expect(repeat!.isHeaderRepeat).toBe(true);
    expect(last!.hasContinuation).toBeFalsy();
    expect(last!.cells[0]!.blocks).toHaveLength(6);
    expect(last!.box.y + last!.box.height).toBeGreaterThan(52);
    expect(layout.pages[2]!.fragments).toContain(after!);
    // The caret on the last line, below the bottom margin, has geometry on that page.
    const lastLine = last!.cells[0]!.blocks.at(-1)!;
    const caret = caretAt(layout, {
      paragraphId: lastLine.kind === 'paragraph' ? lastLine.paragraphId : '',
      offset: 0,
    });
    expect(caret?.pageIndex).toBe(1);
    if (options.footnote) {
      // No reserve makes room below the row: the page keeps the note's first line at its
      // bottom, over the row, and the second line continues on page 3.
      const page = layout.pages[1]!;
      const area = page.footnotes!;
      expect(area.notes.map((n) => [n.noteId, n.continuation ?? false])).toEqual([[1, false]]);
      expect(area.box.y + area.box.height).toBeCloseTo(
        page.contentBox.y + page.contentBox.height,
        6
      );
      expect(layout.pages[2]!.footnotes!.notes.map((n) => [n.noteId, n.continuation])).toEqual([
        [1, true],
      ]);
      return { rows: table.rows.map((r) => r.box), after: after?.box, caret, notes: area.box };
    }
    return { rows: table.rows.map((r) => r.box), after: after?.box, caret };
  }
  if (options.splitStart) {
    // Page 2: the repeat stays above the row, which keeps both lines and ends past the band.
    expect(tables[1]).toEqual([table]);
    const [repeat, last] = table.rows;
    expect(repeat!.isHeaderRepeat).toBe(true);
    expect(last!.hasContinuation).toBeFalsy();
    expect(last!.cells[0]!.blocks.map((b) => b.kind)).toEqual([
      options.nested ? 'table' : 'paragraph',
      'paragraph',
    ]);
    expect(last!.box.y + last!.box.height).toBeGreaterThan(52);
    expect(layout.pages[2]!.fragments).toContain(after!);
    return { rows: table.rows.map((r) => r.box), after: after?.box };
  }
  if (options.overflows) {
    // Page 2: the repeated 19.85pt header stays above the 40pt row, which ends past the 52pt band.
    expect(tables[1]).toEqual([table]);
    const [repeat, last] = table.rows;
    expect(repeat!.isHeaderRepeat).toBe(true);
    expect(last!.box.y - table.box.y).toBeCloseTo(19.85, 6);
    expect(last!.box.height).toBeCloseTo(40 + options.width, 6);
    expect(layout.pages[2]!.fragments).toContain(after!);
    return { rows: table.rows.map((r) => r.box), after: after?.box };
  }
  if (options.headerYields) {
    // Page 2: 19.85pt + 31pt fits the 52pt band, but 1.5pt more does not. The repeat is
    // omitted, so the terminal row starts the page and its rule fits there.
    expect(tables[1]).toEqual([table]);
    expect(table.rows).toHaveLength(1);
    const only = table.rows[0]!;
    expect(only.isHeaderRepeat).toBeFalsy();
    expect(only.box.y).toBe(table.box.y);
    expect(only.box.height).toBeCloseTo(31 + options.width, 6);
    expect(only.cells[0]!.blocks[0]!.box.y - only.box.y).toBeCloseTo(19, 6);
    // The table's last page left out the repeat, so the paragraph after it starts page 3
    // although it fits below the row (`omittedRepeatEndsPage`).
    expect(layout.pages[2]!.fragments[0]).toBe(after!);
    expect(after?.box.y).toBe(0);
    return { box: table.box, rows: table.rows.map((r) => r.box), after: after?.box };
  }
  expect(table.box.height).toBeCloseTo(39.7 + options.width, 6);
  expect(table.rows).toHaveLength(2);
  const last = table.rows.at(-1)!;
  expect(last.box.height).toBeCloseTo(19.85 + options.width, 6);
  const text = last.cells[0]!.blocks[0]!;
  expect(text.box.y - last.box.y).toBeCloseTo(options.align === 'center' ? 4.175 : 7.85, 6);
  if (options.tightPage) {
    // 12pt + 19.85pt + 19.85pt fits the 52pt band only without the 1.5pt rule. The terminal
    // row moves; the authored header row stays on page 1 and repeats above it on page 2.
    const first = tables[0]![0]!;
    expect(first.kind === 'table' && first.rows.map((r) => r.isHeaderRow)).toEqual([true]);
    expect(tables[1]).toEqual([table]);
    expect(table.rows[0]!.isHeaderRepeat).toBe(true);
    expect(table.box.y + table.box.height).toBeLessThanOrEqual(52.001);
    expect(layout.pages[2]!.fragments).toContain(after!);
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
  { align: 'bottom', width: 1.5, tightPage: true, headerYields: true },
  { align: 'bottom', width: 1.5, tightPage: true, pageEdge: true },
  { align: 'center', width: 1.5, tightPage: true, overflows: true },
  { align: 'center', width: 1.5, tightPage: true, tallRow: true },
  { align: 'center', width: 1.5, tightPage: true, tallRow: true, footnote: true },
  { align: 'center', width: 1.5, tightPage: true, splitStart: true },
  { align: 'center', width: 1.5, tightPage: true, splitStart: true, nested: true },
] satisfies ReferenceCase[])
  test(`the ${options.align} terminal rule${options.headerYields ? ' that omits a repeated header' : options.pageEdge ? ' at a page edge' : options.overflows ? ' below a kept repeat' : options.splitStart ? ` below a repeat kept over a splittable row${options.nested ? ' that opens with a nested table' : ''}` : options.tallRow ? ` of a whole tall row${options.footnote ? ' with a footnote' : ''}` : ''} converges through edits and cold reopen`, async () => {
    const source = documentBody(options);
    const peers = await harness.pair(
      options.headerYields
        ? zipDocument(source, settingsPackage)
        : options.footnote
          ? zipDocument(source, footnotePackage)
          : zipDocument(source)
    );
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
