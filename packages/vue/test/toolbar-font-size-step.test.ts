// The Vue twin of `packages/react/test/toolbar-font-size-step.test.tsx`.
//
// A selection with mixed sizes keeps the − and + buttons enabled, and each press steps every
// run from its own size.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { h } from 'vue';
import { en } from '@docx-editor.dev/i18n';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { docx, flush } from './helpers/fixtures';
import { mountEditorTree, type MountedEditor } from './helpers/mount';

const SOURCE = docx(
  '<w:p><w:r><w:rPr><w:sz w:val="52"/></w:rPr><w:t>Big</w:t></w:r>' +
    '<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve"> small</w:t></w:r></w:p>'
);

let mounted: MountedEditor | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const sizes = (editor: DocxEditorInstance): string[] =>
  [...serializeOoxmlPart(editor.surface!.session.part()).matchAll(/<w:sz w:val="(\d+)"\/>/g)].map(
    (match) => match[1]!
  );

describe('the Vue font size stepper', () => {
  test('a selection with mixed sizes keeps the steppers enabled and steps each run', async () => {
    mounted = mountEditorTree(() => h(DocxEditorToolbar), SOURCE);
    await flush();
    mounted.editor().surface!.selectAll();
    await flush();
    const root = mounted.container.querySelector('[data-slot="font.size"]')!;
    const input = root.querySelector('input') as HTMLInputElement;
    const decrease = root.querySelector(
      `button[aria-label="${en.fontSize.decrease}"]`
    ) as HTMLButtonElement;
    const increase = root.querySelector(
      `button[aria-label="${en.fontSize.increase}"]`
    ) as HTMLButtonElement;
    expect(input.value).toBe('—');
    expect(decrease.disabled).toBe(false);
    expect(increase.disabled).toBe(false);
    // Each button's tooltip names its shortcut.
    expect(decrease.title).toContain('Shift+<');
    expect(increase.title).toContain('Shift+>');

    increase.click();
    await flush();
    // 26 pt and 11 pt become 28 pt and 12 pt, with the paragraph mark stepped beside them.
    expect(sizes(mounted.editor()).slice(-2)).toEqual(['56', '24']);
    expect(input.value).toBe('—');

    decrease.click();
    decrease.click();
    await flush();
    expect(sizes(mounted.editor()).slice(-2)).toEqual(['48', '20']);
  });

  test('the arrow keys in the size box step a mixed selection', async () => {
    mounted = mountEditorTree(() => h(DocxEditorToolbar), SOURCE);
    await flush();
    mounted.editor().surface!.selectAll();
    await flush();
    const input = mounted.container.querySelector(
      '[data-slot="font.size"] input'
    ) as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await flush();
    expect(sizes(mounted.editor()).slice(-2)).toEqual(['56', '24']);
  });
});
