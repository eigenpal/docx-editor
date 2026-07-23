// Minimal ProseMirror schema for the editable projection (document-engine task
// 6.2). Paragraph nodes carry the authored `semId` so forward mapping can
// preserve identity. This schema is a PROJECTION target, never canonical state.

import { Schema } from 'prosemirror-model';

export const docSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'text*',
      group: 'block',
      // The authored paragraph id, threaded through so edits keep identity.
      attrs: { semId: { default: null } },
      // toDOM lets the schema also drive a live EditorView (not just headless mapping).
      toDOM() {
        return ['p', 0];
      },
      parseDOM: [{ tag: 'p' }],
    },
    // A non-paragraph authored block (table, SDT, ...) projected READ-ONLY. It is an
    // opaque atom (no editable content, not selectable) that carries the block's authored
    // semId so the forward mapper maps it back to the exact canonical block and never
    // flattens or mutates it. Rendered as a labeled, non-editable placeholder.
    blockEmbed: {
      group: 'block',
      atom: true,
      selectable: false,
      draggable: false,
      attrs: { semId: { default: null }, kind: { default: 'block' } },
      toDOM(node) {
        return [
          'div',
          {
            class: 'docx-block-embed',
            'data-sem-id': String(node.attrs.semId ?? ''),
            'data-kind': String(node.attrs.kind ?? 'block'),
            contenteditable: 'false',
          },
          `[${String(node.attrs.kind ?? 'block')}]`,
        ];
      },
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }, { tag: 'b' }] },
    italic: { toDOM: () => ['em', 0], parseDOM: [{ tag: 'em' }, { tag: 'i' }] },
  },
});
