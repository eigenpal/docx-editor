/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
// `DocxEditor.OpenFailure` — the dialog for a file the editor refused to open. The twin of
// the React suite: generic message and stable code, Close and the `dismiss` event, a later
// refusal of the same bytes, the `actions` slot with `Action`, the packaged
// `openFailure` prop and `openFailureActions` slot, and `useOpenFailure`.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createCommentVNode, defineComponent, h } from 'vue';
import { strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { blankDocumentBytes } from '@docx-editor.dev/core/editor';
import type { DocumentOpenFailure } from '@docx-editor.dev/core/contracts/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorOpenFailure, useOpenFailure } from '../src/editor/DocxEditorOpenFailure';
import { useDocxEditor } from '../src/editor/context';
import { flush, mountEditorTree, mountSugarAsync, nextTick } from './helpers/mount';

const BROKEN = strToU8('not a zip');
const DIALOG = '[data-docx-dialog="openFailure"]';

afterEach(() => {
  document.body.innerHTML = '';
});

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>(DIALOG);
}

function buttons(): HTMLButtonElement[] {
  return [...dialog()!.querySelectorAll('button')];
}

async function settle(): Promise<void> {
  await flush();
  await nextTick();
}

/** Mounts `node` inside a Root on `BROKEN`, and exposes the editor. */
function mountBroken(node: () => ReturnType<typeof h>) {
  let editor: DocxEditorInstance | null = null;
  const Capture = defineComponent({
    setup() {
      const ref = useDocxEditor();
      return () => {
        if (ref.value) editor = ref.value as DocxEditorInstance;
        return null;
      };
    },
  });
  const view = mountEditorTree(() => [h(Capture), node()], BROKEN);
  return { ...view, editor: () => editor! };
}

describe('DocxEditor.OpenFailure', () => {
  test('shows nothing for a document that opens', async () => {
    mountEditorTree(() => [h(DocxEditorOpenFailure)], blankDocumentBytes());
    await settle();
    expect(dialog()).toBeNull();
  });

  test('a refused open shows the generic message and the stable code', async () => {
    mountBroken(() => h(DocxEditorOpenFailure));
    await settle();
    const el = dialog()!;
    expect(el.getAttribute('role')).toBe('alertdialog');
    expect(el.textContent).toContain('This file did not open');
    expect(el.textContent).toContain('The file is damaged.');
    expect(el.textContent).toContain('Error code: open.zip-corrupt');
    expect(el.textContent).not.toContain('@');
  });

  test('Close hides it and emits dismiss; a later refusal of the same bytes shows it again', async () => {
    const dismissed: string[] = [];
    const view = mountBroken(() =>
      h(DocxEditorOpenFailure, {
        onDismiss: (failure: DocumentOpenFailure) => dismissed.push(failure.code),
      })
    );
    await settle();
    buttons()
      .find((b) => b.textContent === 'Close')!
      .click();
    await settle();
    expect(dialog()).toBeNull();
    expect(dismissed).toEqual(['open.zip-corrupt']);

    view.editor().load(BROKEN);
    await settle();
    expect(dialog()).not.toBeNull();

    view.editor().load(blankDocumentBytes());
    await settle();
    expect(dialog()).toBeNull();
  });

  test('the actions slot adds host buttons with Action, before an outlined Close', async () => {
    const clicks: string[] = [];
    mountBroken(() =>
      h(
        DocxEditorOpenFailure,
        { closeLabel: 'Not now', showCode: false, title: 'We could not open that' },
        {
          actions: ({ failure }: { failure: DocumentOpenFailure }) => [
            h(DocxEditorOpenFailure.Action, { asChild: true }, () =>
              h('a', { href: `/help?code=${failure.code}` }, 'Get help')
            ),
            h(
              DocxEditorOpenFailure.Action,
              { variant: 'primary', dismiss: true, onClick: () => clicks.push(failure.code) },
              () => 'Report'
            ),
          ],
        }
      )
    );
    await settle();
    const el = dialog()!;
    expect(el.textContent).toContain('We could not open that');
    expect(el.textContent).not.toContain('Error code');
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/help?code=open.zip-corrupt');
    expect(el.querySelector('a')!.className).toContain('docx-dialog__button');
    expect(buttons().map((b) => b.textContent)).toEqual(['Report', 'Not now']);
    expect(buttons()[0]!.className).toContain('docx-dialog__button--primary');
    expect(buttons()[1]!.className).not.toContain('--primary');
    buttons()[0]!.click();
    await settle();
    expect(clicks).toEqual(['open.zip-corrupt']);
    expect(dialog()).toBeNull();
  });

  test('the default slot replaces the packaged content', async () => {
    mountBroken(() =>
      h(DocxEditorOpenFailure, null, {
        default: ({ message, dismiss }: { message: string; dismiss: () => void }) =>
          h('button', { type: 'button', onClick: dismiss }, message),
      })
    );
    await settle();
    expect(buttons()[0]!.textContent).toContain('The file is damaged.');
    buttons()[0]!.click();
    await settle();
    expect(dialog()).toBeNull();
  });

  test('the message describes the alert, and a backdrop click does not close it', async () => {
    mountBroken(() => h(DocxEditorOpenFailure));
    await settle();
    const el = dialog()!;
    const id = el.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)!.textContent).toContain('The file is damaged.');
    el.click();
    await settle();
    expect(dialog()).not.toBeNull();
  });

  test('an actions slot that renders nothing leaves Close as the primary button', async () => {
    mountBroken(() =>
      h(DocxEditorOpenFailure, null, { actions: () => [createCommentVNode('v-if', true)] })
    );
    await settle();
    expect(buttons()[0]!.className).toContain('--primary');
  });

  test('is reachable as a namespace static', () => {
    expect(DocxEditor.OpenFailure).toBe(DocxEditorOpenFailure);
    expect(DocxEditor.OpenFailure.Action).toBeDefined();
  });
});

describe('<DocxEditor openFailure>', () => {
  test('mounts the dialog by default, with and without chrome', async () => {
    const view = await mountSugarAsync({ document: BROKEN });
    await settle();
    expect(dialog()).not.toBeNull();
    view.unmount();
    document.body.innerHTML = '';
    await mountSugarAsync({ document: BROKEN, chrome: false });
    await settle();
    expect(dialog()).not.toBeNull();
  });

  test('passes an object through, and openFailureActions adds buttons', async () => {
    await mountSugarAsync(
      { document: BROKEN, openFailure: { title: 'Custom title' } },
      { openFailureActions: () => h('button', { type: 'button' }, 'Mine') }
    );
    await settle();
    expect(dialog()!.textContent).toContain('Custom title');
    expect(buttons().map((b) => b.textContent)).toEqual(['Mine', 'Close']);
  });

  test('openFailure false removes it', async () => {
    await mountSugarAsync({ document: BROKEN, openFailure: false });
    await settle();
    expect(dialog()).toBeNull();
  });
});

describe('useOpenFailure', () => {
  test('gives a host the failure and the packaged message for its own UI', async () => {
    const Toast = defineComponent({
      setup() {
        const { failure, message, dismiss } = useOpenFailure();
        return () =>
          failure.value
            ? h('div', { role: 'alert' }, [
                `${message.value} (${failure.value.code})`,
                h('button', { type: 'button', onClick: dismiss }, 'x'),
              ])
            : null;
      },
    });
    mountBroken(() => h(Toast));
    await settle();
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('The file is damaged.');
    expect(alert.textContent).toContain('(open.zip-corrupt)');
    alert.querySelector('button')!.click();
    await settle();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
