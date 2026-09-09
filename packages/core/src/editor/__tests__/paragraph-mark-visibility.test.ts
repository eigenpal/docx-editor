import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { EditorModule } from '../../contracts/modules.ts';
import { collectReviewItems } from '../../store/index.ts';
import { createDocxEditor } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph: () => [],
    },
  };
}

describe('tracked paragraph-mark visibility', () => {
  test('reveals every mark in a grouped decision only while its card is active', () => {
    const mark =
      '<w:pPr><w:rPr><w:ins w:id="7" w:author="Ada" w:date="2026-09-09T08:00:00Z"/></w:rPr></w:pPr>';
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docx(
        `<w:p>${mark}<w:r><w:t>one</w:t></w:r></w:p>` +
          `<w:p>${mark}<w:r><w:t>two</w:t></w:r></w:p>` +
          '<w:p><w:r><w:t>three</w:t></w:r></w:p>'
      ),
      modules: [reviewModule()],
    });
    const card = editor
      .getReviewItems()
      .find((entry) => entry.kind === 'revision' && entry.revisionKind === 'paragraphMark');
    expect(card).toBeDefined();
    expect(card!.item.ranges).toHaveLength(2);

    const glyphs = container.querySelectorAll('.docx-revision-pmark');
    expect(glyphs).toHaveLength(2);
    expect(container.querySelectorAll('.docx-revision-pmark--active')).toHaveLength(0);

    expect(editor.setActiveReviewItem(card!.key).ok).toBe(true);
    expect(container.querySelectorAll('.docx-revision-pmark--active')).toHaveLength(2);

    expect(editor.setActiveReviewItem(null).ok).toBe(true);
    expect(container.querySelectorAll('.docx-revision-pmark--active')).toHaveLength(0);
    editor.destroy();
  });
});
