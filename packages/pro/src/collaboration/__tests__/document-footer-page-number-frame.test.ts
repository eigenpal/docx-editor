/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A footer page number in a right-aligned frame that wraps nothing sits beside the footer's
// text line. When one peer types in the frame while the other edits or deletes that text, both
// replicas keep the frame beside the text, and so do undo, redo, and a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import type { ParagraphFragmentRecord } from '@docx-editor.dev/core/layout';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('footer-page-number-frame-room', { offlineEditing: true });
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
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const frame = (wrap: string) =>
  `<w:framePr w:wrap="${wrap}" w:vAnchor="text" w:hAnchor="margin" w:xAlign="right" w:y="1"/>`;
const PAGE =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const footer = (wrap: string) =>
  `<w:ftr xmlns:w="${W}"><w:p><w:pPr>${frame(wrap)}</w:pPr>${PAGE}</w:p>` +
  '<w:p><w:r><w:t>Version 9</w:t></w:r></w:p></w:ftr>';

function footerOf(editor: Editor): readonly ParagraphFragmentRecord[] {
  const fragments = editor.surface!.layout().pages[0]!.footer?.fragments ?? [];
  return fragments.filter(
    (fragment): fragment is ParagraphFragmentRecord => fragment.kind === 'paragraph'
  );
}

/** Each footer paragraph's text, `^` when it floats, and the floating frame's right edge. */
function summary(editor: Editor): string {
  return footerOf(editor)
    .map((paragraph) => {
      const text = paragraph.lines.map((line) => line.spans.map((s) => s.text).join('')).join('');
      if (!paragraph.outOfFlow) return `${text}@${paragraph.box.y.toFixed(1)}`;
      return `^${text}>${(paragraph.box.x + paragraph.box.width).toFixed(1)}`;
    })
    .join(' | ');
}

function coldSummary(editor: Editor): string {
  const cold = createDocxEditor({
    container: document.createElement('div'),
    document: editor.surface!.session.save(),
  });
  try {
    return summary(cold);
  } finally {
    cold.destroy();
  }
}

async function pair(wrap: string) {
  const peers = await harness.pair(
    zipDocument(
      '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
        '<w:sectPr><w:footerReference w:type="default" r:id="rFooter"/>' +
        '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" ' +
        'w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
      {
        overrides: `<Override PartName="/word/footer1.xml" ContentType="${WML}.footer+xml"/>`,
        documentRels:
          `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rFooter" Type="${R}/footer" Target="footer1.xml"/></Relationships>`,
        extraXml: { 'word/footer1.xml': footer(wrap) },
      }
    )
  );
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const converged = (): string => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    expect(summary(bob)).toBe(summary(alice));
    for (const editor of [alice, bob]) expect(summary(editor)).toBe(coldSummary(editor));
    return summary(alice);
  };
  return { alice, bob, converged, pause: peers.pause, resume: peers.resume };
}

/** Put the caret in the footer paragraph at `index`, at `offset`, or at its end. */
function caretIn(editor: Editor, index: number, offset?: number): string {
  expect(editor.surface!.setActiveScope({ kind: 'headerFooter', rId: 'rFooter' })).toBe(true);
  const paragraph = footerOf(editor)[index]!;
  const end = paragraph.lines.map((line) => line.spans.map((s) => s.text).join('')).join('');
  const at = { paragraphId: paragraph.paragraphId, offset: offset ?? end.length };
  editor.surface!.setSelection({ anchor: at, head: at });
  return paragraph.paragraphId;
}

// A page number that wraps text floats the same way as one that wraps nothing.
for (const wrap of ['none', 'around']) {
  test(`typing in the page-number frame while a peer edits the footer text converges: ${wrap}`, async () => {
    const { alice, bob, converged, pause, resume } = await pair(wrap);
    const opened = converged();
    expect(opened).toBe('^1>468.0 | Version 9@0.0');

    pause();
    caretIn(alice, 0, 0);
    alice.surface!.type('p. ');
    caretIn(bob, 1);
    bob.surface!.type(' draft');
    resume();
    const typed = converged();
    expect(typed).toBe('^p. 1>468.0 | Version 9 draft@0.0');

    alice.surface!.undo();
    expect(converged()).toBe('^1>468.0 | Version 9 draft@0.0');
    alice.surface!.redo();
    expect(converged()).toBe(typed);
  });

  test(`deleting the footer text while a peer types in the frame keeps the frame afloat: ${wrap}`, async () => {
    const { alice, bob, converged, pause, resume } = await pair(wrap);
    pause();
    const anchor = caretIn(bob, 1);
    bob.surface!.setSelection({
      anchor: { paragraphId: anchor, offset: 0 },
      head: { paragraphId: anchor, offset: 'Version 9'.length },
    });
    bob.surface!.deleteSelection();
    caretIn(alice, 0, 0);
    alice.surface!.type('p. ');
    resume();
    const deleted = converged();
    expect(deleted).toBe('^p. 1>468.0 | @0.0');

    bob.surface!.undo();
    expect(converged()).toBe('^p. 1>468.0 | Version 9@0.0');
    bob.surface!.redo();
    expect(converged()).toBe(deleted);
  });
}
