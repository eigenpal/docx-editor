// WHAT RESOLVING A REVISION LEAVES BEHIND.
//
// Accept and Reject are one click that rewrites the document under the reader's caret, and
// two things have to survive it: the caret has to still mean the characters it meant, and the
// markup left behind has to be markup the rest of the engine accepts.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  revisionItemsOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const ins = (id: number, author = 'Ada') =>
  `<w:p><w:ins w:id="${id}" w:author="${author}"><w:r><w:t>Added${id}</w:t></w:r></w:ins></w:p>`;

function docxOf(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** The engine's own review derivation, wired as a module (core may not import pro). */
function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems: engineCollectReviewItems,
      revisionItemsOfParagraph: (part, paragraphId) => {
        const paragraph = findNode(part, paragraphId);
        if (!paragraph || paragraph.kind !== 'paragraph') return [];
        return revisionItemsOf({
          id: part.id,
          name: part.name,
          contentType: part.contentType,
          root: paragraph,
        });
      },
    },
  };
}

function mountEditor(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docxOf(body),
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

describe('shared Review menu commands', () => {
  for (const action of ['acceptReviewItem', 'rejectReviewItem'] as const) {
    test(`${action} on a replacement preserves formatting with the same revision address`, () => {
      const editor = mountEditor(
        '<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="Ada"><w:rPr/></w:rPrChange></w:rPr><w:t>Base</w:t></w:r><w:del w:id="1" w:author="Ada"><w:r><w:delText>Old</w:delText></w:r></w:del><w:ins w:id="2" w:author="Ada"><w:r><w:t>New</w:t></w:r></w:ins></w:p>'
      );
      const replacement = editor
        .getReviewItems()
        .find((item) => item.kind === 'revision' && item.revisionKind === 'replace');
      expect(replacement).toBeDefined();
      expect(editor[action](replacement!.key).ok).toBe(true);
      const remaining = editor.getReviewItems();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.kind === 'revision' && remaining[0]!.revisionKind).toBe('format');
      expect(editor.surface!.session.bodyText()).toBe(
        action === 'acceptReviewItem' ? 'BaseNew' : 'BaseOld'
      );
      editor.destroy();
    });
  }
  test('navigation starts from the caret when no change is active', () => {
    const editor = mountEditor(ins(1) + '<w:p><w:r><w:t>Unchanged</w:t></w:r></w:p>' + ins(2));
    const items = editor.getReviewItems();
    const paragraphId = editor.surface!.session.paragraphIds()[1]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 4 },
      head: { paragraphId, offset: 4 },
    });
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    expect(editor.getReviewItems().find((item) => item.isActive)?.key).toBe(items[1]!.key);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 4 },
      head: { paragraphId, offset: 4 },
    });
    editor.exec({ type: 'navigateReviewChange', direction: 'previous' });
    expect(editor.getReviewItems().find((item) => item.isActive)?.key).toBe(items[0]!.key);
    editor.destroy();
  });

  test('bulk resolution keeps review comments', () => {
    const editor = mountEditor(ins(1));
    expect(
      editor.replyToReviewItem(editor.getReviewItems()[0]!.key, 'Keep this discussion').ok
    ).toBe(true);
    expect(editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(true);
    const items = editor.surface!.session.reviewItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('comment');
    editor.destroy();
  });
  for (const action of ['accept', 'reject'] as const) {
    test(`bulk ${action} resolves body, header, and footnote changes in one undo`, async () => {
      const relationshipNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      const files = unzipSync(
        docxOf(
          ins(1) +
            `<w:p><w:r><w:footnoteReference w:id="2"/></w:r></w:p><w:sectPr><w:headerReference xmlns:r="${relationshipNs}" w:type="default" r:id="header"/></w:sectPr>`
        )
      );
      files['[Content_Types].xml'] = strToU8(
        strFromU8(files['[Content_Types].xml']!).replace(
          '</Types>',
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
        )
      );
      files['word/_rels/document.xml.rels'] = strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="header" Type="${relationshipNs}/header" Target="header1.xml"/><Relationship Id="notes" Type="${relationshipNs}/footnotes" Target="footnotes.xml"/></Relationships>`
      );
      files['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}">${ins(2, 'Grace')}</w:hdr>`);
      files['word/footnotes.xml'] = strToU8(
        `<w:footnotes xmlns:w="${W}"><w:footnote w:id="2">${ins(3)}</w:footnote></w:footnotes>`
      );
      const editor = createDocxEditor({
        container: document.createElement('div'),
        document: zipSync(files),
        modules: [reviewModule()],
      });
      // Opening a story initializes its stable paragraph IDs before the undo baseline.
      editor.surface!.session.partFor({ kind: 'headerFooter', rId: 'header' });
      const before = editor.surface!.session.storyParts().map(serializeOoxmlPart);
      expect(editor.surface!.session.reviewItems()).toHaveLength(3);
      expect(editor.exec({ type: 'resolveAllReviewChanges', action })).toEqual({
        ok: true,
        changed: true,
      });
      expect(editor.surface!.session.reviewItems()).toHaveLength(0);
      editor.exec({ type: 'undo' });
      expect(editor.surface!.session.storyParts().map(serializeOoxmlPart)).toEqual(before);
      expect(editor.surface!.session.reviewItems()).toHaveLength(3);
      editor.destroy();
    });
  }
  test('navigation wraps visible revisions and honors activation exclusions', () => {
    const editor = mountEditor(ins(1) + ins(2, 'Grace') + ins(3));
    const keys = editor.getReviewItems().map((item) => item.key);
    editor.setActiveReviewItem(keys[0]!);
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(true);
    expect(editor.getReviewItems().find((item) => item.isActive)?.key).toBe(keys[1]);
    editor.setReviewAuthorVisible('Grace', false);
    editor.setActiveReviewItem(keys[0]!);
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    expect(editor.getReviewItems().find((item) => item.isActive)?.key).toBe(keys[2]);
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    expect(editor.getReviewItems().find((item) => item.isActive)?.key).toBe(keys[0]);
    editor.exec({ type: 'navigateReviewChange', direction: 'previous' });
    expect(editor.getReviewItems().find((item) => item.isActive)?.key).toBe(keys[2]);
    editor.setReviewActivationExclusions(['insert']);
    expect(editor.can({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(false);
    editor.destroy();
  });

  test('accepting a card preserves the caret; Next Change continues review', () => {
    const editor = mountEditor(ins(1) + ins(2));
    const items = editor.getReviewItems();
    editor.setActiveReviewItem(items[0]!.key);
    const before = editor.surface!.state().selection;
    expect(editor.acceptReviewItem(items[0]!.key).ok).toBe(true);
    expect(editor.surface!.state().selection).toEqual(before);
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    expect(editor.getReviewItems().find((item) => item.isActive)?.key).toBe(items[1]!.key);
    editor.destroy();
  });

  for (const action of ['accept', 'reject'] as const) {
    test(`bulk ${action} includes hidden authors and has one undo`, async () => {
      const editor = mountEditor(ins(1) + ins(2, 'Grace'));
      const before = await editor.save();
      editor.setReviewAuthorVisible('Grace', false);
      expect(editor.exec({ type: 'resolveAllReviewChanges', action })).toEqual({
        ok: true,
        changed: true,
      });
      expect(editor.surface!.session.reviewItems()).toHaveLength(0);
      expect(editor.surface!.session.bodyText()).toBe(
        action === 'accept' ? 'Added1\nAdded2' : '\n'
      );
      editor.exec({ type: 'undo' });
      expect(await editor.save()).toEqual(before);
      expect(editor.surface!.session.reviewItems()).toHaveLength(2);
      editor.destroy();
    });
  }

  test('bulk resolution refuses unsupported changes atomically', async () => {
    const editor = mountEditor(
      ins(1) +
        '<w:tbl><w:tblPr><w:ins w:id="2" w:author="Ada"/></w:tblPr><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>'
    );
    const before = await editor.save();
    expect(editor.can({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(false);
    expect(editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(false);
    expect(await editor.save()).toEqual(before);
    editor.destroy();
  });

  test('navigation and display work in viewing mode; bulk changes do not', async () => {
    const editor = mountEditor(ins(1));
    const before = await editor.save();
    const key = editor.getReviewItems()[0]!.key;
    editor.setEditingMode('viewing');
    expect(editor.acceptReviewItem(key).ok).toBe(false);
    expect(editor.rejectReviewItem(key).ok).toBe(false);
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(true);
    expect(editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(false);
    for (const mode of ['original', 'proposed', 'all-markup'] as const) {
      expect(editor.exec({ type: 'setReviewDisplayMode', mode })).toEqual({
        ok: true,
        changed: false,
      });
      expect(editor.snapshot().reviewDisplayMode).toBe(mode);
      expect(editor.isActive({ type: 'setReviewDisplayMode', mode })).toBe(true);
      expect(await editor.save()).toEqual(before);
      expect(editor.surface!.session.canUndo()).toBe(false);
    }
    editor.destroy();
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(false);
    expect(editor.exec({ type: 'setReviewDisplayMode', mode: 'original' }).ok).toBe(false);
  });
});
