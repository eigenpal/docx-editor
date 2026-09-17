import { createApp, h } from 'vue';
import type { ContentControlWidgetSession } from '@docx-editor.dev/core/editor';
import { DocxEditorContentControlWidget } from '../packages/vue/src/editor/DocxEditorContentControlWidget';

export function mountWidget(element: HTMLElement, session: ContentControlWidgetSession): void {
  const app = createApp({ render: () => h(DocxEditorContentControlWidget, { session }) });
  app.mount(element);
  session.signal.addEventListener(
    'abort',
    () =>
      queueMicrotask(() => {
        app.unmount();
        element.remove();
      }),
    { once: true }
  );
}

import { createDocxEditor } from '@docx-editor.dev/core/editor';
export function mountCatalog(bytes: Uint8Array) {
  const root = document.createElement('div');
  root.className = 'docx-editor';
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  scroller.style.cssText = 'position:relative;height:100vh;overflow:auto';
  const content = document.createElement('div');
  scroller.append(content);
  root.append(scroller);
  document.body.replaceChildren(root);
  return createDocxEditor({ container: content, document: bytes, locale: 'en-US' });
}
