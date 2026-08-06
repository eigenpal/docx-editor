/**
 * Custom nodes, end to end.
 *
 * Insert a citation at the caret, see it painted as a chip, right-click it to edit, and save.
 * Open the result in Word: the citation is an ordinary content control there, so Word shows
 * its text and hands it back untouched. Reopen it here and it is recognized from the same tag.
 */

import { useCallback, useState } from 'react';
import { DocxEditor, useDocxEditor } from '@docx-editor.dev/react';
import { customNodesModule, insertCustomNode, updateCustomNode } from '@docx-editor.dev/pro';
import { CustomNodeChrome, CustomNodeContextMenu } from '@docx-editor.dev/pro/react';
import { Citation } from './citation.ts';

/**
 * Modules are read once, when the instance is built. Hoisting the array keeps that visible:
 * one rebuilt inline each render is not re-registered, it is ignored.
 */
const MODULES = [customNodesModule({ nodes: [Citation] })];

type FormState =
  | { readonly mode: 'closed' }
  | { readonly mode: 'insert' }
  | {
      readonly mode: 'edit';
      readonly nodeId: string;
      /** The node's payload, so the form starts from what the document says. */
      readonly data: unknown;
    };

export function App() {
  const [bytes, setBytes] = useState<Uint8Array>();
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

  const open = useCallback(async (file: File) => {
    setBytes(new Uint8Array(await file.arrayBuffer()));
  }, []);

  return (
    <div className="ep-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={BAR}>
        <input
          type="file"
          accept=".docx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void open(file);
          }}
        />
        <span style={{ color: '#64748b', fontSize: 13 }}>
          Open a .docx, put the caret somewhere, then insert a citation.
        </span>
      </header>

      {bytes ? (
        <DocxEditor.Root document={bytes} modules={MODULES}>
          <Toolbar onInsert={() => setForm({ mode: 'insert' })} />
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <DocxEditor.Viewport>
              <DocxEditor.Content />
              {/* Paints the chips and dispatches clicks on them. */}
              <CustomNodeChrome />
              <DocxEditor.ContextMenu>
                {/* Chips are content-locked, so the context menu is the way in. */}
                <CustomNodeContextMenu
                  onEditNode={(node) =>
                    node.nodeId
                      ? setForm({
                          mode: 'edit',
                          nodeId: node.nodeId,
                          // `unknown` here: the activation carries every definition's nodes, so
                          // the form parses it against the schema it knows.
                          data: node.data,
                        })
                      : undefined
                  }
                />
              </DocxEditor.ContextMenu>
            </DocxEditor.Viewport>
          </div>
          {/* Keyed and mounted CONDITIONALLY. A form that renders `null` when closed never
              unmounts, so `useState` keeps the first render's values — every edit opened blank
              and saved the blanks back over the citation. */}
          {form.mode !== 'closed' ? (
            <CitationForm
              key={form.mode === 'edit' ? form.nodeId : 'insert'}
              state={form}
              onClose={() => setForm({ mode: 'closed' })}
            />
          ) : null}
        </DocxEditor.Root>
      ) : (
        <p style={{ padding: 24, color: '#64748b' }}>No document open.</p>
      )}
    </div>
  );
}

function Toolbar({ onInsert }: { onInsert: () => void }) {
  const editor = useDocxEditor();
  return (
    <div style={BAR}>
      {/* Chrome mousedown must not move the caret, or the insert lands somewhere else. */}
      <button onMouseDown={(e) => e.preventDefault()} onClick={onInsert} disabled={!editor}>
        Insert citation
      </button>
      <SaveButton />
    </div>
  );
}

function SaveButton() {
  const editor = useDocxEditor();
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      disabled={!editor}
      onClick={async () => {
        const out = await editor?.save();
        if (!out) return;
        const url = URL.createObjectURL(
          new Blob([out], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          })
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = 'with-citations.docx';
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      Save .docx
    </button>
  );
}

/**
 * The host owns the form. `defineCustomNode` has no schema-driven dialog, so authoring is
 * `insertCustomNode` at the caret and `updateCustomNode` against a node id — each one
 * transaction and one undo step, payload included.
 */
function CitationForm({ state, onClose }: { state: FormState; onClose: () => void }) {
  const editor = useDocxEditor();
  const initial = (state.mode === 'edit' ? Citation.dataOf(state) : undefined) ?? {
    sourceId: '',
    page: '',
    quote: '',
  };
  const [sourceId, setSourceId] = useState(initial.sourceId);
  const [page, setPage] = useState(initial.page);
  const [quote, setQuote] = useState(initial.quote);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editor) return;
    // Only the identity goes in the tag; the record goes in the payload beside it, in the same
    // transaction, checked against the schema on the way in.
    const data = { sourceId, page, quote };
    const result =
      state.mode === 'edit'
        ? updateCustomNode(editor, Citation, state.nodeId, { data })
        : insertCustomNode(editor, Citation, { data, alias: 'Citation' });
    // Writes report refusal instead of throwing: a locked range, no caret, no document.
    if (!result.ok) {
      console.warn(`citation ${state.mode} refused: ${result.reason}`);
      return;
    }
    onClose();
  };

  return (
    <form onSubmit={submit} style={FORM} onMouseDown={(e) => e.stopPropagation()}>
      <strong>{state.mode === 'edit' ? 'Edit citation' : 'Insert citation'}</strong>
      <label style={LABEL}>
        Source
        <input value={sourceId} onChange={(e) => setSourceId(e.target.value)} required />
      </label>
      <label style={LABEL}>
        Page
        <input value={page} onChange={(e) => setPage(e.target.value)} />
      </label>
      <label style={LABEL}>
        {/* The field that could never have fitted in a 64-character tag. */}
        Quoted passage
        <textarea rows={3} value={quote} onChange={(e) => setQuote(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit">{state.mode === 'edit' ? 'Save' : 'Insert'}</button>
      </div>
    </form>
  );
}

const BAR: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: 8,
  borderBottom: '1px solid #e2e8f0',
};

const FORM: React.CSSProperties = {
  position: 'absolute',
  right: 24,
  bottom: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 16,
  width: 280,
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
};

const LABEL: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
};
