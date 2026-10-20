import '../../../packages/react/test/dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import type { CollaborationFailure } from '@docx-editor.dev/core/collaboration';
import { DocxEditor } from '@docx-editor.dev/react';
import { exampleText } from '../../shared/example-text';
import { CollaborationControl, type CollaborationControlProps } from './CollaborationDemo';

const testWindow = window as unknown as {
  readonly happyDOM: { setURL(url: string): void };
};
const ROOM_ID = 'room-for-collaboration-test';
const INITIAL_URL = `http://localhost:5173/?room=${ROOM_ID}&keep=1#keep`;
const NAME_KEY = 'docx-editor-collaboration-name';
let previousURL: string;
let previousName: string | null;

beforeEach(() => {
  previousURL = location.href;
  previousName = localStorage.getItem(NAME_KEY);
  testWindow.happyDOM.setURL(INITIAL_URL);
});

afterEach(() => {
  cleanup();
  testWindow.happyDOM.setURL(previousURL);
  if (previousName === null) localStorage.removeItem(NAME_KEY);
  else localStorage.setItem(NAME_KEY, previousName);
});

function mountControl(failure: CollaborationFailure | null) {
  const connect = mock<CollaborationControlProps['connect']>(async () => failure);
  const container = document.createElement('div');
  container.className = 'demo-app';
  document.body.append(container);
  const view = render(
    <DocxEditor.Root>
      <CollaborationControl session={null} pending={false} connect={connect} leave={() => {}} />
    </DocxEditor.Root>,
    { container }
  );
  return { view, connect, controls: within(container) };
}

for (const failure of [
  { code: 'transport', detail: 'The room server refused the connection.' },
  { code: 'transport' },
] satisfies readonly CollaborationFailure[]) {
  test(`resolved connection failure preserves the room URL (${failure.detail ?? 'no detail'})`, async () => {
    const { view, connect, controls } = mountControl(failure);
    const initialURL = location.href;

    await act(async () => {
      fireEvent.click(
        controls.getByRole('button', { name: exampleText('collaborationDemo.join') })
      );
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect.mock.calls[0]?.[0].roomId).toBe(ROOM_ID);
    expect(controls.getByRole('alert').textContent).toBe(
      failure.detail ?? exampleText('collaborationDemo.connectFailed')
    );
    expect(location.href).toBe(initialURL);
    expect(
      controls.getByRole('button', { name: exampleText('collaborationDemo.join') })
    ).toHaveProperty('disabled', false);
    view.unmount();
  });
}

test('successful connection updates the room URL without reporting an error', async () => {
  const { view, connect, controls } = mountControl(null);

  await act(async () => {
    fireEvent.click(controls.getByRole('button', { name: exampleText('collaborationDemo.join') }));
  });

  expect(connect).toHaveBeenCalledTimes(1);
  expect(connect.mock.calls[0]?.[0].bootstrap).toEqual({ kind: 'join' });
  expect(new URL(location.href).search).toBe(`?room=${ROOM_ID}`);
  expect(new URL(location.href).hash).toBe('');
  expect(controls.queryByRole('alert')).toBeNull();
  view.unmount();
});
