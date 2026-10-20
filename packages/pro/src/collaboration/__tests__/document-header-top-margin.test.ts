/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt, type SemanticLayout } from '@docx-editor.dev/core/layout';
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, W, R, REL } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('header-top-margin-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
function fixture(topAndBottom: boolean) {
  const header =
    `<w:hdr xmlns:w="${W}" xmlns:r="${R}" ` +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" ' +
    'simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="topMargin"><wp:posOffset>${topAndBottom ? 0 : 1016000}</wp:posOffset></wp:positionV>` +
    '<wp:extent cx="1016000" cy="1016000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    (topAndBottom ? '<wp:wrapTopAndBottom/>' : '<wp:wrapSquare wrapText="bothSides"/>') +
    '<wp:docPr id="1" name="Box"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1016000" cy="1016000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/>' +
    '</a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r></w:p></w:hdr>';
  return zipDocument(
    '<w:p><w:r><w:t>Alpha beta gamma delta epsilon.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p>' +
      '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/>' +
      '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" ' +
      'w:bottom="1440" w:header="480" w:footer="480"/></w:sectPr>',
    {
      overrides:
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
      documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rIdHeader" Type="${R}/header" Target="header1.xml"/><Relationship Id="rIdSettings" Type="${R}/settings" Target="settings.xml"/></Relationships>`,
      extraXml: {
        'word/header1.xml': header,
        'word/settings.xml': `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
      },
    }
  );
}
const geometry = (layout: SemanticLayout) =>
  layout.pages.map((page) => ({
    content: page.contentBox,
    body: page.fragments,
    header: page.header?.fragments,
    drawings: page.header?.anchoredDrawings,
  }));
const savedGeometry = (layout: SemanticLayout) =>
  JSON.parse(
    JSON.stringify(geometry(layout), (key, value) =>
      key === 'id' || key.endsWith('Id') ? undefined : value
    )
  );

for (const topAndBottom of [false, true]) {
  test(`header top-margin ${topAndBottom ? 'band' : 'square'} geometry survives real collaboration, history, conflicts, and reopen`, async () => {
    const peers = await harness.pair(fixture(topAndBottom));
    const mounted = [peers.alice, peers.bob].map((peer) => {
      peer.detach();
      const editor = createDocxEditor({
        container: document.createElement('div'),
        document: peer.room.document,
        modules: [collaborationModule({ session: peer.room.session })],
      });
      editors.push(editor);
      return editor;
    });
    const [alice, bob] = mounted as [Editor, Editor];
    const surface = (editor: Editor) => editor.surface!;
    const first = surface(alice).layout().pages[0]!.fragments[0]!;
    if (first.kind !== 'paragraph') throw Error('Missing paragraph');
    const target = first.paragraphId;
    const select = (editor: Editor, offset: number, head = offset) =>
      surface(editor).setSelection({
        anchor: { paragraphId: target, offset },
        head: { paragraphId: target, offset: head },
      });
    const flush = () => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
    };
    const converge = () => {
      flush();
      const left = surface(alice).session.currentPackage();
      const right = surface(bob).session.currentPackage();
      expect(packageFingerprint(left)).toBe(packageFingerprint(right));
      expect(geometry(surface(alice).layout())).toEqual(geometry(surface(bob).layout()));
      expect(saveReopenDigest(left)).toEqual(saveReopenDigest(right));
      const story = surface(alice).layout().pages[0]!.header!;
      const drawing = story.anchoredDrawings![0]!;
      expect(story.box.y + drawing.y).toBeCloseTo(topAndBottom ? 0 : 80, 5);
      if (topAndBottom) {
        const line = story.fragments.flatMap((fragment) =>
          fragment.kind === 'paragraph' ? fragment.lines : []
        )[0]!;
        const page = surface(alice).layout().pages[0]!;
        const bodyLine = page.fragments.flatMap((fragment) =>
          fragment.kind === 'paragraph' ? fragment.lines : []
        )[0]!;
        expect(story.box.y + line.box.y).toBeCloseTo(80, 5);
        expect(page.contentBox.y).toBeCloseTo(80 + line.box.height, 5);
        expect(page.contentBox.y + bodyLine.box.y).toBeCloseTo(80 + line.box.height, 5);
      }
      expect(drawing.paintBounds.height).toBe(80);
      const reopened = createDocxEditor({
        container: document.createElement('div'),
        document: writeOoxmlPackage(left),
      });
      try {
        expect(savedGeometry(surface(reopened).layout())).toEqual(
          savedGeometry(surface(alice).layout())
        );
      } finally {
        reopened.destroy();
      }
    };
    converge();
    const original = packageFingerprint(surface(alice).session.currentPackage());
    select(alice, 5);
    surface(alice).type(' extended');
    converge();
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
    let count = 0;
    while (packageFingerprint(surface(alice).session.currentPackage()) !== original) {
      expect(count++).toBeLessThan(10);
      expect(alice.exec({ type: 'undo' }).ok).toBe(true);
      converge();
    }
    for (let index = 0; index < count; index++) {
      expect(alice.exec({ type: 'redo' }).ok).toBe(true);
      converge();
    }
    peers.pause();
    select(alice, 1, 8);
    select(bob, 4);
    surface(alice).deleteBackward();
    surface(bob).type('Z');
    flush();
    peers.resume();
    converge();
    expect(bob.findMatches('Z')).toHaveLength(1);
  });
}
