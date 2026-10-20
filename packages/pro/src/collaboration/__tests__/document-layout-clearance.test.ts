/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt, type SemanticLayout } from '@docx-editor.dev/core/layout';
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, W, R, REL } from './document-peer-support.ts';
import { packageFingerprint } from './document-support.ts';
import {
  continuousRestartBytes,
  omittedGridCellBytes,
  restartedSectionBytes,
} from './document-layout-boundary-fixtures.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('layout-clearance', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const imageDecodePort = {
  async decode() {
    return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
  },
};
const settle = async () => {
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setTimeout(resolve, 5));
};
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
const paragraph = (text: string) =>
  '<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:after="0" w:line="280" ' +
  `w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const header =
  `<w:hdr xmlns:w="${W}"><w:p><w:pPr><w:framePr w:wrap="around" ` +
  'w:vAnchor="text" w:hAnchor="margin" w:xAlign="right" w:y="1"/></w:pPr></w:p>' +
  paragraph('Running title') +
  '</w:hdr>';
const documentBytes = zipDocument(
  paragraph('Opening') +
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
    '<w:tr><w:trPr><w:trHeight w:val="8000" w:hRule="atLeast"/></w:trPr><w:tc>' +
    paragraph('Editable cell') +
    '</w:tc></w:tr></w:tbl>' +
    paragraph('Closing') +
    '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/>' +
    '<w:pgSz w:w="8000" w:h="8000"/><w:pgMar w:top="1000" w:bottom="1000" ' +
    'w:left="1000" w:right="1000" w:header="200" w:footer="200"/></w:sectPr>',
  {
    overrides:
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/></Relationships>`,
    extraXml: { 'word/header1.xml': header },
  }
);
// A kept row fits the full page, but not the band below a wrapping header picture.
const floatHeader = `<w:hdr xmlns:w="${W}" xmlns:r="${R}"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0"
  simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">
  <wp:simplePos x="0" y="0"/>
  <wp:positionH relativeFrom="page"><wp:posOffset>2540000</wp:posOffset></wp:positionH>
  <wp:positionV relativeFrom="page"><wp:posOffset>254000</wp:posOffset></wp:positionV>
  <wp:extent cx="1905000" cy="1905000"/><wp:wrapSquare wrapText="bothSides"/>
  <wp:docPr id="1" name="Header picture"/>
  <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>
  <pic:blipFill><a:blip r:embed="rImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
  <pic:spPr><a:xfrm><a:ext cx="1905000" cy="1905000"/></a:xfrm>
  <a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>
  </wp:anchor></w:drawing></w:r></w:p></w:hdr>`;
const floatParts = unzipSync(documentBytes);
floatParts['word/document.xml'] = strToU8(
  new TextDecoder()
    .decode(floatParts['word/document.xml'])
    .replace(paragraph('Opening'), '')
    .replace(
      '<w:tblPr/>',
      '<w:tblPr><w:tblW w:w="5000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>'
    )
    .replace('<w:trHeight w:val="8000" w:hRule="atLeast"/>', '<w:cantSplit/>')
    .replace(
      paragraph('Editable cell'),
      paragraph('Editable cell') + paragraph('More text').repeat(39)
    )
    .replace('<w:pgSz w:w="8000" w:h="8000"/>', '<w:pgSz w:w="12240" w:h="15840"/>')
    .replaceAll('="1000"', '="1440"')
);
floatParts['word/header1.xml'] = strToU8(floatHeader);
floatParts['word/_rels/header1.xml.rels'] = strToU8(
  `<Relationships xmlns="${REL}"><Relationship Id="rImage" Type="${R}/image" Target="media/pixel.png"/></Relationships>`
);
floatParts['word/media/pixel.png'] = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);
floatParts['[Content_Types].xml'] = strToU8(
  new TextDecoder()
    .decode(floatParts['[Content_Types].xml'])
    .replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')
);
const floatBytes = zipSync(floatParts);
const captionParts = unzipSync(documentBytes);
captionParts['word/document.xml'] = strToU8(
  new TextDecoder()
    .decode(captionParts['word/document.xml'])
    .replace(
      paragraph('Opening'),
      paragraph('Opening') + paragraph('Caption').replace('<w:pPr>', '<w:pPr><w:keepNext/>')
    )
);
const captionBytes = zipSync(captionParts);
const repeatedParts = unzipSync(floatBytes);
const row = (content: string, properties = '') =>
  `<w:tr><w:trPr>${properties}</w:trPr><w:tc>${content}</w:tc></w:tr>`;
const headerText = ['Heading one', 'Heading two', 'Heading three']
  .map((text) => paragraph(text).replace('<w:pPr>', '<w:pPr><w:keepNext/>'))
  .join('');
const repeatedBody =
  paragraph('Opening') +
  paragraph('Next') +
  '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
  row(headerText, '<w:tblHeader/>') +
  row(paragraph('Editable cell'), '<w:trHeight w:val="10800" w:hRule="atLeast"/>') +
  row(paragraph('Following cell')) +
  '</w:tbl>' +
  paragraph('Closing');
repeatedParts['word/document.xml'] = strToU8(
  new TextDecoder()
    .decode(repeatedParts['word/document.xml'])
    .replace(/<w:body>[\s\S]*?(?=<w:sectPr>)/, '<w:body>' + repeatedBody)
);
repeatedParts['word/settings.xml'] = strToU8(
  `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" ` +
    'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
);
repeatedParts['word/_rels/document.xml.rels'] = strToU8(
  new TextDecoder()
    .decode(repeatedParts['word/_rels/document.xml.rels'])
    .replace(
      '</Relationships>',
      `<Relationship Id="rSettings" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    )
);
repeatedParts['[Content_Types].xml'] = strToU8(
  new TextDecoder()
    .decode(repeatedParts['[Content_Types].xml'])
    .replace(
      '</Types>',
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'
    )
);
const repeatedBytes = zipSync(repeatedParts);
const geometry = (layout: SemanticLayout) =>
  JSON.parse(
    JSON.stringify(layout.pages, (key, value) =>
      key === 'id' || key.endsWith('Id') || key === 'revision'
        ? undefined
        : key === 'attributes' && Array.isArray(value)
          ? value.slice().sort((a, b) => a.localName.localeCompare(b.localName))
          : key === 'namespaceBindings' && Array.isArray(value)
            ? value.slice().sort((a, b) => a.prefix.localeCompare(b.prefix))
            : value
    )
  );

test.each([
  ['row minima and empty header frames', documentBytes, 3, 1],
  ['kept rows below header pictures', floatBytes, 2, 1],
  ['captions before oversized rows', captionBytes, 4, 2],
  ['repeated headers around oversized rows', repeatedBytes, 4, 5],
  ['restarted sections after an even initial number', restartedSectionBytes, 2, 1],
  ['continuous section restarts', continuousRestartBytes, 3, 4],
  ['exposed borders beside omitted grid cells', omittedGridCellBytes, 1, 3],
] as const)(
  '%s converge through edits, history, reconnect, and reopen',
  async (_name, bytes, pages, targetIndex) => {
    const peers = await harness.pair(bytes);
    const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
      peer.detach();
      const editor = createDocxEditor({
        container: document.createElement('div'),
        imageDecodePort,
        document: peer.room.document,
        modules: [collaborationModule({ session: peer.room.session })],
      });
      editors.push(editor);
      return editor;
    }) as [Editor, Editor];
    const surface = (editor: Editor) => editor.surface!;
    const target = surface(alice).session.paragraphIds()[targetIndex]!;
    const select = (editor: Editor, offset: number, end = offset) =>
      surface(editor).setSelection({
        anchor: { paragraphId: target, offset },
        head: { paragraphId: target, offset: end },
      });
    const flush = () => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
    };
    const converge = async () => {
      flush();
      await settle();
      const left = surface(alice).session.currentPackage();
      expect(packageFingerprint(left)).toBe(
        packageFingerprint(surface(bob).session.currentPackage())
      );
      expect(geometry(surface(alice).layout())).toEqual(geometry(surface(bob).layout()));
      const reopened = createDocxEditor({
        container: document.createElement('div'),
        imageDecodePort,
        document: writeOoxmlPackage(left),
      });
      try {
        await settle();
        expect(geometry(surface(reopened).layout())).toEqual(geometry(surface(alice).layout()));
      } finally {
        reopened.destroy();
      }
    };
    await converge();
    expect(surface(alice).layout().pages).toHaveLength(pages);
    if (bytes === floatBytes) {
      const table = surface(alice)
        .layout()
        .pages[0]!.fragments.find((block) => block.kind === 'table');
      expect(table!.box.y).toBeGreaterThanOrEqual(98);
    }
    select(alice, 0);
    surface(alice).type('A');
    await converge();
    applyAwarenessUpdate(
      peers.bob.awareness,
      encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
      'test'
    );
    const remote = peers.bob.room.session.remoteSelections()[0]!;
    expect(
      caretAt(surface(bob).layout(), {
        paragraphId: remote.head.nodeId,
        offset: remote.head.offset,
      })
    ).toEqual(caretAt(surface(alice).layout(), surface(alice).state().selection.head));
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    await converge();
    expect(alice.exec({ type: 'redo' }).ok).toBe(true);
    await converge();
    peers.pause();
    select(alice, 1, 4);
    select(bob, 2);
    surface(alice).deleteBackward();
    surface(bob).type('Z');
    flush();
    peers.resume();
    await converge();
    expect(bob.findMatches('Z')).toHaveLength(1);
    peers.pause();
    select(alice, 0);
    select(bob, 0);
    expect(alice.exec({ type: 'deleteRow' }).ok).toBe(true);
    surface(bob).type('Removed');
    flush();
    peers.resume();
    await converge();
    expect(surface(bob).session.paragraphIds()).not.toContain(target);
  }
);
