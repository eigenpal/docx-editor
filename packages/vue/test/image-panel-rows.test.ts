// Image parts in the toolbar's "⋯" panel are whole-row buttons that open their popups.
//
// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { createApp, h, type VNodeChild } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance, ImageDecodePort } from '@docx-editor.dev/core/editor';
import { resolveImageResourceLimits, validateRasterHeader } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { ToolbarPanelRow } from '../src/editor/toolbar/ToolbarGroup';
import {
  ToolbarImageAltText,
  ToolbarImageInsert,
  ToolbarImageProperties,
  ToolbarImageWrap,
} from '../src/editor/images';
import { flush } from './helpers/fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function inlinePictureDocument(): Uint8Array {
  const drawing =
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="914400" cy="914400"/>' +
    '<wp:docPr id="1" name="green" descr="Green square"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
    `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rIdImage"><a:stretch><a:fillRect/></a:stretch></a:blip></pic:blipFill>' +
    '<pic:spPr><a:xfrm rot="0"><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline>';
  const body =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body><w:p><w:r><w:t>before</w:t></w:r><w:r><w:drawing>${drawing}</w:drawing></w:r><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(body),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdImage" Type="${R}/image" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
  });
}

const decodePort: ImageDecodePort = {
  async decode(bytes, mime) {
    const header = validateRasterHeader(bytes, mime);
    if (!header) throw new Error('invalid image');
    if (header.pixelWidth * header.pixelHeight > resolveImageResourceLimits().maxPixels) {
      throw new Error('too large');
    }
    return Object.freeze({
      pixelWidth: header.pixelWidth,
      pixelHeight: header.pixelHeight,
      dpiX: 96,
      dpiY: 96,
    });
  },
};

const unmounts: Array<() => void> = [];
const RealResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  globalThis.ResizeObserver = RealResizeObserver;
});

function mount(chrome: () => VNodeChild) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: inlinePictureDocument(),
          imageDecodePort: decodePort,
          onReady: (editor: Editor) => {
            ready.push(editor as DocxEditorInstance);
          },
        },
        {
          default: () => [
            chrome(),
            h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
          ],
        }
      ),
  });
  app.mount(container);
  unmounts.push(() => {
    app.unmount();
    container.remove();
  });
  return { container, editor: () => ready.at(-1)! };
}

async function ready(editor: () => DocxEditorInstance | undefined): Promise<DocxEditorInstance> {
  for (let attempt = 0; attempt < 50 && !editor()?.surface; attempt++) await flush();
  return editor()!;
}

/** Put the selection on the picture and wait until the editor reports it. */
async function selectDrawing(editor: DocxEditorInstance): Promise<void> {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 6 },
    head: { paragraphId, offset: 6 },
  });
  for (let attempt = 0; attempt < 20 && !editor.getSelectedImage(); attempt++) {
    editor.surface!.layout();
    await flush();
  }
  await flush();
}

const SLOTS = ['image.insert', 'image.properties', 'image.wrap', 'image.altText'];

test('each image part in the panel is a full-width labelled row, and a click opens its popup', async () => {
  const { container, editor } = mount(() =>
    h(ToolbarPanelRow, null, {
      default: () => [
        h(ToolbarImageInsert),
        h(ToolbarImageProperties),
        h(ToolbarImageWrap),
        h(ToolbarImageAltText),
      ],
    })
  );
  await selectDrawing(await ready(editor));
  const row = (slot: string) =>
    container.querySelector<HTMLButtonElement>(`button[data-slot="${slot}"]`)!;

  for (const slot of SLOTS) {
    const button = row(slot);
    expect(button).not.toBeNull();
    expect(button.classList.contains('docx-toolbar__more-command')).toBe(true);
    expect(button.classList.contains('docx-toolbar__button')).toBe(false);
    expect(button.querySelector('.docx-toolbar__more-command-label')?.textContent).toBeTruthy();
  }
  // Inserting is not offered while an image is selected; the other three are.
  expect(row('image.insert').disabled).toBe(true);

  row('image.wrap').click();
  await flush();
  expect(container.querySelector('[role="menu"]')).not.toBeNull();

  row('image.altText').click();
  await flush();
  expect(row('image.altText').getAttribute('aria-expanded')).toBe('true');

  row('image.properties').click();
  await flush();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

test('in the bar, the same parts stay icon buttons', async () => {
  const { container, editor } = mount(() => [h(ToolbarImageWrap), h(ToolbarImageAltText)]);
  await selectDrawing(await ready(editor));
  for (const slot of ['image.wrap', 'image.altText']) {
    const button = container.querySelector(`button[data-slot="${slot}"]`)!;
    expect(button.classList.contains('docx-toolbar__button')).toBe(true);
    expect(button.querySelector('.docx-toolbar__more-command-label')).toBeNull();
  }
});

test('a selected image collapsed into More shows clickable rows', async () => {
  // Every group is wider than the bar, so all collapse into More.
  const observers: Array<() => void> = [];
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      observers.push(() => callback([], this as unknown as ResizeObserver));
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  const { container, editor } = mount(() =>
    h(DocxEditorToolbar, { t: (key: string) => (key === 'formattingBar.more' ? 'More' : key) })
  );
  await selectDrawing(await ready(editor));
  const toolbar = container.querySelector<HTMLElement>('[data-testid="docx-toolbar"]')!;
  Object.defineProperty(toolbar, 'clientWidth', { configurable: true, get: () => 200 });
  for (const node of toolbar.querySelectorAll('[data-toolbar-group], [data-toolbar-fixed]')) {
    Object.defineProperty(node, 'offsetWidth', { configurable: true, get: () => 150 });
  }
  for (const observe of observers) observe();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await flush();
  toolbar.querySelector<HTMLButtonElement>('[aria-label="More"]')!.click();
  await flush();
  const panel = container.querySelector<HTMLElement>('[data-testid="toolbar-overflow-panel"]')!;
  expect(panel).not.toBeNull();
  for (const slot of ['image.properties', 'image.wrap', 'image.altText']) {
    const button = panel.querySelector<HTMLButtonElement>(`button[data-slot="${slot}"]`);
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(false);
    expect(button!.classList.contains('docx-toolbar__more-command')).toBe(true);
    // Not a plain-text label beside a small icon button.
    expect(button!.closest('.docx-toolbar__more-control')).toBeNull();
  }
  panel.querySelector<HTMLButtonElement>('button[data-slot="image.wrap"]')!.click();
  await flush();
  expect(panel.querySelector('[role="menu"]')).not.toBeNull();
  // Opening the wrap menu keeps More open, so the choice can be made.
  expect(container.querySelector('[data-testid="toolbar-overflow-panel"]')).not.toBeNull();
});
