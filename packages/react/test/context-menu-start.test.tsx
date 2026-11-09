// `ContextMenu.Start`: host rows that render above the packaged rows, against the real engine.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';
import { differentialDocx } from './cross-adapter-shared.ts';

const t = (key: string): string => key;

afterEach(cleanup);

test('rows inside Start render above the default set', () => {
  const view = render(
    <DocxEditorRoot document={differentialDocx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>')}>
      <DocxEditorViewport>
        <DocxEditorContent />
        <ContextMenu t={t}>
          <ContextMenu.Item label="Freeze paragraph" onSelect={() => {}} />
          <ContextMenu.Start>
            <ContextMenu.Item label="receive" onSelect={() => {}} />
            <ContextMenu.Item label="relieve" onSelect={() => {}} />
          </ContextMenu.Start>
        </ContextMenu>
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const surface = view.container.querySelector<HTMLElement>('.docx-paginated-surface');
  if (!surface) throw new Error('no painted surface');
  act(() => {
    fireEvent.contextMenu(surface, { clientX: 120, clientY: 140, button: 2 });
  });

  const labels = [...view.container.querySelectorAll('.docx-contextmenu [role="menuitem"]')].map(
    (row) => row.textContent ?? ''
  );
  expect(labels.slice(0, 2)).toEqual(['receive', 'relieve']);
  expect(labels.at(-1)).toContain('Freeze paragraph');
});
