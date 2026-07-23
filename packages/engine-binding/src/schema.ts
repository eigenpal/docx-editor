// Minimal ProseMirror schema for the editable projection (document-engine task
// 6.2). Paragraph nodes carry the authored `semId` so forward mapping can
// preserve identity. This schema is a PROJECTION target, never canonical state.

import { Schema } from 'prosemirror-model';

export const docSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'text*',
      group: 'block',
      // The authored paragraph id, threaded through so edits keep identity.
      attrs: { semId: { default: null } },
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: {},
    italic: {},
  },
});
