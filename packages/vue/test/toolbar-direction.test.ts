// The Vue twin of `packages/react/test/toolbar-direction.test.tsx`.
//
// What these pin down: the Left-to-right and Right-to-left buttons sit in the default
// toolbar and as named parts, a press writes the paragraph base direction (`w:bidi`), and
// `aria-pressed` follows the caret from a right-to-left paragraph to a left-to-right one.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { h } from 'vue';
import { en } from '@docx-editor.dev/i18n';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorToolbar } from '../src/editor/toolbar';
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
  test('Right-to-left in the default toolbar writes w:bidi and reads back pressed', async () => {
    mounted = mountEditorTree(() => h(DocxEditorToolbar), docx(p('alpha')));
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
