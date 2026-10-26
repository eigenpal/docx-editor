/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text boxes in headers and footers edit inside their story. Edits there replicate like any
// header edit: they converge, undo, survive a peer deleting the host paragraph, and show the
// editing peer's selection.
import { afterEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('header-textbox-editor-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
  harness.cleanup();
});

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

/** A page-anchored text box with one paragraph. */
function boxRun(text: string): string {
  return (
    `<w:r><w:drawing xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>3657600</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>228600</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1828800" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="7" name="Box 7"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

async function pair(box = boxRun('Shared'), body = '<w:p><w:r><w:t>Body</w:t></w:r></w:p>') {
  const peers = await harness.pair(
    zipDocument(
      body +
        '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/>' +
        '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" ' +
        'w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
      {
        overrides:
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
        documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/></Relationships>`,
        extraXml: {
          'word/header1.xml':
            `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">Letterhead </w:t></w:r>` +
            `${box}</w:p><w:p><w:r><w:t>Header tail</w:t></w:r></w:p></w:hdr>`,
        },
      }
    )
  );
  const containers: HTMLElement[] = [];
  const mounted = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  });
  const [alice, bob] = mounted as [Editor, Editor];
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
  return {
    alice,
    bob,
    peers,
    containers,
    sync,
    converged,
    pause: peers.pause,
    resume: peers.resume,
  };
}

/** Enter the header box and put the caret at the end of its story. */
function enterBox(editor: Editor, text: string): void {
  const match = editor.findMatches(text).find((m) => m.scope?.kind === 'frame')!;
  expect(match.scope?.kind === 'frame' && match.scope.owner?.kind).toBe('headerFooter');
  expect(editor.surface!.setActiveScope(match.scope!)).toBe(true);
  const end = { paragraphId: match.blockId, offset: match.start + match.length };
  editor.surface!.setSelection({ anchor: end, head: end });
}

const inBox = (editor: Editor, text: string) =>
  editor.findMatches(text).filter((m) => m.scope?.kind === 'frame');

function relayPresence(from: Peer, to: Peer): void {
  const clients = [...from.awareness.getStates().keys()];
  applyAwarenessUpdate(to.awareness, encodeAwarenessUpdate(from.awareness, clients), 'relay');
}

describe('header text box', () => {
  test('typing replicates, converges, and survives save and reopen', async () => {
    const { alice, bob, converged } = await pair();
    enterBox(alice, 'Shared');
    expect(alice.exec({ type: 'insertText', text: ' story' }).ok).toBe(true);
    converged();
    expect(inBox(bob, 'Shared story')).toHaveLength(1);
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: new Uint8Array(await bob.save()),
    });
    editors.push(reopened);
    expect(inBox(reopened, 'Shared story')).toHaveLength(1);
    expect(reopened.findMatches('Letterhead')).toHaveLength(1);
  });

  test('concurrent typing in one box keeps both edits', async () => {
    const { alice, bob, sync, converged, pause, resume } = await pair();
    enterBox(alice, 'Shared');
    enterBox(bob, 'Shared');
    pause();
    expect(alice.exec({ type: 'insertText', text: ' Alice' }).ok).toBe(true);
    expect(bob.exec({ type: 'insertText', text: ' Bob' }).ok).toBe(true);
    sync();
    resume();
    converged();
    for (const editor of [alice, bob]) {
      expect(inBox(editor, 'Alice')).toHaveLength(1);
      expect(inBox(editor, 'Bob')).toHaveLength(1);
    }
  });

  test('a peer typing in the header line while another types in the box converges', async () => {
    const { alice, bob, sync, converged, pause, resume } = await pair();
    enterBox(alice, 'Shared');
    expect(bob.surface!.setActiveScope({ kind: 'headerFooter', rId: 'rHeader' })).toBe(true);
    const tail = bob.findMatches('Header tail')[0]!;
    const end = { paragraphId: tail.blockId, offset: tail.start + tail.length };
    bob.surface!.setSelection({ anchor: end, head: end });
    pause();
    expect(alice.exec({ type: 'insertText', text: ' boxed' }).ok).toBe(true);
    expect(bob.exec({ type: 'insertText', text: ' line' }).ok).toBe(true);
    sync();
    resume();
    converged();
    for (const editor of [alice, bob]) {
      expect(inBox(editor, 'Shared boxed')).toHaveLength(1);
      expect(editor.findMatches('Header tail line')).toHaveLength(1);
    }
  });

  test('undo and redo of box typing replicate', async () => {
    const { alice, bob, converged } = await pair();
    enterBox(alice, 'Shared');
    expect(alice.exec({ type: 'insertText', text: ' undone' }).ok).toBe(true);
    converged();
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    converged();
    expect(bob.findMatches('undone')).toHaveLength(0);
    expect(alice.exec({ type: 'redo' }).ok).toBe(true);
    converged();
    expect(inBox(bob, 'Shared undone')).toHaveLength(1);
  });

  test('deleting the host paragraph while a peer types in the box converges', async () => {
    const { alice, bob, sync, converged, pause, resume } = await pair();
    enterBox(bob, 'Shared');
    expect(alice.surface!.setActiveScope({ kind: 'headerFooter', rId: 'rHeader' })).toBe(true);
    const host = alice.findMatches('Letterhead')[0]!.blockId;
    const tail = alice.findMatches('Header tail')[0]!.blockId;
    pause();
    expect(bob.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
    alice.surface!.setSelection({
      anchor: { paragraphId: host, offset: 0 },
      head: { paragraphId: tail, offset: 0 },
    });
    alice.surface!.deleteBackward();
    sync();
    resume();
    converged();
    // A range delete keeps an anchored box: it moves into the joined paragraph with the
    // peer's typing.
    for (const editor of [alice, bob]) {
      expect(editor.findMatches('Letterhead')).toHaveLength(0);
      expect(inBox(editor, 'Shared typed')).toHaveLength(1);
      expect(editor.findMatches('Header tail')).toHaveLength(1);
    }
    enterBox(bob, 'Shared typed');
    expect(bob.exec({ type: 'insertText', text: ' again' }).ok).toBe(true);
    converged();
    expect(inBox(alice, 'Shared typed again')).toHaveLength(1);
  });

  test('a selection in the box replicates to the peer', async () => {
    const { alice, peers, containers, sync } = await pair();
    enterBox(alice, 'Shared');
    const match = inBox(alice, 'Shared')[0]!;
    alice.surface!.setSelection({
      anchor: { paragraphId: match.blockId, offset: match.start },
      head: { paragraphId: match.blockId, offset: match.start + 3 },
    });
    sync();
    relayPresence(peers.alice, peers.bob);
    expect(peers.bob.room.session.remoteSelections()).toMatchObject([
      {
        actorId: 'alice',
        anchor: { nodeId: match.blockId, offset: match.start },
        head: { nodeId: match.blockId, offset: match.start + 3 },
      },
    ]);
    // The peer paints the range over the box text.
    expect(containers[1]!.querySelectorAll('.docx-remote-selection-rect').length).toBeGreaterThan(
      0
    );
  });

  test('a peer deleting the box while it is edited returns the editor to its header', async () => {
    const V = 'urn:schemas-microsoft-com:vml';
    const legacy =
      `<w:r><w:pict xmlns:v="${V}"><v:rect style="width:144pt;height:36pt;` +
      'mso-position-horizontal-relative:char;mso-position-vertical-relative:line" filled="f">' +
      '<v:textbox><w:txbxContent><w:p><w:r><w:t>Shared</w:t></w:r></w:p></w:txbxContent>' +
      '</v:textbox></v:rect></w:pict></w:r><w:r><w:t xml:space="preserve"> after</w:t></w:r>';
    const { alice, bob, sync, converged, pause, resume } = await pair(legacy);
    enterBox(bob, 'Shared');
    expect(alice.surface!.setActiveScope({ kind: 'headerFooter', rId: 'rHeader' })).toBe(true);
    const host = alice.findMatches('Letterhead')[0]!.blockId;
    const tail = alice.findMatches('Header tail')[0]!.blockId;
    pause();
    expect(bob.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
    alice.surface!.setSelection({
      anchor: { paragraphId: host, offset: 0 },
      head: { paragraphId: tail, offset: 0 },
    });
    alice.surface!.deleteBackward();
    sync();
    resume();
    converged();
    for (const editor of [alice, bob]) {
      expect(editor.findMatches('Shared')).toHaveLength(0);
      expect(editor.findMatches('typed')).toHaveLength(0);
      expect(editor.findMatches('Header tail')).toHaveLength(1);
    }
    // The box is gone, so its editor leaves it and keeps typing in the header.
    expect(bob.surface!.activeScope().kind).toBe('headerFooter');
    const left = bob.findMatches('Header tail')[0]!;
    const start = { paragraphId: left.blockId, offset: left.start };
    bob.surface!.setSelection({ anchor: start, head: start });
    expect(bob.exec({ type: 'insertText', text: 'Still ' }).ok).toBe(true);
    converged();
    expect(alice.findMatches('Still Header tail')).toHaveLength(1);
  });

  test('moving and resizing the box from its frame replicate while a peer types in it', async () => {
    const { alice, bob, sync, converged, pause, resume } = await pair();
    enterBox(bob, 'Shared');
    enterBox(alice, 'Shared');
    const scope = alice.surface!.activeScope();
    if (scope.kind !== 'frame') throw new Error('not in the box');
    // The frame's own gesture: select the box's shape, then move and resize it.
    expect(alice.surface!.selectDrawing(scope.drawingNodeId, scope.hostParagraphId)).toBe(true);
    pause();
    expect(bob.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
    expect(
      alice.exec({
        type: 'setImagePosition',
        horizontalEmu: 3657600 - 381000,
        verticalEmu: 228600 + 254000,
        relativeToH: 'page',
        relativeToV: 'page',
      }).ok
    ).toBe(true);
    expect(
      alice.exec({ type: 'setImageProperties', widthEmu: 2286000, heightEmu: 685800 }).ok
    ).toBe(true);
    sync();
    resume();
    converged();
    for (const editor of [alice, bob]) {
      const header = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/header1.xml']!);
      expect(header).toContain('<wp:posOffset>3276600</wp:posOffset>');
      expect(header).toContain('<wp:posOffset>482600</wp:posOffset>');
      expect(header).toContain('cx="2286000"');
      expect(inBox(editor, 'Shared typed')).toHaveLength(1);
    }
  });

  test('moving and resizing a legacy box replicate while a peer types in it', async () => {
    const V = 'urn:schemas-microsoft-com:vml';
    const legacy =
      `<w:r><w:pict xmlns:v="${V}"><v:shape type="#_x0000_t202" style="width:144pt;height:48pt;` +
      'margin-top:20pt;margin-left:288pt;mso-position-horizontal-relative:page;' +
      'mso-position-vertical-relative:page;position:absolute;z-index:1" filled="f" stroked="f">' +
      '<v:textbox><w:txbxContent><w:p><w:r><w:t>Shared</w:t></w:r></w:p></w:txbxContent>' +
      '</v:textbox></v:shape></w:pict></w:r>';
    const { alice, bob, sync, converged, pause, resume } = await pair(legacy);
    enterBox(bob, 'Shared');
    enterBox(alice, 'Shared');
    const scope = alice.surface!.activeScope();
    if (scope.kind !== 'frame') throw new Error('not in the box');
    expect(alice.surface!.selectDrawing(scope.drawingNodeId, scope.hostParagraphId)).toBe(true);
    pause();
    expect(bob.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
    expect(alice.exec({ type: 'setImagePosition', horizontalEmu: 254000 * 12 }).ok).toBe(true);
    expect(
      alice.exec({ type: 'setImageProperties', widthEmu: 2286000, heightEmu: 762000 }).ok
    ).toBe(true);
    sync();
    resume();
    converged();
    for (const editor of [alice, bob]) {
      const header = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/header1.xml']!);
      expect(header).toContain(
        'style="width:180pt;height:60pt;margin-top:20pt;margin-left:240pt;' +
          'mso-position-horizontal-relative:page;mso-position-vertical-relative:page;' +
          'position:absolute;z-index:1"'
      );
      expect(inBox(editor, 'Shared typed')).toHaveLength(1);
    }
    // Undo takes the resize back for everyone.
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    converged();
    const header = strFromU8(unzipSync(new Uint8Array(await bob.save()))['word/header1.xml']!);
    expect(header).toContain('width:144pt;height:48pt');
  });
});

test('a header box follows a surviving page after concurrent body deletion', async () => {
  const { alice, bob, containers, peers, sync, converged, pause, resume } = await pair(
    boxRun('Shared'),
    '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
      '<w:p><w:r><w:br w:type="page"/><w:t>Middle</w:t></w:r></w:p>' +
      '<w:p><w:r><w:br w:type="page"/><w:t>Last</w:t></w:r></w:p>'
  );
  expect(alice.surface!.layout().pages).toHaveLength(3);
  expect(alice.surface!.enterHeaderFooter!({ rId: 'rHeader', pageIndex: 2 })).toBe(true);
  enterBox(alice, 'Shared');
  const first = bob.findMatches('Body')[0]!;
  const last = bob.findMatches('Last')[0]!;
  pause();
  expect(alice.exec({ type: 'insertText', text: ' retained' }).ok).toBe(true);
  bob.surface!.setSelection({
    anchor: { paragraphId: first.blockId, offset: first.start + first.length },
    head: { paragraphId: last.blockId, offset: last.start + last.length },
  });
  bob.surface!.deleteBackward();
  sync();
  resume();
  converged();
  expect(alice.surface!.layout().pages).toHaveLength(1);
  const active = () =>
    [
      ...containers[0]!.querySelectorAll('.docx-drawing-textbox[data-docx-textbox-active="true"]'),
    ].map((box) => box.closest<HTMLElement>('[data-page-index]')?.dataset.pageIndex);
  expect(active()).toEqual(['0']);
  expect(inBox(bob, 'Shared retained')).toHaveLength(1);
  relayPresence(peers.alice, peers.bob);
  expect(containers[1]!.querySelectorAll('.docx-remote-caret').length).toBeGreaterThan(0);
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(alice.surface!.layout().pages).toHaveLength(3);
  expect(active()).toEqual(['0']);
  expect(bob.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(alice.surface!.layout().pages).toHaveLength(1);
  expect(active()).toEqual(['0']);
  expect(alice.exec({ type: 'insertText', text: ' again' }).ok).toBe(true);
  converged();
  expect(inBox(bob, 'Shared retained again')).toHaveLength(1);
});
