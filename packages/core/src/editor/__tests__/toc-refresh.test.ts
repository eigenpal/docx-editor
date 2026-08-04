import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { paragraphFragmentsOf } from '../../layout/index.ts';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>' +
  '</w:styles>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const TOC_CONTENT =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-1" \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
  '<w:p><w:r><w:t>Old cached entry</w:t></w:r></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
const HEADING =
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>';
const BODY =
  '<w:sdt><w:sdtPr><w:alias w:val="Contents"/></w:sdtPr><w:sdtContent>' +
  TOC_CONTENT +
  '</w:sdtContent></w:sdt>' +
  HEADING;
const EMPTY_TOC =
  '<w:sdt><w:sdtPr><w:alias w:val="Contents"/></w:sdtPr><w:sdtContent>' +
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-1" \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
  '</w:sdtContent></w:sdt>';

async function documentXml(editor: ReturnType<typeof createDocxEditor>): Promise<string> {
  const bytes = new Uint8Array(await editor.save());
  return strFromU8(unzipSync(bytes)['word/document.xml']!);
}

describe('TOC refresh editor lane', () => {
  test('inserts a populated read-only TOC through the public command', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(HEADING + '<w:p><w:r><w:t>Body</w:t></w:r></w:p>'));

    expect(editor.can({ type: 'insertToc' })).toEqual({ ok: true });
    expect(editor.exec({ type: 'insertToc' })).toEqual({ ok: true, changed: true });
    let xml = await documentXml(editor);
    expect(xml).toContain('w:docPartGallery w:val="Table of Contents"');
    expect(xml).toContain('TOC \\o &quot;1-3&quot; \\h');
    expect(xml).toContain('w:pStyle w:val="TOC1"');
    expect(xml).toContain('w:hyperlink');
    expect(xml).toContain('Introduction');

    const row = [...container.querySelectorAll<HTMLElement>('a.docx-hyperlink')]
      .find((element) => element.textContent?.includes('Introduction'))
      ?.closest<HTMLElement>('.docx-paragraph-fragment');
    expect(row?.getAttribute('contenteditable')).toBe('false');
    expect(row?.getAttribute('aria-readonly')).toBe('true');

    // Convergence had no digit to move — the heading is on page 1 either way — and a pass that
    // writes nothing is not a document change, so the insertion is a single undo step. The
    // separately undoable page-number phase is asserted where it is observable, below.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    xml = await documentXml(editor);
    expect(xml).not.toContain('w:docPartGallery');
    expect(xml).not.toContain('w:bookmarkStart');
    editor.destroy();
  });

  test('inserted TOC first entry has no preceding blank row', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(HEADING + '<w:p><w:r><w:t>Body</w:t></w:r></w:p>'));
    expect(editor.exec({ type: 'insertToc' })).toEqual({ ok: true, changed: true });

    const entryFragment = editor
      .surface!.layout()
      .pages.flatMap((page) => paragraphFragmentsOf(page))
      .find((fragment) =>
        fragment.lines.some((line) => line.spans.some((span) => span.text.includes('Introduction')))
      );
    expect(entryFragment).toBeDefined();
    expect(entryFragment!.box.y).toBe(0);

    const painted = [...container.querySelectorAll<HTMLElement>('.docx-paragraph-fragment')].find(
      (element) => element.textContent?.includes('Introduction')
    );
    expect(painted).toBeDefined();
    const preceding = painted!
      .closest('.docx-page-content')
      ?.querySelectorAll('.docx-paragraph-fragment');
    if (preceding) {
      for (const fragment of preceding) {
        if (fragment === painted) break;
        expect(fragment.textContent?.trim()).not.toBe('');
      }
    }
    editor.destroy();
  });

  test('queries, refreshes, persists, and refuses edits inside the result', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    const errors: string[] = [];
    editor.on('error', (error) => errors.push(`${error.code}: ${error.message}`));
    editor.load(docx(BODY));
    expect(errors).toEqual([]);
    expect(editor.surface).not.toBeNull();
    expect(editor.query({ type: 'isInsideToc', pos: 0 })).toBe(false);
    expect(editor.can({ type: 'refreshToc' }).ok).toBe(true);
    editor.surface!.deleteBackward();
    expect(await documentXml(editor)).toContain('Old cached entry');
    expect(container.querySelector('.docx-content-control-boundary')).not.toBeNull();
    expect(container.querySelector('[data-docx-region-widget]')).toBeNull();
    const row = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(
      (element) => element.textContent?.includes('Old cached entry')
    );
    const rowFragment = row!.closest<HTMLElement>('.docx-paragraph-fragment')!;
    expect(rowFragment.getAttribute('contenteditable')).toBe('false');
    expect(rowFragment.getAttribute('aria-readonly')).toBe('true');
    const rowParagraphId = rowFragment.dataset.paragraphId!;
    editor.surface!.setSelection({
      anchor: { paragraphId: rowParagraphId, offset: 0 },
      head: { paragraphId: rowParagraphId, offset: 0 },
    });
    editor.surface!.type('tamper');
    expect(await documentXml(editor)).not.toContain('tamper');
    const open = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 320,
      clientY: 240,
    });
    row!.dispatchEvent(open);
    expect(open.defaultPrevented).toBe(true);
    const menu = container.querySelector<HTMLElement>('[data-docx-toc-menu]');
    expect(menu?.style.left).toBe('320px');
    expect(menu?.style.top).toBe('240px');
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('.docx-content-control-menu-item')].map(
        (button) => button.textContent
      )
    ).toEqual(['Update entire table', 'Update page numbers only']);

    expect(editor.exec({ type: 'refreshToc', mode: 'entire' })).toEqual({
      ok: true,
      changed: true,
    });
    let xml = await documentXml(editor);
    expect(xml).toContain('Introduction');
    expect(xml).toContain('TOC1');
    expect(xml).not.toContain('Old cached entry');
    const entryLink = [...container.querySelectorAll<HTMLElement>('a.docx-hyperlink')].find(
      (anchor) => anchor.textContent?.includes('Introduction')
    );
    const jump = new MouseEvent('click', { bubbles: true, cancelable: true });
    entryLink!.dispatchEvent(jump);
    expect(jump.defaultPrevented).toBe(true);
    expect(editor.query({ type: 'isInsideToc', pos: 0 })).toBe(false);

    // Nothing left for the page-number phase to write, so it reports no change rather than
    // stacking an empty step, and one undo takes the whole refresh back.
    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' })).toEqual({
      ok: true,
      changed: false,
    });
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    xml = await documentXml(editor);
    expect(xml).toContain('Old cached entry');
    editor.destroy();
  });

  test('a page-number pass is its own undo step once a digit actually moves', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(
      docx(
        '<w:sdt><w:sdtPr><w:alias w:val="Contents"/></w:sdtPr><w:sdtContent>' +
          TOC_CONTENT +
          '</w:sdtContent></w:sdt>' +
          '<w:p><w:r><w:t>Filler</w:t></w:r></w:p>' +
          HEADING
      )
    );

    expect(editor.exec({ type: 'refreshToc', mode: 'entire' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(await documentXml(editor)).toContain('<w:t>1</w:t>');

    // Push the heading onto page 2, which makes the digit the refresh wrote stale. The break
    // goes in the paragraph BEFORE the heading: a break inside the heading itself would leave
    // the heading's first fragment — and so its page number — on page 1.
    const filler = [...container.querySelectorAll<HTMLElement>('.docx-paragraph-fragment')].find(
      (fragment) => fragment.textContent === 'Filler'
    )!;
    editor.surface!.setSelection({
      anchor: { paragraphId: filler.dataset.paragraphId!, offset: 6 },
      head: { paragraphId: filler.dataset.paragraphId!, offset: 6 },
    });
    expect(editor.exec({ type: 'insertBreak', kind: 'page' }).ok).toBe(true);

    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(await documentXml(editor)).toContain('<w:t>2</w:t>');

    // The digits are a step of their own: undoing them leaves the break and the entry alone.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    const xml = await documentXml(editor);
    expect(xml).toContain('<w:t>1</w:t>');
    expect(xml).toContain('w:br');
    expect(xml).toContain('Introduction');
    editor.destroy();
  });

  test('the TOC update menu dismisses on an outside press and on Escape', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(TOC_CONTENT + HEADING));

    const row = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(
      (element) => element.textContent?.includes('Old cached entry')
    )!;
    const openMenu = (): HTMLElement => {
      row.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      );
      return container.querySelector<HTMLElement>('[data-docx-toc-menu]')!;
    };

    expect(openMenu()).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(container.querySelector('[data-docx-toc-menu]')).toBeNull();

    // A press the pointer lane prevents — every TOC row is read-only — may never produce the
    // `mousedown` behind it, so `pointerdown` alone has to be enough to dismiss.
    expect(openMenu()).not.toBeNull();
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(container.querySelector('[data-docx-toc-menu]')).toBeNull();

    const menu = openMenu();
    // A press INSIDE the menu is not a dismissal — the item's own handler owns that click.
    menu.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(container.querySelector('[data-docx-toc-menu]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(container.querySelector('[data-docx-toc-menu]')).toBeNull();

    // Re-opening elsewhere replaces rather than stacks.
    openMenu();
    openMenu();
    expect(container.querySelectorAll('[data-docx-toc-menu]')).toHaveLength(1);
    editor.destroy();
  });

  test('bare TOC fields reuse the shared structured-region boundary', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(TOC_CONTENT + HEADING));

    expect(container.querySelector('.docx-content-control-boundary')).not.toBeNull();
    expect(container.querySelector('[data-docx-region-widget]')).toBeNull();
    editor.destroy();
  });

  test('empty TOC paints subtle read-only furniture that opens update actions', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(EMPTY_TOC + HEADING));

    const placeholders = container.querySelectorAll<HTMLElement>('[data-docx-toc-empty]');
    expect(placeholders).toHaveLength(1);
    const placeholder = placeholders[0]!;
    expect(placeholder.classList.contains('docx-toc-empty-placeholder')).toBe(true);
    expect(placeholder.getAttribute('contenteditable')).toBe('false');
    expect(placeholder.getAttribute('aria-readonly')).toBe('true');
    expect(placeholder.dataset.paragraphId).toBeTruthy();
    // Furniture is empty — no prompt text baked into the document or the painted node text.
    expect(placeholder.textContent?.trim() ?? '').toBe('');
    const before = await documentXml(editor);
    expect(before).not.toMatch(/docx-toc-empty|Empty TOC|Click to update/i);

    const open = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 240,
      clientY: 180,
    });
    placeholder.dispatchEvent(open);
    expect(open.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-docx-toc-menu]')).not.toBeNull();
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('.docx-content-control-menu-item')].map(
        (button) => button.textContent
      )
    ).toEqual(['Update entire table', 'Update page numbers only']);

    expect(editor.exec({ type: 'refreshToc', mode: 'entire' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(container.querySelector('[data-docx-toc-empty]')).toBeNull();
    expect(
      [...container.querySelectorAll<HTMLElement>('a.docx-hyperlink')].some((anchor) =>
        anchor.textContent?.includes('Introduction')
      )
    ).toBe(true);
    expect(await documentXml(editor)).toContain('Introduction');
    editor.destroy();
  });

  test('populated TOC chrome is hover-only and never sticky after click', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(TOC_CONTENT + HEADING));

    const tocChrome = container.querySelector<HTMLElement>('[data-docx-toc]');
    expect(tocChrome).not.toBeNull();
    expect(tocChrome!.hasAttribute('data-active')).toBe(false);
    expect(tocChrome!.hasAttribute('data-hover')).toBe(false);
    expect(tocChrome!.hasAttribute('data-boundary-visible')).toBe(false);

    const row = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(
      (element) => element.textContent?.includes('Old cached entry')
    )!;
    row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 40 }));
    const hovered = container.querySelector<HTMLElement>('[data-docx-toc]');
    expect(hovered?.hasAttribute('data-hover')).toBe(true);
    expect(hovered?.hasAttribute('data-boundary-visible')).toBe(true);
    expect(hovered?.hasAttribute('data-active')).toBe(false);

    row.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));
    const afterClick = container.querySelector<HTMLElement>('[data-docx-toc]');
    // Navigation may leave the pointer "over" the row in jsdom; sticky active must stay off.
    expect(afterClick?.hasAttribute('data-active')).toBe(false);

    container
      .querySelector('.docx-pages')!
      .dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    const atRest = container.querySelector<HTMLElement>('[data-docx-toc]');
    expect(atRest?.hasAttribute('data-hover')).toBe(false);
    expect(atRest?.hasAttribute('data-active')).toBe(false);
    expect(atRest?.hasAttribute('data-boundary-visible')).toBe(false);

    const outside = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(
      (element) => element.textContent?.includes('Introduction')
    )!;
    outside.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));
    const afterOutside = container.querySelector<HTMLElement>('[data-docx-toc]');
    expect(afterOutside?.hasAttribute('data-active')).toBe(false);
    expect(afterOutside?.hasAttribute('data-hover')).toBe(false);
    editor.destroy();
  });

  test('a hover-entering pointermove keeps the painted nodes, so the right-click after it lands', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(BODY));

    const rowOf = (): HTMLElement =>
      [...container.querySelectorAll<HTMLElement>('.docx-paragraph-fragment')].find((element) =>
        element.textContent?.includes('Old cached entry')
      )!;
    const row = rowOf();
    const page = container.querySelector<HTMLElement>('[data-page-index="0"]')!;
    const chrome = container.querySelector<HTMLElement>('[data-docx-toc]')!;

    // The pointer ARRIVING on the TOC is the gesture's own first event. Repainting here
    // detached the node the following `contextmenu` was aimed at, and the menu never opened.
    row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 40 }));
    expect(rowOf()).toBe(row);
    expect(row.isConnected).toBe(true);
    expect(container.querySelector('[data-page-index="0"]')).toBe(page);
    expect(container.querySelector('[data-docx-toc]')).toBe(chrome);
    expect(chrome.hasAttribute('data-hover')).toBe(true);
    expect(chrome.hasAttribute('data-boundary-visible')).toBe(true);

    const open = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 40,
    });
    row.dispatchEvent(open);
    expect(open.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-docx-toc-menu]')).not.toBeNull();

    // Same for the left-click that navigates: it arrives with the pointer entering too.
    const jump = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
    rowOf().dispatchEvent(jump);
    expect(jump.defaultPrevented).toBe(true);
    editor.destroy();
  });

  test('an empty TOC paints exactly one box, with no second boundary and no label chip', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(EMPTY_TOC + HEADING));

    expect(container.querySelectorAll('[data-docx-toc-empty]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-docx-toc]')).toHaveLength(0);
    expect(container.querySelector('.docx-content-control-boundary')).toBeNull();
    expect(container.querySelector('.docx-content-control-label')).toBeNull();

    // Populating the region hands the chrome back: hover-only boundary, nothing at rest.
    expect(editor.exec({ type: 'refreshToc', mode: 'entire' }).ok).toBe(true);
    expect(container.querySelector('[data-docx-toc-empty]')).toBeNull();
    const chrome = container.querySelector<HTMLElement>('[data-docx-toc]');
    expect(chrome).not.toBeNull();
    expect(chrome!.hasAttribute('data-boundary-visible')).toBe(false);
    expect(chrome!.hasAttribute('data-hover')).toBe(false);
    editor.destroy();
  });

  test('a plain TOC row snaps to its heading even without the hyperlink switch', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(TOC_CONTENT.replace(' \\h ', ' ') + HEADING));
    const row = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(
      (element) => element.textContent?.includes('Old cached entry')
    );
    expect(row?.querySelector('a.docx-hyperlink')).toBeNull();

    const jump = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
    row!.dispatchEvent(jump);
    expect(jump.defaultPrevented).toBe(true);
    expect(editor.query({ type: 'isInsideToc', pos: 0 })).toBe(false);
    editor.destroy();
  });
});
