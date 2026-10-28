import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { createSSRApp, h, type App } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorHyperLink } from '../src/editor/DocxEditorHyperLink';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { SOURCE, flush } from './helpers/fixtures';
import { mountEditorTree, type MountedEditor } from './helpers/mount';

const platformDescriptor = Object.getOwnPropertyDescriptor(navigator, 'platform');
const agentDataDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgentData');
let mounted: MountedEditor | undefined;
let hydrated: App | undefined;
let hydrationContainer: HTMLElement | undefined;

function platform(value: string): void {
  Object.defineProperty(navigator, 'platform', { value, configurable: true });
  Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true });
}

function toolbar(t?: (key: string) => string) {
  return h(
    DocxEditorToolbar,
    { preset: false, overflow: false, t },
    { default: () => [h(DocxEditorToolbar.Bold), h(DocxEditorToolbar.Link)] }
  );
}

function tree() {
  return h(
    DocxEditorRoot,
    { document: SOURCE },
    {
      default: () => [
        toolbar(),
        h(DocxEditorViewport, null, {
          default: () => [h(DocxEditorContent), h(DocxEditorHyperLink)],
        }),
      ],
    }
  );
}

function link(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('[data-slot="text.link"]');
  if (!button) throw new Error('The named link control is missing');
  return button;
}

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  hydrated?.unmount();
  hydrated = undefined;
  hydrationContainer?.remove();
  hydrationContainer = undefined;
  if (platformDescriptor) Object.defineProperty(navigator, 'platform', platformDescriptor);
  else Reflect.deleteProperty(navigator, 'platform');
  if (agentDataDescriptor) Object.defineProperty(navigator, 'userAgentData', agentDataDescriptor);
  else Reflect.deleteProperty(navigator, 'userAgentData');
});

test('the named link control uses the same Mac modifier as ordinary buttons', async () => {
  platform('MacIntel');
  mounted = mountEditorTree(() => toolbar());
  await flush();
  expect(mounted.container.querySelector('[data-slot="text.bold"]')!.getAttribute('title')).toBe(
    'Bold (⌘+B)'
  );
  expect(link(mounted.container).getAttribute('title')).toBe('Insert link (⌘+K)');
  expect(link(mounted.container).getAttribute('aria-label')).toBe('Insert link (⌘+K)');
});

test('the named link control keeps Ctrl on Windows', async () => {
  platform('Win32');
  mounted = mountEditorTree(() => toolbar());
  await flush();
  expect(link(mounted.container).getAttribute('title')).toBe('Insert link (Ctrl+K)');
  expect(link(mounted.container).getAttribute('aria-label')).toBe('Insert link (Ctrl+K)');
});

test('the named link control normalizes the host translation', async () => {
  platform('MacIntel');
  mounted = mountEditorTree(() =>
    toolbar((key) => (key === 'formattingBar.insertLinkShortcut' ? 'Lien (Ctrl+K)' : key))
  );
  await flush();
  expect(link(mounted.container).getAttribute('title')).toBe('Lien (⌘+K)');
  expect(link(mounted.container).getAttribute('aria-label')).toBe('Lien (⌘+K)');
});

test('server markup without navigator hydrates on a Mac without mismatches', async () => {
  platform('MacIntel');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let markup: string;
  try {
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
    markup = await renderToString(createSSRApp({ render: tree }));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
  expect(markup!).toContain('aria-label="Insert link (Ctrl+K)"');
  const errors: string[] = [];
  hydrationContainer = document.createElement('div');
  hydrationContainer.innerHTML = markup!;
  document.body.append(hydrationContainer);
  hydrated = createSSRApp({ render: tree });
  hydrated.config.warnHandler = (message) => errors.push(message);
  hydrated.mount(hydrationContainer);
  await flush();
  expect(errors).toEqual([]);
  expect(link(hydrationContainer).getAttribute('title')).toBe('Insert link (⌘+K)');
  expect(link(hydrationContainer).getAttribute('aria-label')).toBe('Insert link (⌘+K)');
});
