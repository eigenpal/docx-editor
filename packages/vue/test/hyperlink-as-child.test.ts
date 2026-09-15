// `asChild` on a hyperlink popup part hands the element to the host.
//
// The part forwards its behavior and its own `class-name`, but never the packaged
// `docx-hyperlink-popup__*` class, so a host element styled by one class or by utility
// classes is not outranked by the packaged rules. The React twin pins the same rule in
// packages/react/test/hyperlink-popup.test.tsx.

import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, h, nextTick } from 'vue';
import { DocxEditorHyperLink } from '../src/editor/DocxEditorHyperLink';
import { HyperlinkPopupContext } from '../src/editor/useHyperlinkPopup';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Mount one part over a stub popup context, so no engine or document is needed. */
function mountPart(props: Record<string, unknown>, child?: () => unknown) {
  let unlinked = 0;
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () => h(DocxEditorHyperLink.Unlink, props, child ? { default: child } : undefined),
  });
  app.provide(HyperlinkPopupContext, {
    state: { mode: 'reading', link: null, copied: false },
    unlink: () => {
      unlinked += 1;
      return true;
    },
  } as never);
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  return { container, unlinked: () => unlinked };
}

test('asChild keeps the packaged class off the host element and the wiring on it', async () => {
  const { container, unlinked } = mountPart({ asChild: true, className: 'paired-class' }, () =>
    h('button', { class: 'brand-button' }, 'Remove')
  );
  await nextTick();
  const button = container.querySelector<HTMLButtonElement>(
    '[data-testid="hyperlink-popup-unlink"]'
  )!;
  expect(button.classList.contains('brand-button')).toBe(true);
  expect(button.classList.contains('paired-class')).toBe(true);
  expect(button.classList.contains('docx-hyperlink-popup__action')).toBe(false);
  button.click();
  await nextTick();
  expect(unlinked()).toBe(1);
});

test('asChild with no className leaves only the host element\'s own class', async () => {
  const { container } = mountPart({ asChild: true }, () =>
    h('button', { class: 'brand-button' }, 'Remove')
  );
  await nextTick();
  const button = container.querySelector<HTMLButtonElement>(
    '[data-testid="hyperlink-popup-unlink"]'
  )!;
  expect(button.className).toBe('brand-button');
});

test('without asChild the packaged part keeps its class alongside className', async () => {
  const { container } = mountPart({ className: 'paired-class' });
  await nextTick();
  const button = container.querySelector<HTMLButtonElement>(
    '[data-testid="hyperlink-popup-unlink"]'
  )!;
  expect(button.classList.contains('docx-hyperlink-popup__action')).toBe(true);
  expect(button.classList.contains('paired-class')).toBe(true);
});
