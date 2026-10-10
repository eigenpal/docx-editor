import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, nextTick } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import { CHROME_MENUS } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorMenu } from '../src/editor/menu';
import { mountEditorTree } from './helpers/mount';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 150));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DocxEditorMenu composition', () => {
  test('renders registry menus on the default bar', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          { document: SOURCE },
          {
            default: () => [
              h(DocxEditorMenu),
              h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
            ],
          }
        ),
    });
    try {
      app.mount(container);
      await flush();
      const bar = container.querySelector('[data-testid="docx-menubar"]');
      expect(bar).not.toBeNull();
      const menuIds = CHROME_MENUS.map((menu) => menu.id);
      for (const id of menuIds) {
        expect(bar!.querySelector(`[data-menu="${id}"]`)).not.toBeNull();
      }
    } finally {
      app.unmount();
      container.remove();
    }
  });

  test('host onSave runs when File > Save is chosen', async () => {
    let saved = 0;
    const view = mountEditorTree(() => h(DocxEditorMenu, { onSave: () => (saved += 1) }));
    await flush();
    const trigger = view.container.querySelector(
      '[data-menu="file"] .docx-menubar__trigger'
    ) as HTMLButtonElement;
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    const row = view.container.querySelector('[data-slot="file.save"]') as HTMLButtonElement;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(saved).toBe(1);
    view.unmount();
  });
});

test('automatic Page Setup uses the Root render callback and survives menu dismissal', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let renders = 0;
  let legacyCalls = 0;
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: SOURCE,
          popups: {
            pageSetup: ({ onClose }) => {
              renders++;
              return h(
                'button',
                { 'data-custom-page-dialog': '', onClick: onClose },
                'Close page setup'
              );
            },
          },
        },
        {
          default: () => [
            h(DocxEditorMenu, { onPageSetup: () => legacyCalls++ }),
            h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
          ],
        }
      ),
  });
  try {
    app.mount(container);
    await flush();
    const trigger = container.querySelector(
      '[data-menu="file"] .docx-menubar__trigger'
    ) as HTMLButtonElement;
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    (container.querySelector('[data-slot="file.pageSetup"]') as HTMLButtonElement).click();
    await flush();
    expect(renders).toBeGreaterThan(0);
    expect(legacyCalls).toBe(0);
    expect(container.querySelectorAll('[data-custom-page-dialog]').length).toBe(1);
    expect(container.querySelector('[data-docx-dialog="pageSetup"]')).toBeNull();
    (container.querySelector('[data-custom-page-dialog]') as HTMLButtonElement).click();
    await flush();
    expect(container.querySelector('[data-custom-page-dialog]')).toBeNull();
  } finally {
    app.unmount();
    container.remove();
  }
});

test('false Page Setup configuration suppresses the default and legacy callback', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  let legacyCalls = 0;
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        { document: SOURCE, popups: { pageSetup: false } },
        {
          default: () => [
            h(DocxEditorMenu, { onPageSetup: () => legacyCalls++ }),
            h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
          ],
        }
      ),
  });
  try {
    app.mount(container);
    await flush();
    const trigger = container.querySelector(
      '[data-menu="file"] .docx-menubar__trigger'
    ) as HTMLButtonElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    (container.querySelector('[data-slot="file.pageSetup"]') as HTMLButtonElement).click();
    await flush();
    expect(legacyCalls).toBe(0);
    expect(container.querySelector('dialog')).toBeNull();
  } finally {
    app.unmount();
    container.remove();
  }
});

test('File > Export reports missing converters after the menu closes', async () => {
  const view = mountEditorTree(() => h(DocxEditorMenu));
  try {
    await flush();
    for (const [slot, packageName] of [
      ['file.exportMarkdown', 'docx-to-markdown'],
      ['file.exportPdf', 'docx-to-pdf'],
    ]) {
      (
        view.container.querySelector(
          '[data-menu="file"] .docx-menubar__trigger'
        ) as HTMLButtonElement
      ).click();
      await flush();
      view.container
        .querySelector('.docx-menubar__submenu')!
        .dispatchEvent(new MouseEvent('mouseenter'));
      await flush();
      (view.container.querySelector(`[data-slot="${slot}"]`) as HTMLButtonElement).click();
      await flush();
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(packageName!);
      expect(view.container.querySelector('[data-menu="file"] [role="menu"]')).toBeNull();
      (
        view.container.querySelector('[data-docx-dialog="export"] button') as HTMLButtonElement
      ).click();
      await flush();
    }
  } finally {
    view.unmount();
  }
});

test('File row overrides reach export submenu slots without duplicate rows', async () => {
  const view = mountEditorTree(() =>
    h(DocxEditorMenu, null, {
      default: () =>
        h(DocxEditorMenu.File, null, {
          default: () => [
            h(DocxEditorMenu.ExportPdf, { hidden: true }),
            h(DocxEditorMenu.ExportMarkdown, { className: 'custom-export' }),
          ],
        }),
    })
  );
  try {
    await flush();
    (
      view.container.querySelector('[data-menu="file"] .docx-menubar__trigger') as HTMLButtonElement
    ).click();
    await flush();
    view.container
      .querySelector('.docx-menubar__submenu')!
      .dispatchEvent(new MouseEvent('mouseenter'));
    await flush();
    expect(view.container.querySelectorAll('[data-slot="file.exportPdf"]')).toHaveLength(0);
    const rows = view.container.querySelectorAll('[data-slot="file.exportMarkdown"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.classList.contains('custom-export')).toBe(true);
    expect(rows[0]?.closest('.docx-menubar__submenu')).not.toBeNull();
  } finally {
    view.unmount();
  }
});

test('Markdown export shows a dismissible dialog and reports a later failure', async () => {
  let fail!: (reason: Error) => void;
  const conversion = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  const view = mountEditorTree(() =>
    h(DocxEditorMenu, { exporters: { markdown: () => conversion } })
  );
  try {
    await flush();
    (
      view.container.querySelector('[data-menu="file"] .docx-menubar__trigger') as HTMLButtonElement
    ).click();
    await flush();
    view.container
      .querySelector('.docx-menubar__submenu')!
      .dispatchEvent(new MouseEvent('mouseenter'));
    await flush();
    (
      view.container.querySelector('[data-slot="file.exportMarkdown"]') as HTMLButtonElement
    ).click();
    await flush();
    expect(view.container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Exporting Markdown…'
    );
    (
      view.container.querySelector('[data-docx-dialog="export"] button') as HTMLButtonElement
    ).click();
    await flush();
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    fail(new Error('Conversion unavailable'));
    await flush();
    expect(view.container.querySelector('[role="alertdialog"]')?.getAttribute('aria-label')).toBe(
      'Markdown export failed'
    );
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      'Conversion unavailable'
    );
    (
      view.container.querySelector('[data-docx-dialog="export"] button') as HTMLButtonElement
    ).click();
    await flush();
    expect(view.container.querySelector('[role="alertdialog"]')).toBeNull();
  } finally {
    view.unmount();
  }
});
