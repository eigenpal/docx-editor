// A RAW ProseMirror editor, for the M6K.1 differential gate.
//
// M6K.1's pass boundary is that the production surface matches raw ProseMirror for the
// declared command matrix — deletion by word and line, Enter/Shift-Enter, Select All,
// undo/redo, logical horizontal movement with every modifier. Asserting "our editor does
// something reasonable" would not catch the regression the task exists to fix, which was
// the bridge reimplementing those commands worse than PM already does.
//
// Mounted only behind `?pmref=1`, so it never ships in the normal demo. It is a
// REFERENCE, not a second editor: it holds plain paragraphs with no engine, no
// pagination, and no preservation.

import { useEffect, useRef } from 'react';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Schema } from 'prosemirror-model';
import { baseKeymap } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    text: {},
  },
  marks: {},
});

declare global {
  interface Window {
    __rawPmView?: EditorView;
    /** Body text of the reference, joined by newline — the comparison surface. */
    __rawPmText?: () => string;
    /** Head offset within its paragraph, so selection can be compared too. */
    __rawPmHead?: () => { paragraph: number; offset: number };
    /**
     * Put the caret at a KNOWN offset in a paragraph.
     *
     * A differential gate must drive both surfaces from the same place. Clicking the
     * reference lands the caret wherever the glyph run happens to fall, so a word-wise
     * delete could remove a trailing "." in one surface and a whole word in the other,
     * and the difference would read as an engine defect.
     */
    __rawPmSetHead?: (paragraph: number, offset: number) => void;
  }
}

export function RawProseMirrorReference({ paragraphs }: { readonly paragraphs: readonly string[] }) {
  const mount = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const doc = schema.node(
      'doc',
      null,
      paragraphs.map((text) => schema.node('paragraph', null, text ? [schema.text(text)] : [])),
    );
    const view = new EditorView(host, {
      state: EditorState.create({
        doc,
        plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo }), keymap(baseKeymap)],
      }),
    });
    window.__rawPmView = view;
    window.__rawPmText = () => {
      const out: string[] = [];
      view.state.doc.forEach((n) => out.push(n.textContent));
      return out.join('\n');
    };
    window.__rawPmSetHead = (paragraph, offset) => {
      let base = 0;
      view.state.doc.forEach((n, pos, i) => {
        if (i === paragraph) base = pos + 1;
      });
      const pos = Math.min(base + offset, view.state.doc.content.size - 1);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
      view.focus();
    };
    window.__rawPmHead = () => {
      const { $head } = view.state.selection;
      return { paragraph: $head.index(0), offset: $head.parentOffset };
    };
    return () => {
      view.destroy();
      delete window.__rawPmView;
      delete window.__rawPmText;
      delete window.__rawPmHead;
      delete window.__rawPmSetHead;
    };
  }, [paragraphs]);

  return <div ref={mount} data-testid="raw-pm-reference" style={{ padding: 8, minHeight: 120 }} />;
}
