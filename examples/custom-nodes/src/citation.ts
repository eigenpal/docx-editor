/**
 * One custom node, defined once and used everywhere.
 *
 * A custom node is an inline node type YOU define — here a legal citation. It is stored as a
 * Word content control (`w:sdt`) whose `w:tag` carries the identity and the attributes, so
 * Word opens the document, shows the citation's text, and hands it back unchanged. Open the
 * saved file in Word and the citation is still there; open it here again and it is recognized
 * from the same tag.
 */

import { defineCustomNode } from '@docx-editor.dev/pro';

/**
 * The attributes a citation carries. Encoded into the tag, decoded on open.
 *
 * The index signature is what the authoring calls take: attributes are string-to-string on the
 * wire, because that is all a `w:tag` can hold.
 */
export interface CitationAttrs {
  readonly [key: string]: string;
  readonly sourceId: string;
  readonly page: string;
}

export const Citation = defineCustomNode({
  name: 'citation',
  // Claims `acme:*` tags. Pick a prefix nobody else in your documents uses.
  tagPrefix: 'acme',
  label: 'Citation',
  // Chip appearance. HOST-authored — never derived from file data.
  chrome: { color: '#7c3aed' },

  /**
   * Recognition. Runs for every inline control whose tag matches the prefix.
   *
   * `attrs` and `text` both originate in the `.docx`, which is a zip of XML whoever sent it
   * controls end to end. Treat them as untrusted: they are rendered as TEXT, never as markup,
   * and nothing here builds a URL or DOM from them. Returning null leaves the control literal.
   */
  fromDocx: ({ attrs, text }) => {
    if (!attrs['sourceId']) return null; // not one of ours after all
    return { ...attrs, label: text };
  },

  /** A card in the review sidebar for every citation in the document. */
  reviewCard: ({ attrs, text }) => ({
    title: `Citation — ${attrs['sourceId'] ?? 'unknown source'}`,
    detail: text || (attrs['label'] ?? ''),
  }),
});

/** How a citation reads in the document body. */
export function citationText(attrs: CitationAttrs): string {
  return attrs.page ? `(${attrs.sourceId}, p. ${attrs.page})` : `(${attrs.sourceId})`;
}
