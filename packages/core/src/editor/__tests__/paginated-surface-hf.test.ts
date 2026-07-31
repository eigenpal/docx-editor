// Headers and footers on the paginated surface (phase 2, read-only).
//
// The furniture renders inside every sheet, sized to its FLOW height (#856), pushes the
// content area down when taller than the margin, honours titlePg/evenAndOddHeaders
// variants, and refuses to map browser positions inside it back to the model.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { positionFromDomPoint } from '../dom-selection.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

interface HfDocOptions {
  readonly body?: string;
  readonly header?: string;
  readonly firstHeader?: string;
  readonly footer?: string;
  readonly titlePg?: boolean;
}

function docx(options: HfDocOptions): Uint8Array {
  const references: string[] = [];
  const rels: string[] = [];
  const overrides: string[] = [];
  const entries: Record<string, Uint8Array> = {};
  const addPart = (
    kind: 'header' | 'footer',
    type: string,
    relId: string,
    name: string,
    content: string
  ): void => {
    references.push(`<w:${kind}Reference w:type="${type}" r:id="${relId}"/>`);
    rels.push(`<Relationship Id="${relId}" Type="${R}/${kind}" Target="${name}"/>`);
    overrides.push(
      `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`
    );
    const root = kind === 'header' ? 'hdr' : 'ftr';
    entries[`word/${name}`] = strToU8(`<w:${root} xmlns:w="${W}">${content}</w:${root}>`);
  };
  if (options.header) addPart('header', 'default', 'rId10', 'header1.xml', options.header);
  if (options.firstHeader) addPart('header', 'first', 'rId11', 'header2.xml', options.firstHeader);
  if (options.footer) addPart('footer', 'default', 'rId12', 'footer1.xml', options.footer);

  entries['[Content_Types].xml'] = strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      overrides.join('') +
      '</Types>'
  );
  entries['_rels/.rels'] = strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  if (rels.length > 0) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${rels.join('')}</Relationships>`
    );
  }
  entries['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      (options.body ?? p('body text')) +
      `<w:sectPr>${references.join('')}${options.titlePg ? '<w:titlePg/>' : ''}</w:sectPr>` +
      '</w:body></w:document>'
  );
  return zipSync(entries);
}

function mount(bytes: Uint8Array): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

describe('headers and footers, read-only', () => {
  test('the default header and footer render on the sheet, inert to editing', () => {
    const { container } = mount(docx({ header: p('HEADER'), footer: p('FOOTER') }));
    const header = container.querySelector('[data-docx-hf="header"]') as HTMLElement;
    const footer = container.querySelector('[data-docx-hf="footer"]') as HTMLElement;
    expect(header?.textContent).toContain('HEADER');
    expect(footer?.textContent).toContain('FOOTER');
    expect(header.getAttribute('contenteditable')).toBe('false');
    // Furniture sits OUTSIDE the content box, on the sheet itself.
    expect(header.closest('.docx-page')).not.toBeNull();
    expect(header.closest('.docx-page-content')).toBeNull();
  });

  test('the header box is sized to flow height, not to an anchored extent (#856)', () => {
    // One line of text plus a generic drawing whose extent claims to be enormous. The tree
    // lane lays out no anchored shapes, so the box must size to the TEXT flow alone.
    const drawing =
      '<w:p><w:r><w:drawing><wp:anchor xmlns:wp="urn:test:wp"><wp:extent cx="9144000" cy="9144000"/></wp:anchor></w:drawing></w:r></w:p>';
    const { container } = mount(docx({ header: p('short') + drawing }));
    const header = container.querySelector('[data-docx-hf="header"]') as HTMLElement;
    const height = Number.parseFloat(header.style.height);
    // Two default lines (14pt each with the fixed measurer) — nowhere near a 9144000-EMU extent.
    expect(height).toBeGreaterThan(0);
    expect(height).toBeLessThan(60);
  });

  test('a header taller than the margin pushes the content area down', () => {
    const tall = Array.from({ length: 12 }, (_, i) => p(`header line ${i}`)).join('');
    const short = mount(docx({ header: p('one line') }));
    const pushed = mount(docx({ header: tall }));
    const contentTopOf = (container: HTMLElement): number => {
      const content = container.querySelector('.docx-page-content') as HTMLElement;
      return Number.parseFloat(content.style.top);
    };
    expect(contentTopOf(short.container)).toBe(72); // margin.top wins over 36 + 14
    expect(contentTopOf(pushed.container)).toBeGreaterThan(72);
  });

  test('titlePg shows the first-page header on page one and default afterwards', () => {
    const longBody = Array.from({ length: 120 }, (_, i) => p(`body ${i}`)).join('');
    const { container } = mount(
      docx({
        body: longBody,
        header: p('DEFAULT-HEADER'),
        firstHeader: p('FIRST-HEADER'),
        titlePg: true,
      })
    );
    const pages = [...container.querySelectorAll('.docx-page')];
    expect(pages.length).toBeGreaterThan(1);
    const headerTextOf = (page: Element): string | null =>
      page.querySelector('[data-docx-hf="header"]')?.textContent ?? null;
    expect(headerTextOf(pages[0]!)).toContain('FIRST-HEADER');
    expect(headerTextOf(pages[1]!)).toContain('DEFAULT-HEADER');
  });

  test('a point inside the furniture refuses to map to a model position', () => {
    const { container } = mount(docx({ header: p('HEADER') }));
    const headerSpan = container.querySelector(
      '[data-docx-hf] [data-paragraph-id][data-start]'
    ) as HTMLElement;
    expect(headerSpan).not.toBeNull();
    const textNode = headerSpan.firstChild!;
    expect(positionFromDomPoint(textNode, 1, container)).toBeNull();
    // The same call on body text still maps.
    const bodySpan = container.querySelector(
      '.docx-page-content [data-paragraph-id][data-start]'
    ) as HTMLElement;
    expect(positionFromDomPoint(bodySpan.firstChild!, 1, container)).not.toBeNull();
  });

  test('block-level SDT content joins the body flow', () => {
    const sdtBody =
      p('before') +
      `<w:sdt><w:sdtPr/><w:sdtContent>${p('inside control')}</w:sdtContent></w:sdt>` +
      p('after');
    const { surface, container } = mount(docx({ body: sdtBody }));
    expect(container.textContent).toContain('inside control');
    // The SDT paragraph is editable like any other.
    expect(surface.session.paragraphIds()).toHaveLength(3);
  });

  test('a document without furniture renders none', () => {
    const { container } = mount(docx({}));
    expect(container.querySelector('[data-docx-hf]')).toBeNull();
  });
});
