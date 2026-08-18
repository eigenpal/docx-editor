// Editing a document whose paragraphs a resolved view has merged.
//
// `proposed` is not a preview: it is what the free engine renders by default, and that surface
// is fully editable. So the merged half has to keep addressing its own paragraph — an edit
// there must land where the DOCUMENT holds those characters, not where the page draws them.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { paragraphTextOf } from '../../store/store/tree-op-apply.ts';
import { docx } from './paginated-surface-fixtures.ts';

const DELETED_MARK =
  '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
  '<w:r><w:t xml:space="preserve">Hello </w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>world</w:t></w:r></w:p>';

function mountMerged() {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(DELETED_MARK), {
    revisionDisplayMode: 'proposed',
  });
  if (!opened.ok) throw new Error(opened.reason);
  return {
    surface: opened.surface,
    dispose: () => {
      opened.surface.destroy();
      container.remove();
    },
  };
}

describe('editing across a merged paragraph break', () => {
  test('the two paragraphs are drawn as one and remain two', () => {
    const { surface, dispose } = mountMerged();
    try {
      // One line on the page, two paragraphs in the document. Both halves of that sentence
      // matter: the first is the merge, the second is what makes it safe.
      const lines = surface
        .layout()
        .pages.flatMap((page) =>
          page.fragments.flatMap((fragment) =>
            fragment.kind === 'paragraph' ? fragment.lines : []
          )
        );
      expect(lines).toHaveLength(1);
      expect(lines[0]!.spans.map((span) => span.text).join('')).toBe('Hello world');
      expect(surface.session.paragraphIds()).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  test('typing at the join lands in the paragraph that holds the caret', () => {
    const { surface, dispose } = mountMerged();
    try {
      const [first, second] = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: first!, offset: 6 },
        head: { paragraphId: first!, offset: 6 },
      });
      surface.type('!');
      expect(paragraphTextOf(surface.session.part(), first!)).toBe('Hello !');
      expect(paragraphTextOf(surface.session.part(), second!)).toBe('world');
    } finally {
      dispose();
    }
  });

  test('typing at the start of the second half stays in the second paragraph', () => {
    const { surface, dispose } = mountMerged();
    try {
      const [first, second] = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: second!, offset: 0 },
        head: { paragraphId: second!, offset: 0 },
      });
      surface.type('W');
      expect(paragraphTextOf(surface.session.part(), first!)).toBe('Hello ');
      expect(paragraphTextOf(surface.session.part(), second!)).toBe('Wworld');
    } finally {
      dispose();
    }
  });
});
