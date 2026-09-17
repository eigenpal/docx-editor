import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, h, nextTick, shallowRef, defineComponent, watch } from 'vue';
import type {
  ContentControlWidgetSession,
  InvalidTextFormFieldSession,
} from '@docx-editor.dev/core/editor';
import { DocxEditorContentControlWidget } from '../src/editor/DocxEditorContentControlWidget';
import { DocxEditorInvalidTextFormFieldDialog } from '../src/editor/DocxEditorInvalidTextFormFieldDialog';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function widget(value: string, kind: ContentControlWidgetSession['kind'] = 'date') {
  const abort = new AbortController();
  const writes: string[] = [];
  const session: ContentControlWidgetSession = {
    controlId: 'sdt:1',
    kind,
    items: [{ displayText: 'First', value: 'first' }],
    value,
    locale: 'en-US',
    anchor: null,
    signal: abort.signal,
    canApply: () => !abort.signal.aborted,
    apply: (next) => {
      writes.push(next);
      abort.abort();
      return true;
    },
    cancel: () => abort.abort(),
  };
  return { session, abort, writes };
}
test('widget normalizes authored dates and resets on a new session', async () => {
  const first = widget('2026-09-08T00:00:00Z');
  const current = shallowRef(first.session);
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () => h(DocxEditorContentControlWidget, { session: current.value }),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await nextTick();
  // The picker opens on the authored month with the authored day marked; a press on that
  // day writes the ISO date and closes the pop-up.
  expect(container.querySelector('.docx-content-control-calendar-title')?.textContent).toBe(
    'September 2026'
  );
  const selected = container.querySelector<HTMLButtonElement>('[data-selected]')!;
  expect(selected.dataset.iso).toBe('2026-09-08');
  expect(container.querySelector('input[type="date"]')).toBeNull();
  selected.click();
  await nextTick();
  expect(first.writes).toEqual(['2026-09-08']);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  current.value = widget('2026-10-01').session;
  await nextTick();
  expect(container.querySelector('.docx-content-control-calendar-title')?.textContent).toBe(
    'October 2026'
  );
  expect(container.querySelector<HTMLElement>('[data-selected]')?.dataset.iso).toBe('2026-10-01');
});

test('invalid-field acknowledgement closes the native modal synchronously before core restoration', async () => {
  const abort = new AbortController();
  let closedDuringAcknowledge = false;
  const session: InvalidTextFormFieldSession = {
    type: 'number',
    signal: abort.signal,
    cancel: () => abort.abort(),
    acknowledge: () => {
      abort.abort();
      closedDuringAcknowledge = !(container.querySelector('dialog') as HTMLDialogElement)?.open;
    },
  };
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({ render: () => h(DocxEditorInvalidTextFormFieldDialog, { session }) });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await nextTick();
  expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  (container.querySelector('button') as HTMLButtonElement).click();
  expect(closedDuringAcknowledge).toBe(true);
  await nextTick();
  expect(container.querySelector('dialog')).toBeNull();
});

for (const mode of ['native', 'custom', 'manual'] as const)
  test(`value widget ownership: ${mode}`, async () => {
    const { DocxEditorRoot } = await import('../src/editor/DocxEditorRoot');
    const { DocxEditorViewport } = await import('../src/editor/DocxEditorViewport');
    const { DocxEditorContent } = await import('../src/editor/DocxEditorContent');
    const { useDocxEditor } = await import('../src/editor/context');
    const { docx, flush } = await import('./helpers/fixtures');
    const source = docx(
      '<w:sdt><w:sdtPr><w:dropDownList><w:listItem w:displayText="One" w:value="1"/><w:listItem w:displayText="Two" w:value="2"/></w:dropDownList></w:sdtPr><w:sdtContent><w:p><w:r><w:t>One</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    let manual: ContentControlWidgetSession | undefined;
    let editor: import('@docx-editor.dev/core/editor').DocxEditorInstance | undefined;
    const Manual = defineComponent({
      setup() {
        // Vue composables run in setup; this is not a React hook.
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const owner = useDocxEditor();
        watch(
          owner,
          (instance, _old, onCleanup) => {
            if (instance)
              onCleanup(
                instance.setContentControlWidgetChrome({
                  onRequest: (session) => {
                    manual = session;
                  },
                })
              );
          },
          { immediate: true }
        );
        return () => null;
      },
    });
    const container = document.createElement('div');
    document.body.append(container);
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          {
            document: source,
            onReady: (value) => {
              editor = value as typeof editor;
            },
            popups: {
              contentControlWidget:
                mode === 'native'
                  ? undefined
                  : mode === 'manual'
                    ? false
                    : (props) => h(DocxEditorContentControlWidget, props),
            },
          },
          {
            default: () =>
              h(DocxEditorViewport, null, {
                default: () => [h(DocxEditorContent), mode === 'manual' ? h(Manual) : null],
              }),
          }
        ),
    });
    app.mount(container);
    cleanups.push(() => {
      app.unmount();
      container.remove();
    });
    await flush();
    const opener = document.createElement('button');
    opener.textContent = 'Opener';
    container.append(opener);
    opener.focus();
    const trigger = container.querySelector('[data-docx-cc-widget="dropdown"]');
    expect(trigger).not.toBeNull();
    trigger!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
      })
    );
    await flush();
    expect(container.querySelectorAll('.docx-content-control-menu').length).toBe(
      mode === 'native' ? 1 : 0
    );
    expect(container.querySelectorAll('[data-docx-popup="contentControlWidget"]').length).toBe(
      mode === 'custom' ? 1 : 0
    );
    if (mode === 'manual') {
      expect(manual).toBeDefined();
      expect(manual!.signal.aborted).toBe(false);
      expect(manual!.apply('2')).toBe(true);
      await flush();
      expect(editor!.surface!.session.bodyText()).toContain('Two');
    }
    if (mode === 'custom') {
      // Escape closes without a write and hands focus back to the opener.
      const popup = container.querySelector<HTMLElement>(
        '[data-docx-popup="contentControlWidget"]'
      )!;
      popup.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
      );
      await flush();
      expect(container.querySelector('[data-docx-popup="contentControlWidget"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
      container.querySelector('[data-docx-cc-widget="dropdown"]')!.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerId: 1,
          pointerType: 'mouse',
        })
      );
      await flush();
      // The packaged dropdown is the same list the engine paints: one option per entry, the
      // current value marked, and a press commits at once — no Apply step, as in Word.
      // Scoped to the pop-up: the painted widget button itself carries role="listbox".
      const reopened = container.querySelector<HTMLElement>(
        '[data-docx-popup="contentControlWidget"]'
      )!;
      const options = [...reopened.querySelectorAll<HTMLButtonElement>('[role="option"]')];
      expect(options.map((option) => option.textContent)).toEqual(['One', 'Two']);
      expect(options[0]!.getAttribute('aria-selected')).toBe('true');
      expect(reopened.querySelector('[role="listbox"]')!.contains(document.activeElement)).toBe(
        true
      );
      options[1]!.click();
      await flush();
      expect(editor!.surface!.session.bodyText()).toContain('Two');
      expect(container.querySelector('[data-docx-popup="contentControlWidget"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
    }
  });

test('widget cleanup preserves focus moved to an outside control', async () => {
  const { session, abort } = widget('2026-09-08');
  const container = document.createElement('div');
  const outside = document.createElement('button');
  document.body.append(container, outside);
  outside.focus();
  const app = createApp({ render: () => h(DocxEditorContentControlWidget, { session }) });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
    outside.remove();
  });
  await nextTick();
  const other = document.createElement('button');
  document.body.append(other);
  cleanups.push(() => other.remove());
  other.focus();
  abort.abort();
  await nextTick();
  expect(document.activeElement).toBe(other);
});

for (const configured of [false, true])
  test(`checkbox presses reach a renderer only through contentControlCheckbox (${configured})`, async () => {
    const { DocxEditorRoot } = await import('../src/editor/DocxEditorRoot');
    const { DocxEditorViewport } = await import('../src/editor/DocxEditorViewport');
    const { DocxEditorContent } = await import('../src/editor/DocxEditorContent');
    const { docx, flush } = await import('./helpers/fixtures');
    const source = docx(
      '<w:p><w:r><w:t xml:space="preserve">Done: </w:t></w:r><w:sdt><w:sdtPr>' +
        '<w14:checkbox xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w14:checked w14:val="0"/>' +
        '<w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>' +
        '</w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>☐</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> yes</w:t></w:r></w:p>'
    );
    const seen: ContentControlWidgetSession['kind'][] = [];
    const recorder = (props: { session: ContentControlWidgetSession }) => {
      seen.push(props.session.kind);
      return h(DocxEditorContentControlWidget, props);
    };
    const container = document.createElement('div');
    document.body.append(container);
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          {
            document: source,
            popups: {
              contentControlWidget: recorder,
              ...(configured ? { contentControlCheckbox: recorder } : {}),
            },
          },
          { default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }) }
        ),
    });
    app.mount(container);
    cleanups.push(() => {
      app.unmount();
      container.remove();
    });
    await flush();
    const widget = container.querySelector('[data-docx-cc-widget="checkbox"]');
    expect(widget).not.toBeNull();
    widget!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
      })
    );
    await flush();
    // Either way the box flips: the engine toggles it when no renderer takes the press, and
    // the packaged renderer applies the toggle at once when one does.
    expect(
      container.querySelector('[data-docx-cc-widget="checkbox"]')?.getAttribute('data-checked')
    ).toBe('true');
    // A pop-up renderer written for dropdowns never sees the checkbox session.
    expect(seen).toEqual(configured ? ['checkbox'] : []);
  });
