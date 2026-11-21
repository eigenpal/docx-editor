/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, REL, R, W, zipDocument, type Peer } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const margins =
  '<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>';
const borders =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:color="auto" w:sz="4" w:space="0"/>`)
    .join('') +
  '</w:tblBorders>';
const repeated = `<w:tblPrEx>${borders}${margins}</w:tblPrEx>`;
const cell = (text: string) =>
  '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="3108"/></w:tcPr>' +
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const table =
  '<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:tblInd w:type="dxa" w:w="0"/>' +
  borders +
  '<w:tblLayout w:type="autofit"/>' +
  margins +
  '</w:tblPr><w:tblGrid><w:gridCol w:w="3108"/><w:gridCol w:w="3108"/></w:tblGrid>' +
  `<w:tr>${repeated}${cell('One')}${cell('Two')}</w:tr>` +
  `<w:tr>${repeated}${cell('Three')}${cell('Four')}</w:tr></w:tbl>`;
const source = zipDocument(
  table +
    '<w:sectPr><w:pgSz w:w="8000" w:h="10000"/>' +
    '<w:pgMar w:left="1000" w:right="1000" w:top="1000" w:bottom="1000"/></w:sectPr>',
  {
    overrides:
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
    documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rSettings" Type="${R}/settings" Target="settings.xml"/></Relationships>`,
    extraXml: {
      'word/settings.xml':
        `<w:settings xmlns:w="${W}"><w:compat>` +
        '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="14"/>' +
        '</w:compat></w:settings>',
    },
  }
);

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Collaborative editors did not converge');
}

test('repeated row defaults keep the legacy table grid during collaborative edits and reopen', async () => {
  const harness = createPeerHarness('legacy-autofit-row-defaults');
  const opened: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
  function mount(peer?: Peer, bytes?: Uint8Array) {
    peer?.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer?.room.document ?? bytes!,
      ...(peer ? { modules: [collaborationModule({ session: peer.room.session })] } : {}),
    });
    opened.push({ editor, container });
    return editor;
  }
  function verifyGrid(editor: DocxEditorInstance) {
    const page = editor.surface!.layout().pages[0]!;
    const grid = page.fragments.find((fragment) => fragment.kind === 'table')!;
    expect(grid.box.x).toBeCloseTo(-5.4, 8);
    expect(grid.box.width).toBeCloseTo(310.8, 8);
  }
  function prepend(editor: DocxEditorInstance, paragraphId: string, text: string) {
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    editor.surface!.type(text);
  }

  try {
    const pair = await harness.pair(source);
    const left = mount(pair.alice);
    const right = mount(pair.bob);
    await until(() => !!left.surface && !!right.surface);
    [left, right].forEach(verifyGrid);
    const flush = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
    };
    const bothContain = (text: string) =>
      [left, right].every((editor) => editor.surface!.session.bodyText().includes(text));
    pair.pause();
    prepend(left, harness.paragraphIdAt(pair.alice, 0), 'L');
    prepend(right, harness.paragraphIdAt(pair.bob, 3), 'R');
    flush();
    pair.resume();
    await until(() => bothContain('LOne') && bothContain('RFour'));
    [left, right].forEach(verifyGrid);
    expect(left.exec({ type: 'undo' }).ok).toBe(true);
    flush();
    await until(() =>
      [left, right].every((editor) => !editor.surface!.session.bodyText().includes('LOne'))
    );
    expect(left.exec({ type: 'redo' }).ok).toBe(true);
    flush();
    await until(() => bothContain('LOne'));

    const bytes = new Uint8Array(await left.save());
    const xml = (data: Uint8Array) => strFromU8(unzipSync(data)['word/document.xml']!);
    expect(xml(bytes)).toBe(xml(new Uint8Array(await right.save())));
    expect(xml(bytes).match(/<w:tblPrEx>/g)).toHaveLength(2);
    const reopened = mount(undefined, bytes);
    await until(() => !!reopened.surface);
    [left, right, reopened].forEach(verifyGrid);
  } finally {
    for (const { editor, container } of opened) {
      editor.destroy();
      container.remove();
    }
    harness.cleanup();
  }
}, 15_000);
