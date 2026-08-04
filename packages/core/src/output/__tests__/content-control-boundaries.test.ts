// Content-control boundary seam for paint: records ride on the layout; chrome is not
// permanently painted. This pins that pages carrying `contentControls` still paint, and that
// paint options do not yet expose an on-demand furniture flag (records-only slice).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core-contract/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core-contract/layout';
import { paintSemanticLayout, type PaintOptions } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

describe('content-control boundary paint seam', () => {
  test('pages with boundary records still paint without control furniture', () => {
    const layout = layoutSemanticDocument(
      load(
        `<w:sdt><w:sdtPr><w:alias w:val="Name"/></w:sdtPr>` +
          `<w:sdtContent><w:p><w:r><w:t>Ada</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      ),
      1,
      { measurer: createFixedMeasurer(6, 14) }
    );
    expect(layout.contentControls).toHaveLength(1);
    expect(layout.pages[0]!.contentControls).toHaveLength(1);

    const container = document.createElement('div');
    paintSemanticLayout(container, layout);
    expect(container.querySelectorAll('.docx-page').length).toBe(layout.pages.length);
    // No permanent control chrome in the painted DOM.
    expect(container.querySelector('[data-docx-content-control]')).toBeNull();
  });

  test('PaintOptions has no show-content-controls flag in this slice', () => {
    const options: PaintOptions = { scale: 1, ariaHidden: true };
    expect('showContentControls' in options).toBe(false);
  });
});
