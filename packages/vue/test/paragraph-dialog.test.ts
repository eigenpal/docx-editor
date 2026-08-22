/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
// The Vue twin of `packages/react/test/paragraph-dialog.test.tsx`.
//
// The two dialogs share their field logic as a byte-identical module, so what is worth
// testing separately here is the WIRING each framework does for itself: that the dialog is
// reachable from the chrome at all, that it seeds from the live selection, and that it
// keeps a disagreement the user did not resolve.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, nextTick, ref } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorParagraphDialog } from '../src/editor/DocxEditorParagraphDialog';

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

const p = (text: string, pPr = ''): string =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 150));
}

function mountDialog(body: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const open = ref(false);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        { document: docx(body), onReady: (editor: Editor) => ready.push(editor as DocxEditorInstance) },
        {
          default: () =>
            h(DocxEditorViewport, null, {
              default: () => [
                h(DocxEditorContent),
                h(DocxEditorParagraphDialog, {
                  open: open.value,
                  onClose: () => {
                    open.value = false;
                  },
                }),
              ],
            }),
        }
      ),
  });
  app.mount(container);
  const editor = (): DocxEditorInstance => {
    const found = ready[0];
    if (!found) throw new Error('the editor never became ready');
    return found;
  };
  return { container, app, open, editor };
}

/** One labelled control inside the dialog, found the way a user finds it. */
function field(container: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement {
  const found = [...container.querySelectorAll('input, select')].find(
    (node) => node.getAttribute('aria-label') === label
  );
  if (!found) throw new Error(`no control labelled ${label}`);
  return found as HTMLInputElement | HTMLSelectElement;
}

/** A checkbox, found by the visible text of the label that wraps it. */
function checkboxFor(container: HTMLElement, text: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find((node) =>
    node.textContent?.includes(text)
  );
  const box = found?.querySelector('input[type="checkbox"]');
  if (!box) throw new Error(`no checkbox labelled ${text}`);
  return box as HTMLInputElement;
}

/** The paragraph flags as the snapshot reports them, refusing to pass if they are absent. */
function flagsOf(editor: DocxEditorInstance) {
  const flags = editor.snapshot().formatting?.paragraphFlags;
  if (!flags) throw new Error('the snapshot carried no paragraph flags');
  return flags;
}

const okButton = (container: HTMLElement): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find((node) =>
    /^(OK|Apply)$/i.test(node.textContent?.trim() ?? '')
  );
  if (!found) throw new Error('no OK button');
  return found;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the Vue Paragraph dialog', () => {
  test('is reachable from the line-spacing menu, not only as a bare component', async () => {
    // The capability shipped React-only once: the component existed and nothing in the Vue
    // chrome opened it. This asserts the ROUTE, which is the part that went missing.
    const source = await Bun.file(
      new URL('../src/editor/toolbar/LineSpacing.tsx', import.meta.url)
    ).text();
    expect(source).toContain('lineSpacing.options');
    // The row asks the host for the dialog rather than mounting it: the part moves between
    // the bar and the overflow panel, and a dialog mounted inside it went with it mid-edit.
    expect(source).toContain('useParagraphDialog');
    expect(source).toContain("paragraphDialog?.open(");
  });

  test('seeds every field from the live selection when it opens', async () => {
    const { container, app, open, editor } = mountDialog(
      p('alpha', '<w:spacing w:before="240" w:after="120"/><w:ind w:left="720"/>')
    );
    try {
      await flush();
      editor().surface!.selectAll();
      // Separate ticks, as a user has: select, then reach for the menu. The engine defers
      // its change notification, so the composable's slice lands on the tick after.
      await flush();
      open.value = true;
      await flush();

      expect((field(container, 'Before') as HTMLInputElement).value).toBe('12');
      expect((field(container, 'After') as HTMLInputElement).value).toBe('6');
      expect((field(container, 'Before text') as HTMLInputElement).value).toBe('0.5');
    } finally {
      app.unmount();
    }
  });

  test('a setting the selection disagrees about is indeterminate, and survives OK', async () => {
    const { container, app, open, editor } = mountDialog(p('one', '<w:keepNext/>') + p('two'));
    try {
      await flush();
      editor().surface!.selectAll();
      // Separate ticks, as a user has: select, then reach for the menu. The engine defers
      // its change notification, so the composable's slice lands on the tick after.
      await flush();
      open.value = true;
      await flush();

      expect(flagsOf(editor()).keepNext).toBeNull();
      const box = checkboxFor(container, 'Keep with next');
      // Indeterminate, NOT unchecked — unchecked would claim the paragraphs agree it is off.
      expect(box.indeterminate).toBe(true);

      okButton(container).click();
      await flush();
      // Untouched, so not written: an untouched field is not a decision.
      expect(flagsOf(editor()).keepNext).toBeNull();
    } finally {
      app.unmount();
    }
  });

  test('opens focused, so Escape closes it without the user tabbing in first', async () => {
    // Escape is bound on the overlay, so it only fires once focus is inside the dialog.
    // A dialog that opens with focus left on the document cannot be dismissed by keyboard.
    const { container, app, open, editor } = mountDialog(p('alpha'));
    try {
      await flush();
      editor().surface!.selectAll();
      await flush();
      open.value = true;
      await flush();

      const panel = container.querySelector('[role="dialog"]');
      expect(panel).not.toBeNull();
      expect(document.activeElement === panel || panel!.contains(document.activeElement)).toBe(
        true
      );

      panel!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      await flush();
      expect(open.value).toBe(false);
    } finally {
      app.unmount();
    }
  });

  test('every mixed field can actually be RESOLVED, not just shown as mixed', async () => {
    // Vue had tests that a mixed field survives an untouched OK, and none that resolving
    // one writes. A missing `resolve('lineSpacing')` on the rule select therefore shipped:
    // the select snapped back to blank, the value box stayed disabled, and a mixed line
    // spacing could not be corrected at all. React had the same case covered; the mirror
    // check does not compare the two dialogs, only the shared module.
    const { container, app, open, editor } = mountDialog(
      p('one', '<w:jc w:val="right"/><w:spacing w:line="400" w:lineRule="exact"/>') +
        p('two', '<w:jc w:val="left"/><w:spacing w:line="280" w:lineRule="exact"/>')
    );
    try {
      await flush();
      editor().surface!.selectAll();
      await flush();
      open.value = true;
      await flush();

      const alignment = field(container, 'Alignment') as HTMLSelectElement;
      const rule = field(container, 'Line spacing') as HTMLSelectElement;
      const at = field(container, 'At') as HTMLInputElement;
      expect(alignment.value).toBe('');
      expect(rule.value).toBe('');
      // Locked until a rule says what a number in it would mean.
      expect(at.disabled).toBe(true);

      const pick = (node: HTMLSelectElement, value: string) => {
        node.value = value;
        node.dispatchEvent(new Event('change', { bubbles: true }));
      };
      pick(alignment, 'center');
      pick(rule, 'exact');
      await flush();
      // The rule was accepted, which is the half that was broken.
      expect(rule.value).toBe('exact');
      expect(at.disabled).toBe(false);

      at.value = '16';
      at.dispatchEvent(new Event('input', { bubbles: true }));
      at.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();

      okButton(container).click();
      await flush();

      const formatting = editor().snapshot().formatting;
      expect(formatting?.alignment).toBe('center');
      // POINTS, not sixteen line-heights.
      expect(formatting?.lineSpacing).toEqual({ rule: 'exact', value: 16 });
    } finally {
      app.unmount();
    }
  });

  test('a changed field is written, and only that field', async () => {
    const { container, app, open, editor } = mountDialog(p('alpha'));
    try {
      await flush();
      editor().surface!.selectAll();
      // Separate ticks, as a user has: select, then reach for the menu. The engine defers
      // its change notification, so the composable's slice lands on the tick after.
      await flush();
      open.value = true;
      await flush();

      const before = field(container, 'Before') as HTMLInputElement;
      before.value = '18';
      before.dispatchEvent(new Event('input', { bubbles: true }));
      before.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();

      okButton(container).click();
      await flush();

      const formatting = editor().snapshot().formatting;
      expect(formatting?.spaceBeforePt).toBe(18);
      // The line spacing the box merely SHOWED was never authored, so the paragraph still
      // takes it from the cascade rather than carrying a value of its own.
      expect(formatting?.lineSpacing ?? null).toBeNull();
    } finally {
      app.unmount();
    }
  });
});
