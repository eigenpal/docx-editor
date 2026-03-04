/**
 * Page Break Extension — block node representing a DOCX page break
 */

import { createNodeExtension } from '../create';

export const PageBreakExtension = createNodeExtension({
  name: 'pageBreak',
  schemaNodeName: 'pageBreak',
  nodeSpec: {
    group: 'block',
    atom: true,
    selectable: true,
    parseDOM: [{ tag: 'div.docx-page-break' }],
    toDOM() {
      return ['div', { class: 'docx-page-break' }];
    },
  },
});
