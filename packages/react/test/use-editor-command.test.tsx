// `useEditorCommand` bound to a raw `EditorCommand` rather than a chrome slot.
//
// The whole point of these tests is the payload-change case. The hook memoizes its selector
// so a command object rebuilt every render does not resubscribe the store on every frame —
// and keying that memo on the command's `type` alone was wrong: two commands can share a
// type and mean different things (`mark: 'bold'` vs `'italic'`), `can`/`isActive` answer
// differently for them, and `snapshot()` is version-cached so the stale answer survived
// until some unrelated engine event bumped the version. `execute` reads the live target, so
// the control rendered one state and ran the other command.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { useState } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useEditorCommand } from '../src/editor/useEditorCommand.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
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
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold text</w:t></w:r></w:p>' +
      '</w:body></w:document>'
  ),
});

afterEach(cleanup);

/** Reads one mark's live state and exposes a control to switch which mark it reads. */
function MarkProbe({ onState }: { onState: (mark: string, active: boolean) => void }) {
  const [mark, setMark] = useState('bold');
  const { isActive } = useEditorCommand({ type: 'toggleMark', mark });
  onState(mark, isActive);
  return (
    <button type="button" data-testid="switch" onClick={() => setMark('italic')}>
      switch
    </button>
  );
}

function mount(node: React.ReactNode): {
  view: ReturnType<typeof render>;
  editor: () => DocxEditorInstance;
} {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        {node}
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

/**
 * Select the whole first paragraph, so mark state is derivable.
 *
 * `await act` rather than the sync form: `useEditorState` notifies through a DEFERRED
 * notifier, so the subscriber re-render lands a microtask after the command returns.
 */
async function selectAll(editor: DocxEditorInstance): Promise<void> {
  await act(async () => {
    editor.exec({ type: 'selectAll' });
  });
}

describe('a raw command target', () => {
  test('re-derives when the payload changes but the type does not', async () => {
    const seen: { mark: string; active: boolean }[] = [];
    const { view, editor } = mount(
      <MarkProbe onState={(mark, active) => seen.push({ mark, active })} />
    );
    await selectAll(editor());

    // The document's only run is bold and not italic.
    expect(seen.at(-1)).toEqual({ mark: 'bold', active: true });

    act(() => {
      view.getByTestId('switch').click();
    });

    // No engine event happened in between — only the payload changed. Keyed on `type` this
    // still reported `true`, i.e. "this text is italic", which it is not.
    expect(seen.at(-1)).toEqual({ mark: 'italic', active: false });
  });

  test('enabled state comes from the engine, per payload', async () => {
    let state: { isEnabled: boolean; disabledReason: string | null } | null = null;
    function Probe() {
      const { isEnabled, disabledReason } = useEditorCommand({ type: 'copy' });
      state = { isEnabled, disabledReason };
      return null;
    }
    const { editor } = mount(<Probe />);

    // Collapsed caret: the engine refuses copy, in its own words.
    expect(state!.isEnabled).toBe(false);
    expect(state!.disabledReason).toBe('nothing is selected');

    await selectAll(editor());
    expect(state!.isEnabled).toBe(true);
  });

  test('execute runs the command, can-before-exec', async () => {
    let run: (() => void) | null = null;
    function Probe() {
      const { execute } = useEditorCommand({ type: 'selectAll' });
      run = execute;
      return null;
    }
    const { editor } = mount(<Probe />);

    await act(async () => {
      run!();
    });

    expect(editor().snapshot().selectionCollapsed).toBe(false);
  });

  test('a refused command is a safe no-op rather than a throw', () => {
    let run: (() => void) | null = null;
    function Probe() {
      const { execute } = useEditorCommand({ type: 'cut' });
      run = execute;
      return null;
    }
    const { editor } = mount(<Probe />);
    const before = editor().snapshot().revision;

    // Collapsed caret: `can` says no, so `execute` must not reach `exec`.
    act(() => {
      run!();
    });

    expect(editor().snapshot().revision).toBe(before);
  });
});
