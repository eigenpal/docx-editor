import { afterEach, describe, expect, test } from 'bun:test';
import { h } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorHeaderFooterChrome } from '../src/editor/DocxEditorHeaderFooter.tsx';
import { flush, mountEditorTree } from './helpers/mount.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function docxWithHeader(headerText = 'Hdr'): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        p('Body') +
        `<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr></w:pPr></w:p>` +
        '<w:sectPr/></w:body></w:document>'
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${p(headerText)}</w:hdr>`),
  });
}

function mountChrome(source: Uint8Array) {
  return mountEditorTree(
    () => [],
    source,
    () => [h(DocxEditorHeaderFooterChrome)]
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DocxEditorHeaderFooterChrome', () => {
  test('hidden until a furniture scope opens', async () => {
    const mounted = mountChrome(docxWithHeader());
    try {
      await flush();
      expect(mounted.container.querySelector('[data-testid="docx-hf-chrome"]')).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  test('shows the active region after editHeaderFooter', async () => {
    const mounted = mountChrome(docxWithHeader());
    try {
      await flush();
      const editor = mounted.editor();
      const opened = editor.exec({ type: 'editHeaderFooter', position: 'header' });
      expect(opened.ok).toBe(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await flush();
      const chrome = mounted.container.querySelector(
        '[data-testid="docx-hf-chrome"]'
      ) as HTMLElement;
      expect(chrome).toBeTruthy();
      expect(chrome.style.visibility).toBe('visible');
      expect(chrome.textContent).toContain('Header');
    } finally {
      mounted.unmount();
    }
  });

  test('Options opens the header menu with page field actions', async () => {
    const mounted = mountChrome(docxWithHeader());
    try {
      await flush();
      const editor = mounted.editor() as DocxEditorInstance;
      editor.exec({ type: 'editHeaderFooter', position: 'header' });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await flush();
      const trigger = [...mounted.container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Options')
      ) as HTMLButtonElement | null;
      expect(trigger).toBeTruthy();
      trigger?.click();
      await flush();
      const menuItem = [...mounted.container.querySelectorAll('button[role="menuitem"]')].find(
        (button) => button.textContent?.includes('Insert current page number')
      ) as HTMLButtonElement | null;
      expect(menuItem?.disabled).toBe(false);
    } finally {
      mounted.unmount();
    }
  });
});
