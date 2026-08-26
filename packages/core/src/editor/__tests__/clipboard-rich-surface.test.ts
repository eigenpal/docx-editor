// The rich clipboard, end to end on the painted surface (rich-clipboard-fidelity 3.3/4.2).
//
// Copy assembles both flavours from the live selection; paste routes the embedded
// fragment through the bounded package read, the resource merge, and one atomic
// `insertFragment` commit — and undo takes the whole landing back. Suggesting mode and
// force-plain land on the tracked/plain lanes instead.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test, afterEach } from 'bun:test';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { docx, mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

const RICH_BODY =
  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
  '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>plain</w:t></w:r></w:p>';

function copyRichFlavours(): { text: string; html: string | null } {
  const source = mount(RICH_BODY);
  putCaret(source.surface, 0);
  source.surface.selectAll();
  return source.surface.copyFlavours();
}

describe('rich copy', () => {
  test('copyFlavours writes plain text plus interop HTML carrying the fragment', () => {
    const flavours = copyRichFlavours();
    expect(flavours.text).toBe('bold\nplain');
    expect(flavours.html).not.toBeNull();
    expect(flavours.html!).toContain('data-docx-fragment="');
    expect(flavours.html!).toContain('data-docx-fragment-end="covered"');
    // The visible half keeps the resolved formatting for external receivers.
    expect(flavours.html!).toContain('font-weight');
    expect(flavours.html!).toContain('text-align');
  });

  test('a collapsed selection has nothing to copy', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 2);
    expect(surface.copyFlavours()).toEqual({ text: '', html: null });
  });
});

describe('rich paste', () => {
  test('the embedded fragment lands structure and formatting, one undo unit', () => {
    const flavours = copyRichFlavours();
    const target = mount(paragraph(''));
    putCaret(target.surface, 0);
    target.surface.pasteRich(flavours.text, flavours.html);

    expect(target.surface.session.bodyText()).toContain('bold');
    expect(target.surface.session.bodyText()).toContain('plain');
    const markup = serializeOoxmlPart(target.surface.session.part());
    expect(markup).toContain('w:jc w:val="center"');
    expect(markup).toContain('<w:b/>');

    target.surface.undo();
    expect(target.surface.session.bodyText()).not.toContain('bold');
    const reverted = serializeOoxmlPart(target.surface.session.part());
    expect(reverted.includes('center')).toBe(false);
  });

  test('suggesting mode degrades the rich payload to the tracked plain lane', () => {
    const flavours = copyRichFlavours();
    const container = document.createElement('div');
    const mounted = mountPaginatedSurface(container, docx(paragraph('')), {
      scale: 1,
      author: 'Reviewer',
      editingMode: 'suggest',
    });
    if (!mounted.ok) throw new Error(mounted.reason);
    const surface = mounted.surface;
    putCaret(surface, 0);
    surface.pasteRich(flavours.text, flavours.html);

    const markup = serializeOoxmlPart(surface.session.part());
    expect(surface.session.bodyText()).toContain('bold');
    // Plain lane: the text arrives tracked, the structure does not travel.
    expect(markup).toContain('w:ins');
    expect(markup.includes('w:jc w:val="center"')).toBe(false);
  });

  test('an armed force-plain paste skips the rich lanes once', () => {
    const flavours = copyRichFlavours();
    const target = mount(paragraph(''));
    putCaret(target.surface, 0);
    target.surface.armForcePlainPaste();
    target.surface.pasteRich(flavours.text, flavours.html);

    const markup = serializeOoxmlPart(target.surface.session.part());
    expect(target.surface.session.bodyText()).toContain('bold');
    expect(markup.includes('w:jc w:val="center"')).toBe(false);

    // The flag is consumed: the NEXT paste routes rich again.
    target.surface.selectAll();
    target.surface.pasteRich(flavours.text, flavours.html);
    expect(serializeOoxmlPart(target.surface.session.part())).toContain('w:jc w:val="center"');
  });

  test('external HTML without a fragment projects through the bounded parse', () => {
    const target = mount(paragraph(''));
    putCaret(target.surface, 0);
    // TWO paragraphs: the last one merges into the host and takes the HOST's mark (the
    // documented rule), so the paragraph formatting under test rides the first.
    target.surface.pasteRich(
      'fallback',
      '<p style="text-align:right"><b>ext</b>bold</p><p>tail</p>'
    );
    const markup = serializeOoxmlPart(target.surface.session.part());
    expect(target.surface.session.bodyText()).toContain('ext');
    expect(markup).toContain('w:jc');
    expect(markup).toContain('<w:b/>');
  });
});
