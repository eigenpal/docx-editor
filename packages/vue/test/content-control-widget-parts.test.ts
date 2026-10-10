// The composable value pop-up: the packaged calendar, the checkbox pass-through, the parts
// ladder (class / hidden / asChild / data-*) and the draft composable.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import type { ContentControlWidgetSession } from '@docx-editor.dev/core/editor';
import { DocxEditorContentControlWidget } from '../src/editor/DocxEditorContentControlWidget';
import { useContentControlWidget } from '../src/editor/content-control-widget/context';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function session(
  kind: ContentControlWidgetSession['kind'],
  value: string,
  items: ContentControlWidgetSession['items'] = []
) {
  const abort = new AbortController();
  const writes: string[] = [];
  const instance: ContentControlWidgetSession = {
    controlId: 'sdt:1',
    kind,
    items,
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
  return { session: instance, abort, writes };
}

async function mount(render: () => ReturnType<typeof h> | null) {
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({ render });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await nextTick();
  return container;
}

describe('DocxEditorContentControlWidget', () => {
  test('month navigation keeps focus and closing restores the opener', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { session: date } = session('date', '2026-09-08');
    const container = await mount(() => h(DocxEditorContentControlWidget, { session: date }));
    const next = container.querySelector<HTMLButtonElement>('[data-docx-part="nextMonth"]')!;
    next.focus();
    next.click();
    await nextTick();
    expect(document.activeElement).toBe(next);
    next.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    await nextTick();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
  test('a date session renders the packaged calendar on the authored month', async () => {
    const { session: date, writes } = session('date', '2026-09-08T00:00:00Z');
    const container = await mount(() => h(DocxEditorContentControlWidget, { session: date }));
    const popup = container.querySelector<HTMLElement>('[data-docx-popup]')!;
    expect(popup.dataset.kind).toBe('date');
    expect(popup.querySelector('input[type=date]')).toBeNull();
    expect(popup.querySelector('[data-docx-part=month]')).not.toBeNull();
    expect(popup.querySelector('[data-docx-part=input]')).not.toBeNull();
    expect(popup.querySelector('[data-docx-part="title"]')?.textContent).toBe('September 2026');
    expect(popup.querySelectorAll('[data-docx-part="day"]')).toHaveLength(42);
    expect(popup.querySelectorAll('[role="row"]')).toHaveLength(6);
    expect(popup.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    expect(popup.querySelectorAll('[data-docx-part="weekdays"] > span')).toHaveLength(7);
    expect(popup.querySelector<HTMLElement>('[data-docx-part="day"]')?.dataset.iso).toBe(
      '2026-08-30'
    );
    const selected = popup.querySelector<HTMLElement>('[data-selected]')!;
    expect(selected.dataset.iso).toBe('2026-09-08');
    expect(document.activeElement).toBe(selected);

    popup.querySelector<HTMLElement>('[data-docx-part="nextMonth"]')!.click();
    await nextTick();
    expect(popup.querySelector('[data-docx-part="title"]')?.textContent).toBe('October 2026');

    popup.querySelector<HTMLElement>('[data-iso="2026-10-15"]')!.click();
    await nextTick();
    expect(writes).toEqual(['2026-10-15']);
    expect(container.querySelector('[data-docx-popup]')).toBeNull();
  });

  test('Today commits the current date and arrow keys roam across a month edge', async () => {
    const { session: date, writes } = session('date', '2026-09-01');
    const container = await mount(() => h(DocxEditorContentControlWidget, { session: date }));
    const popup = container.querySelector<HTMLElement>('[data-docx-popup]')!;
    popup
      .querySelector<HTMLElement>('[data-iso="2026-09-01"]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' })
      );
    await nextTick();
    expect(popup.querySelector('[data-docx-part="title"]')?.textContent).toBe('August 2026');
    expect(document.activeElement).toBe(popup.querySelector('[data-iso="2026-08-31"]'));

    popup.querySelector<HTMLElement>('[data-docx-part="today"]')!.click();
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate()
    ).padStart(2, '0')}`;
    expect(writes).toEqual([iso]);
  });

  test('a checkbox session applies its toggle at once and renders nothing', async () => {
    const { session: box, writes } = session('checkbox', 'false');
    const container = await mount(() => h(DocxEditorContentControlWidget, { session: box }));
    expect(container.querySelector('[data-docx-popup]')).toBeNull();
    expect(writes).toEqual(['true']);
  });

  test('a host intercepts a checkbox by rendering its own children', async () => {
    const { session: box, writes } = session('checkbox', 'true');
    const Confirm = defineComponent({
      setup() {
        // Vue composables run in setup; this is not a React hook.
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const widget = useContentControlWidget();
        return () =>
          h(
            'button',
            {
              type: 'button',
              onClick: () => widget.apply(widget.value.value === 'true' ? 'false' : 'true'),
            },
            `confirm ${widget.kind.value}`
          );
      },
    });
    const container = await mount(() =>
      h(DocxEditorContentControlWidget, { session: box }, { default: () => h(Confirm) })
    );
    expect(writes).toEqual([]);
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'confirm checkbox'
    )!;
    button.click();
    expect(writes).toEqual(['false']);
  });

  test('parts take class, data-*, hidden and asChild without losing their wiring', async () => {
    const { session: list, writes } = session('dropdown', 'b', [
      { displayText: 'Alpha', value: 'a' },
      { displayText: 'Bravo', value: 'b' },
    ]);
    const container = await mount(() =>
      h(
        DocxEditorContentControlWidget,
        { session: list, className: 'brand' },
        {
          default: () => [
            h(DocxEditorContentControlWidget.List, { class: 'brand-list', 'data-testid': 'list' }),
            h(DocxEditorContentControlWidget.Error, { hidden: true }),
            h(
              DocxEditorContentControlWidget.Cancel,
              { asChild: true },
              { default: () => h('a', { href: '#close' }, 'Close it') }
            ),
          ],
        }
      )
    );
    const popup = container.querySelector<HTMLElement>('[data-docx-popup]')!;
    expect(popup.className).toBe('docx-content-control-widget-popup brand');
    const listElement = container.querySelector<HTMLElement>('[data-testid="list"]')!;
    expect(listElement.className).toBe('docx-content-control-menu-list brand-list');
    expect(listElement.getAttribute('role')).toBe('listbox');
    const options = [...listElement.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
    ]);
    const close = [...container.querySelectorAll('a')].find(
      (node) => node.textContent === 'Close it'
    )!;
    expect(close.className).toBe('');
    expect(close.getAttribute('data-docx-part')).toBe('cancel');
    options[0]!.click();
    expect(writes).toEqual(['a']);
  });

  test('a combo box takes free text through its input and Enter', async () => {
    const { session: combo, writes } = session('comboBox', 'M', [
      { displayText: 'Small', value: 'S' },
    ]);
    const container = await mount(() => h(DocxEditorContentControlWidget, { session: combo }));
    const input = container.querySelector<HTMLInputElement>('[data-docx-part="input"]')!;
    expect(input.value).toBe('M');
    input.value = 'Extra large';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })
    );
    expect(writes).toEqual(['Extra large']);
  });
});

test('an empty gallery announces its state and takes keyboard focus', async () => {
  const current = session('buildingBlockGallery', '');
  const container = await mount(() =>
    h(DocxEditorContentControlWidget, { session: current.session })
  );
  const note = container.querySelector<HTMLElement>('[data-docx-part=empty]')!;
  expect(note.textContent).toContain('no building blocks');
  expect(document.activeElement).toBe(note);
});

test('picture reads are bounded and failures resolve false with retry feedback', async () => {
  const current = session('picture', 'drawing');
  let reads = 0;
  let writes = 0;
  let widget: ReturnType<typeof useContentControlWidget> | undefined;
  const Probe = defineComponent({
    setup() {
      // Vue composables run in setup; this is not a React hook.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      widget = useContentControlWidget();
      return () => h(DocxEditorContentControlWidget.Error);
    },
  });
  await mount(() =>
    h(
      DocxEditorContentControlWidget,
      {
        session: {
          ...current.session,
          replaceImage: async () => {
            writes++;
            return false;
          },
        },
      },
      { default: () => h(Probe) }
    )
  );
  const oversized = {
    size: 32 * 1024 * 1024 + 1,
    arrayBuffer: async () => {
      reads++;
      return new ArrayBuffer(0);
    },
  } as unknown as Blob;
  expect(await widget!.replaceImage(oversized)).toBe(false);
  expect(reads).toBe(0);
  expect(writes).toBe(0);
  const unreadable = {
    size: 2,
    arrayBuffer: async () => {
      throw new Error('read failed');
    },
  } as unknown as Blob;
  expect(await widget!.replaceImage(unreadable)).toBe(false);
  await nextTick();
  expect(widget!.refused.value).toBe(true);
});
