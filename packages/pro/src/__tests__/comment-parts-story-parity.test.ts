/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A comment authored in any story leaves a package Word can read.
//
// `comments.xml` is related from the MAIN DOCUMENT part; Word resolves it through no other
// relationship. The write minted it on the story part instead, and the helper that mints one
// fails closed when the owner has no `.rels` part — which a header, a footer and a notes part
// normally do not have. So a comment authored in furniture wrote `comments.xml` and its
// content-type override with nothing at all pointing at them.
//
// It showed no local symptom because this engine's reader falls back to the conventional
// `/word/comments.xml`. The two places it did show are asserted here: the relationship itself,
// and the thread walk, which has no such fallback — so a reply read as a root comment and
// outlived the deletion of its own thread as an orphan card.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../review/review-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

const DOCUMENT_RELS = 'word/_rels/document.xml.rels';
const COMMENTS_REL_TYPE = `${R}/comments`;
const EXTENDED_REL_TYPE = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';

const HEADER_R_ID = 'rId10';
const FOOTER_R_ID = 'rId11';
const PROBE = 'Commentable text';

type Story = 'body' | 'header' | 'footer' | 'footnote' | 'endnote';
const STORIES: readonly Story[] = ['body', 'header', 'footer', 'footnote', 'endnote'];

/** One probe paragraph, identical in every story, so the comment has the same range in each. */
const PROBE_PARAGRAPH = `<w:p><w:r><w:t>${PROBE}</w:t></w:r></w:p>`;

function fixture(): Uint8Array {
  const override = (name: string, type: string): string =>
    `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-` +
    `officedocument.wordprocessingml.${type}+xml"/>`;
  const noteSeparators = (kind: 'footnote' | 'endnote'): string =>
    `<w:${kind} w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        override('header1.xml', 'header') +
        override('footer1.xml', 'footer') +
        override('footnotes.xml', 'footnotes') +
        override('endnotes.xml', 'endnotes') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${HEADER_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="${FOOTER_R_ID}" Type="${R}/footer" Target="footer1.xml"/>` +
        `<Relationship Id="rId20" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rId21" Type="${R}/endnotes" Target="endnotes.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${PROBE_PARAGRAPH}</w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${PROBE_PARAGRAPH}</w:ftr>`),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">${noteSeparators('footnote')}` +
        `<w:footnote w:id="1">${PROBE_PARAGRAPH}</w:footnote></w:footnotes>`
    ),
    'word/endnotes.xml': strToU8(
      `<w:endnotes xmlns:w="${W}">${noteSeparators('endnote')}` +
        `<w:endnote w:id="1">${PROBE_PARAGRAPH}</w:endnote></w:endnotes>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${PROBE_PARAGRAPH}` +
        `<w:sectPr><w:headerReference w:type="default" r:id="${HEADER_R_ID}"/>` +
        `<w:footerReference w:type="default" r:id="${FOOTER_R_ID}"/></w:sectPr>` +
        '</w:body></w:document>'
    ),
  });
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

/** Mount, enter `story`, and select the whole probe paragraph so a comment has a range. */
function openStory(story: Story): DocxEditorInstance {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({
    document: fixture(),
    author: 'Parity',
    modules: [reviewModule()],
  });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  const surface = editor.surface;
  if (!surface) throw new Error('no surface');

  if (story === 'header' || story === 'footer') {
    const rId = story === 'header' ? HEADER_R_ID : FOOTER_R_ID;
    if (!surface.enterHeaderFooter({ rId })) throw new Error(`enterHeaderFooter(${rId}) refused`);
  } else if (story === 'footnote' || story === 'endnote') {
    if (!surface.enterNote(`${story}:1`)) throw new Error(`enterNote refused`);
  }

  // A comment is refused on a collapsed caret, so the probe is selected end to end.
  const paragraphId = surface.state().selection.head.paragraphId;
  surface.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: PROBE.length },
  });
  return editor;
}

/** Add a root comment on the selected probe and reply to it. Returns the root's key. */
function commentWithReply(editor: DocxEditorInstance): string {
  const added = editor.addComment('Root');
  if (!added.ok) throw new Error(`addComment refused: ${added.reason}`);
  const key = editor.getReviewItems()[0]?.key;
  if (key === undefined) throw new Error('no review item after addComment');
  const replied = editor.replyToReviewItem(key, 'Reply');
  if (!replied.ok) throw new Error(`reply refused: ${replied.reason}`);
  return key;
}

/** The saved package, as text keyed by zip entry name. */
async function savedParts(editor: DocxEditorInstance): Promise<Map<string, string>> {
  const bytes = await editor.save();
  const entries = unzipSync(new Uint8Array(bytes));
  return new Map(Object.entries(entries).map(([name, data]) => [name, strFromU8(data)]));
}

describe('a comment in any story is reachable from the main document', () => {
  for (const story of STORIES) {
    test(`${story}: the comments relationship lands on the document part`, async () => {
      const editor = openStory(story);
      commentWithReply(editor);

      const rels = (await savedParts(editor)).get(DOCUMENT_RELS) ?? '';
      // Word looks here and nowhere else. Minting on `header1.xml` wrote nothing at all,
      // because that part has no `.rels` and the helper fails closed rather than inventing
      // one — so the parts existed with no path to them.
      expect(rels, 'no comments relationship on the main document').toContain(COMMENTS_REL_TYPE);
      expect(rels, 'no commentsExtended relationship').toContain(EXTENDED_REL_TYPE);
    });

    test(`${story}: deleting a thread takes its reply with it`, () => {
      const editor = openStory(story);
      const rootKey = commentWithReply(editor);
      expect(editor.getReviewItems().length).toBe(2);

      expect(editor.deleteReviewItem(rootKey).ok).toBe(true);
      // The thread walk reaches `commentsExtended.xml` only through a relationship, and it has
      // no conventional-name fallback. Without one the walk saw a lone root, deleted that, and
      // left the reply behind as a card pointing at nothing.
      expect(editor.getReviewItems().length, 'a reply outlived its thread').toBe(0);
    });
  }
});
