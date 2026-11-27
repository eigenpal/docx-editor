// Automatic text (17.3.2.6 color, CT_Color) on cell backgrounds: `w:shd` (17.4.32) and the
// revision colour that paints over it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import {
  REVISION_MARKUP_COLORS,
  resolveRevisionMarkup,
  type RevisionMarkupOptions,
} from '../../contracts/revision-markup.ts';
import type { RevisionStyles } from '../revision-presentation.ts';
import { automaticTextCss, REVISION_MARKUP_COLOR_HEX } from '../semantic-paint-automatic-text.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function paintedCell(
  shading: string | null,
  options: RevisionMarkupOptions,
  revisionStyles?: RevisionStyles,
  paragraphShading?: string
): HTMLElement {
  const shd = shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${shading}"/>` : '';
  const pShd = paragraphShading
    ? `<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="${paragraphShading}"/></w:pPr>`
    : '';
  const body =
    '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr>' +
    `<w:cellIns w:id="1" w:author="Reviewer"/>${shd}</w:tcPr>` +
    `<w:p>${pShd}<w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const revisionMarkup = resolveRevisionMarkup(options);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    displayMode: 'all-markup',
    measurer: createFixedMeasurer(6, 14),
    revisionAuthorFilter: {
      hiddenAuthors: new Set(),
      resolvedMarkup: 'plain',
      cacheKey: JSON.stringify(revisionMarkup),
      revisionMarkup,
    },
  });
  const root = document.createElement('div');
  paintSemanticLayout(root, layout, { scale: 1, revisionMarkup, revisionStyles });
  const cell = root.querySelector<HTMLElement>('[data-revision-cell]');
  expect(cell).not.toBeNull();
  return cell!;
}

// The colour the cell's text inherits: the nearest inline colour, or the page's black.
function textColorOf(element: HTMLElement): string {
  for (let at: HTMLElement | null = element; at; at = at.parentElement) {
    if (at.style.color) return at.style.color.toUpperCase();
  }
  return '#000000';
}

test('automatic text is white on a dark background and black on a light one or none', () => {
  expect(automaticTextCss('3B3B3B')).toBe('#FFFFFF');
  expect(automaticTextCss('3C3C3C')).toBe('#000000');
  expect(automaticTextCss(null)).toBe('#000000');
  expect(automaticTextCss('not-hex')).toBe('#000000');
});

test('each named revision colour has the hex of its stylesheet token', () => {
  const css = readFileSync(new URL('../../styles/editor.css', import.meta.url), 'utf8');
  for (const name of REVISION_MARKUP_COLORS) {
    const token = new RegExp(`--doc-revision-color-${name}:\\s*#([0-9a-fA-F]{6});`).exec(css);
    expect(token?.[1]?.toUpperCase()).toBe(REVISION_MARKUP_COLOR_HEX[name]);
  }
});

test('a dark revision colour over light shading paints automatic text white', () => {
  const cell = paintedCell('FFFFFF', { cells: { inserted: 'darkBlue' } });
  expect(cell.style.backgroundColor).toBe('var(--doc-revision-color-darkBlue)');
  expect(textColorOf(cell)).toBe('#FFFFFF');
});

test('a light revision colour over dark shading paints automatic text black', () => {
  const cell = paintedCell('000080', { cells: { inserted: 'lightBlue' } });
  expect(textColorOf(cell)).toBe('#000000');
});

test('no revision colour leaves the shading to choose the automatic text colour', () => {
  const cell = paintedCell('000080', { cells: { inserted: 'none' } });
  expect(cell.style.backgroundColor).toBe('#000080');
  expect(textColorOf(cell)).toBe('#FFFFFF');
});

test("an author's dark hex colour paints automatic text white", () => {
  const cell = paintedCell(
    null,
    { cells: { inserted: 'byAuthor' } },
    { authors: { Reviewer: '#123456' } }
  );
  expect(cell.style.backgroundColor).toBe('#123456');
  expect(textColorOf(cell)).toBe('#FFFFFF');
});

test("an author's ramp token over dark shading paints automatic text black", () => {
  const cell = paintedCell('000080', { cells: { inserted: 'byAuthor' } });
  expect(cell.style.backgroundColor).toBe('var(--doc-review-author-0)');
  expect(textColorOf(cell)).toBe('#000000');
});

test('light paragraph shading in a dark cell paints automatic text black', () => {
  const cell = paintedCell('000080', { cells: { inserted: 'none' } }, undefined, 'FFFF99');
  const text = [...cell.querySelectorAll<HTMLElement>('span')].find(
    (span) => span.textContent === 'cell' && span.children.length === 0
  );
  expect(textColorOf(text!)).toBe('#000000');
});
