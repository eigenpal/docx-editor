/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A heading that opens with a page break is listed on the page of its text, for every peer.
//
// One peer types the break, the other writes the table of contents. Both must agree on the
// page number, keep it through concurrent edits, undo, reconnect, and save and reopen.

import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const heading = (value: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${value}</w:t></w:r></w:p>`;

const bytes = () =>
  zipDocument(
    '<w:p><w:r><w:t>Contents go here</w:t></w:r></w:p>' +
      heading('First heading') +
      heading('Second heading') +
      '<w:sectPr/>',
    {
      overrides:
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId9" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`,
      extraXml: {
        'word/styles.xml':
          `<w:styles xmlns:w="${W}">` +
          '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
          '<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
          '</w:styles>',
      },
    }
  );

type Editor = ReturnType<typeof createDocxEditor>;

/** The page number each TOC row shows, keyed by heading text, read from the saved XML. */
async function tocPages(editor: Editor): Promise<Record<string, string>> {
  const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  const rows = xml.split('</w:p>').filter((row) => row.includes('w:anchor="_Toc'));
  const pages: Record<string, string> = {};
  for (const row of rows) {
    const texts = [...row.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]!);
    pages[texts.slice(0, -1).join('')] = texts.at(-1)!;
  }
  return pages;
}

test('peers list a heading that opens with a page break on the page of its text', async () => {
  const harness = createPeerHarness('toc-leading-page-break', { offlineEditing: true });
  const peers = await harness.pair(bytes());
  const editors = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  });
  const [alice, bob] = editors as [Editor, Editor];
  const surface = (editor: Editor) => editor.surface!;
  const converge = async () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(surface(alice).session.currentPackage())).toBe(
      packageFingerprint(surface(bob).session.currentPackage())
    );
    expect(saveReopenDigest(surface(alice).session.currentPackage())).toEqual(
      saveReopenDigest(surface(bob).session.currentPackage())
    );
  };
  const caretAtStart = (editor: Editor, paragraphId: string) =>
    surface(editor).setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
  // The second heading is the last paragraph, before and after the TOC is inserted.
  const secondHeading = () => surface(alice).session.paragraphIds().at(-1)!;
  try {
    // Alice presses Ctrl+Enter before the text of the second heading.
    caretAtStart(alice, secondHeading());
    expect(alice.exec({ type: 'insertBreak', kind: 'page' }).ok).toBe(true);
    await converge();

    // Bob inserts the table of contents. Both peers see the heading on page 2.
    caretAtStart(bob, surface(bob).session.paragraphIds()[0]!);
    expect(bob.exec({ type: 'insertToc' }).ok).toBe(true);
    await converge();
    const expected = { 'First heading': '1', 'Second heading': '2' };
    expect(await tocPages(bob)).toEqual(expected);
    expect(await tocPages(alice)).toEqual(expected);
    // Alice computes the same page numbers from her own layout, so her refresh writes nothing.
    expect(alice.exec({ type: 'refreshToc', mode: 'pageNumbers' })).toEqual({
      ok: true,
      changed: false,
    });

    // Offline, Alice removes the break while Bob types in the same heading.
    peers.pause();
    const breakParagraph = secondHeading();
    surface(alice).setSelection({
      anchor: { paragraphId: breakParagraph, offset: 0 },
      head: { paragraphId: breakParagraph, offset: 1 },
    });
    surface(alice).deleteBackward();
    const bobHeading = surface(bob).session.paragraphIds().at(-1)!;
    surface(bob).setSelection({
      anchor: { paragraphId: bobHeading, offset: 15 },
      head: { paragraphId: bobHeading, offset: 15 },
    });
    surface(bob).type(' now');
    peers.resume();
    await converge();
    // Both offline edits survive: Bob's text is there and Alice's break is gone.
    expect(alice.findMatches('Second heading now')).toHaveLength(1);
    const savedXml = strFromU8(unzipSync(new Uint8Array(await bob.save()))['word/document.xml']!);
    expect(savedXml).not.toContain('w:type="page"');

    // After reconnect, a refresh on either peer moves the entry back to page 1.
    expect(bob.exec({ type: 'refreshToc', mode: 'pageNumbers' })).toMatchObject({ ok: true });
    await converge();
    expect(await tocPages(alice)).toEqual({ 'First heading': '1', 'Second heading': '1' });

    // Undo of that refresh restores page 2 on both peers.
    expect(bob.exec({ type: 'undo' }).ok).toBe(true);
    await converge();
    expect(await tocPages(alice)).toEqual(expected);

    // Save and reopen keeps the value, and a refresh there agrees with it.
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: new Uint8Array(await alice.save()),
    });
    try {
      expect(await tocPages(reopened)).toEqual(expected);
    } finally {
      reopened.destroy();
    }
  } finally {
    editors.forEach((editor) => editor.destroy());
    harness.cleanup();
  }
});
