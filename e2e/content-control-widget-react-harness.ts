import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ContentControlWidgetSession } from '@docx-editor.dev/core/editor';
import { DocxEditorContentControlWidget } from '../packages/react/src/editor/DocxEditorContentControlWidget';

export function mountWidget(element: HTMLElement, session: ContentControlWidgetSession): void {
  const root = createRoot(element);
  root.render(createElement(DocxEditorContentControlWidget, { session }));
  session.signal.addEventListener(
    'abort',
    () =>
      queueMicrotask(() => {
        root.unmount();
        element.remove();
      }),
    { once: true }
  );
}
