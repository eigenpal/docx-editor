/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt, type BlockFragmentRecord } from '@docx-editor.dev/core/layout';
import { paragraphTextOf, writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';
type MountedEditor = ReturnType<typeof createDocxEditor>;
const harness = createPeerHarness('layout-continuation', { offlineEditing: true });
const editors: MountedEditor[] = [];
afterEach(() => {
  for (const e of editors) e.destroy();
  editors.length = 0;
  harness.cleanup();
});
const p = (text: string, h = 14, extra = '', before = 0) =>
  `<w:p><w:pPr><w:spacing w:before="${before * 20}" w:after="0" w:line="${h * 20}" w:lineRule="exact"/>${extra}</w:pPr>${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;
const sect = (c = 1) =>
  `<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="6000" w:h="4000"/><w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200"/><w:cols w:num="${c}" w:space="200"/></w:sectPr>`;
function cachedPictureDocument() {
  const field = (result: string) =>
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText> INCLUDEPICTURE "https://example.invalid/image.png" </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    result +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const picture =
    '<w:r><w:pict xmlns:v="urn:schemas-microsoft-com:vml"><v:shape type="#_x0000_t75" style="width:48pt;height:36pt"><v:imagedata r:id="image" r:href="externalSource"/></v:shape></w:pict></w:r>';
  const bytes = zipDocument(
    '<w:p>' + field(field(picture)) + '<w:r><w:t>TARGET</w:t></w:r></w:p>' + sect(),
    {
      overrides: '<Default Extension="png" ContentType="image/png"/>',
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/><Relationship Id="externalSource" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/image.png" TargetMode="External"/></Relationships>',
    }
  );
  return zipSync({
    ...unzipSync(bytes),
    'word/media/image.png': Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      ),
      (c) => c.charCodeAt(0)
    ),
  });
}
const fixtures = [
  { name: 'cached field picture', bytes: cachedPictureDocument() },
  {
    name: 'footer frame',
    bytes: zipDocument(
      p('TARGET') +
        '<w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="14000" w:h="16840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:footer="720"/></w:sectPr>',
      {
        overrides:
          '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
        documentRels:
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="footer" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
        extraXml: {
          'word/footer1.xml':
            '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:framePr w:w="3000" w:h="155" w:hRule="exact" w:wrap="around" w:vAnchor="text" w:hAnchor="page" w:x="6000" w:y="-40"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p></w:ftr>',
        },
      }
    ),
  },
  {
    name: 'column continuation',
    bytes: zipDocument(
      Array.from({ length: 14 }, (_, i) => p('B' + i, 30)).join('') +
        p('', 1, sect(2)) +
        p('TARGET', 70) +
        sect()
    ),
  },
  {
    name: 'column spacing',
    bytes: zipDocument(
      p('PREFIX', 50, sect()) + p('LEFT', 110) + p('TARGET', 20, '', 13) + sect(2)
    ),
  },
  {
    name: 'column widow retreat',
    bytes: zipDocument(
      p('PREFIX', 50, sect()) +
        p('LEFT', 110) +
        p('TARGET', 20, '<w:widowControl/>').replace('</w:t>', '</w:t><w:br/><w:t>SECOND</w:t>') +
        sect(2)
    ),
  },
  {
    name: 'empty run beside table',
    bytes: zipDocument(
      p('LEAD') +
        '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="86"/><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="exact"/></w:trPr><w:tc>' +
        p('Cell') +
        '</w:tc></w:tr></w:tbl>' +
        p('').replace('</w:p>', '<w:r/></w:p>') +
        p('TARGET')
    ),
  },
];
function geometry(editor: MountedEditor) {
  const walk = (block: BlockFragmentRecord): unknown => {
    if (block.kind === 'paragraph')
      return {
        kind: block.kind,
        box: block.box,
        clip: block.clipToBox,
        lines: block.lines.map((line) => ({
          box: line.box,
          baseline: line.baseline,
          text: line.spans.map((span) => span.text).join(''),
          drawings: line.drawings?.map((drawing) => ({
            x: drawing.x,
            y: drawing.y,
            width: drawing.width,
            height: drawing.height,
            start: drawing.start,
            resource: drawing.resource.kind,
          })),
        })),
      };
    return {
      kind: block.kind,
      box: block.box,
      rows: block.rows.map((row) => ({
        box: row.box,
        cells: row.cells.map((cell) => ({ box: cell.box, blocks: cell.blocks.map(walk) })),
      })),
    };
  };
  return editor.surface!.layout().pages.map((page) => ({
    box: page.contentBox,
    fragments: page.fragments.map(walk),
    footer: page.footer && { box: page.footer.box, fragments: page.footer.fragments.map(walk) },
  }));
}
test.each(fixtures)(
  '$name synchronizes edits, history, caret, reconnect, and save/reopen',
  async ({ name, bytes }) => {
    const peers = await harness.pair(bytes);
    const mounted = [peers.alice, peers.bob].map((peer) => {
      peer.detach();
      const e = createDocxEditor({
        container: document.createElement('div'),
        document: peer.room.document,
        modules: [collaborationModule({ session: peer.room.session })],
      });
      editors.push(e);
      return e;
    });
    const a = mounted[0]!,
      b = mounted[1]!;
    const sync = () => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
    };
    const check = () => {
      sync();
      expect(packageFingerprint(a.surface!.session.currentPackage())).toBe(
        packageFingerprint(b.surface!.session.currentPackage())
      );
      expect(geometry(a)).toEqual(geometry(b));
    };
    const select = (e: MountedEditor, offset = 0) => {
      const ids = e.surface!.session.paragraphIds();
      const id = ids.at(name === 'empty run beside table' ? -2 : -1)!;
      e.surface!.setSelection({
        anchor: { paragraphId: id, offset },
        head: { paragraphId: id, offset },
      });
      return id;
    };
    check();
    const pictureCount = (e: MountedEditor) =>
      e
        .surface!.layout()
        .pages.reduce(
          (n, page) =>
            n +
            page.fragments.reduce(
              (m, f) =>
                m +
                (f.kind === 'paragraph'
                  ? f.lines.reduce((k, l) => k + (l.drawings?.length ?? 0), 0)
                  : 0),
              0
            ),
          0
        );
    if (name === 'cached field picture') expect(pictureCount(a)).toBe(1);
    if (name === 'footer frame') {
      const page = a.surface!.layout().pages[0]!;
      const frame = page.footer!.fragments[0]!;
      expect(frame.kind).toBe('paragraph');
      if (frame.kind === 'paragraph') expect(frame.clipToBox).toBe(true);
      expect(frame.box.x + page.contentBox.x).toBeCloseTo(300, 6);
    }
    if (name === 'empty run beside table') {
      const paragraphs = a
        .surface!.layout()
        .pages[0]!.fragments.filter((block) => block.kind === 'paragraph');
      const table = a
        .surface!.layout()
        .pages[0]!.fragments.find((block) => block.kind === 'table')!;
      expect(paragraphs[1]!.box.y).toBeCloseTo(table.box.y + table.box.height, 6);
      expect(paragraphs[2]!.box.y).toBeCloseTo(paragraphs[1]!.box.y + paragraphs[1]!.box.height, 6);
    }
    if (name === 'column spacing' || name === 'column widow retreat') {
      const blocks = a.surface!.layout().pages[0]!.fragments;
      const target = blocks.find(
        (block) =>
          block.kind === 'paragraph' &&
          block.lines.some((line) => line.spans.some((span) => span.text === 'TARGET'))
      );
      expect(target?.kind).toBe('paragraph');
      if (target?.kind === 'paragraph') {
        expect(target.spacing.before).toBe(name === 'column spacing' ? 13 : 0);
        expect(target.lines[0]!.box.y).toBeCloseTo(name === 'column spacing' ? 63 : 50, 6);
        expect(target.box.x).toBeGreaterThan(0);
      }
    }
    if (name === 'column continuation') {
      const pages = a.surface!.layout().pages;
      expect(pages).toHaveLength(2);
      const blocks = pages.at(-1)!.fragments;
      const target = blocks.find(
        (block) =>
          block.kind === 'paragraph' &&
          block.lines.some((line) => line.spans.some((span) => span.text === 'TARGET'))
      )!;
      expect(target).toBeDefined();
      for (const block of blocks) {
        if (block.kind === 'paragraph' && !block.outOfFlow && block !== target)
          expect(block.box.y + block.box.height).toBeLessThanOrEqual(target.box.y + 1e-6);
      }
    }
    const aid = select(a),
      bid = select(b);
    peers.pause();
    a.surface!.type('Alice');
    b.surface!.type('Bob');
    sync();
    peers.resume();
    check();
    expect(a.findMatches('Alice')).toHaveLength(1);
    expect(a.findMatches('Bob')).toHaveLength(1);
    expect(a.exec({ type: 'undo' }).ok).toBe(true);
    check();
    expect(a.exec({ type: 'redo' }).ok).toBe(true);
    check();
    select(a, 1);
    select(b, 0);
    peers.pause();
    a.surface!.deleteBackward();
    b.surface!.type('Concurrent');
    sync();
    peers.resume();
    check();
    applyAwarenessUpdate(
      peers.bob.awareness,
      encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
      'layout-test'
    );
    const remote = peers.bob.room.session.remoteSelections()[0];
    expect(remote).toBeDefined();
    const ac = caretAt(a.surface!.layout(), { paragraphId: aid, offset: remote!.head.offset });
    const bc = caretAt(b.surface!.layout(), { paragraphId: bid, offset: remote!.head.offset });
    expect(ac).not.toBeNull();
    expect(bc).toEqual(ac);
    const late = await harness.join(peers.alice, 'late');
    expect(saveReopenDigest(late.store.currentPackage())).toEqual(
      saveReopenDigest(a.surface!.session.currentPackage())
    );
    if (name === 'cached field picture') {
      const part = a.surface!.session.currentPackage().parts.get('/word/document.xml')!;
      const text = paragraphTextOf(part, aid);
      if (text === null) throw new Error('Missing picture paragraph');
      const offset = text.indexOf('\uFFFC');
      expect(offset).toBeGreaterThanOrEqual(0);
      peers.pause();
      select(a, offset + 1);
      a.surface!.deleteBackward();
      select(b, offset + 1);
      b.surface!.type('After');
      sync();
      peers.resume();
      check();
      expect(pictureCount(a)).toBe(0);
      expect(a.exec({ type: 'undo' }).ok).toBe(true);
      check();
      expect(pictureCount(a)).toBe(1);
    }
    const cold = createDocxEditor({
      container: document.createElement('div'),
      document: writeOoxmlPackage(a.surface!.session.currentPackage()),
    });
    editors.push(cold);
    expect(geometry(cold)).toEqual(geometry(a));
  }
);
