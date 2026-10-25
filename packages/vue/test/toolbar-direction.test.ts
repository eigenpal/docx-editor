// The Vue twin of `packages/react/test/toolbar-direction.test.tsx`.
//
// What these pin down: the Left-to-right and Right-to-left buttons sit in the default
// toolbar and as named parts, a press writes the paragraph base direction (`w:bidi`), and
// `aria-pressed` follows the caret from a right-to-left paragraph to a left-to-right one.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h } from 'vue';
import { ar, en, es, he } from '@docx-editor.dev/i18n';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { DocxEditor } from '../src/components/DocxEditor';
import { LocaleProvider } from '../src/i18n';
import { docx, flush } from './helpers/fixtures';
import { mountEditorTree, type MountedEditor } from './helpers/mount';

const p = (text: string, pPr = ''): string =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

let mounted: MountedEditor | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const button = (container: HTMLElement, label: string): HTMLButtonElement => {
  const found = container.querySelector(`button[aria-label=${JSON.stringify(label)}]`);
  if (!found) throw new Error(`no toolbar button labelled ${label}`);
  return found as HTMLButtonElement;
};

const caretIn = (editor: DocxEditorInstance, index: number): void => {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 1 },
    head: { paragraphId, offset: 1 },
  });
};

describe('the Vue paragraph direction buttons', () => {
  test('Right-to-left in the explicit toolbar writes w:bidi and reads back pressed', async () => {
    mounted = mountEditorTree(
      () =>
        h(
          DocxEditorToolbar,
          {},
          { default: () => [h(DocxEditorToolbar.LeftToRight), h(DocxEditorToolbar.RightToLeft)] }
        ),
      docx(p('alpha'))
    );
    await flush();
    caretIn(mounted.editor(), 0);
    await flush();
    const rtl = button(mounted.container, en.toolbar.rightToLeft);
    const ltr = button(mounted.container, en.toolbar.leftToRight);
    expect(rtl.disabled).toBe(false);
    expect(rtl.getAttribute('aria-pressed')).toBe('false');
    expect(ltr.getAttribute('aria-pressed')).toBe('true');

    rtl.click();
    await flush();
    const editor = mounted.editor();
    expect(editor.snapshot().formatting?.direction).toBe('rtl');
    expect(serializeOoxmlPart(editor.surface!.session.part())).toContain('<w:bidi');
    expect(rtl.getAttribute('aria-pressed')).toBe('true');
    expect(ltr.getAttribute('aria-pressed')).toBe('false');
  });

  test('the pressed state follows the caret between paragraphs of each direction', async () => {
    mounted = mountEditorTree(
      () =>
        h(
          DocxEditorToolbar,
          { preset: false, overflow: false },
          {
            default: () => [h(DocxEditorToolbar.LeftToRight), h(DocxEditorToolbar.RightToLeft)],
          }
        ),
      docx(p('one', '<w:bidi/>') + p('two'))
    );
    await flush();
    const rtl = button(mounted.container, en.toolbar.rightToLeft);
    const ltr = button(mounted.container, en.toolbar.leftToRight);

    caretIn(mounted.editor(), 0);
    await flush();
    expect(rtl.getAttribute('aria-pressed')).toBe('true');
    expect(ltr.getAttribute('aria-pressed')).toBe('false');

    caretIn(mounted.editor(), 1);
    await flush();
    expect(rtl.getAttribute('aria-pressed')).toBe('false');
    expect(ltr.getAttribute('aria-pressed')).toBe('true');
  });
});

test('the default toolbar omits direction shortcuts', async () => {
  mounted = mountEditorTree(() => h(DocxEditorToolbar), docx(p('alpha')));
  await flush();
  expect(
    mounted.container.querySelector('button[aria-label="' + en.toolbar.leftToRight + '"]')
  ).toBeNull();
  expect(
    mounted.container.querySelector('button[aria-label="' + en.toolbar.rightToLeft + '"]')
  ).toBeNull();
});

describe('a right-to-left interface language', () => {
  test('the default toolbar shows the direction buttons after alignment', async () => {
    mounted = mountEditorTree(
      () => h(LocaleProvider, { i18n: ar }, { default: () => h(DocxEditorToolbar) }),
      docx(p('alpha'))
    );
    await flush();
    const rtl = button(mounted.container, ar.toolbar!.rightToLeft!);
    const ltr = button(mounted.container, ar.toolbar!.leftToRight!);
    const alignment = mounted.container.querySelector('[data-slot="alignment"]')!;
    expect(alignment.compareDocumentPosition(ltr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ltr.compareDocumentPosition(rtl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('composed chrome parts mirror under the provider without a wrapper', async () => {
    mounted = mountEditorTree(
      () => h(LocaleProvider, { i18n: ar }, { default: () => h(DocxEditorToolbar) }),
      docx(p('alpha'))
    );
    await flush();
    expect(mounted.container.querySelector('.docx-toolbar')!.getAttribute('dir')).toBe('rtl');
  });

  test('the provider dir prop decides over the catalog', async () => {
    mounted = mountEditorTree(
      () => h(LocaleProvider, { i18n: es, dir: 'rtl' }, { default: () => h(DocxEditorToolbar) }),
      docx(p('alpha'))
    );
    await flush();
    expect(mounted.container.querySelector('.docx-toolbar')!.getAttribute('dir')).toBe('rtl');
    expect(button(mounted.container, es.toolbar!.rightToLeft!)).toBeDefined();
  });

  /** The packaged editor's chrome wrapper direction for one catalog. */
  async function sugarDirection(i18n: typeof ar): Promise<string | null> {
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({ render: () => h(DocxEditor, { document: docx(p('alpha')), i18n }) });
    app.mount(host);
    await flush();
    const dir = host.querySelector('.docx-editor')!.getAttribute('dir');
    app.unmount();
    host.remove();
    return dir;
  }

  test('the packaged editor mirrors its chrome for Arabic and Hebrew', async () => {
    expect(await sugarDirection(ar)).toBe('rtl');
    expect(await sugarDirection(he)).toBe('rtl');
  });

  test('a left-to-right catalog leaves the host direction in charge', async () => {
    expect(await sugarDirection(es)).toBeNull();
  });
});
