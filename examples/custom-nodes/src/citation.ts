/**
 * One custom node, defined once and used everywhere.
 *
 * A custom node is an inline node type YOU define — here a legal citation. It is stored as a
 * Word content control (`w:sdt`) whose `w:tag` carries the identity, so Word opens the document,
 * shows the citation's text, and hands it back unchanged. Open the saved file in Word and the
 * citation is still there; open it here again and it is recognized from the same tag.
 *
 * `w:tag` caps at 64 characters, which is enough to say WHAT something is and never enough to
 * say what it holds. So the citation's own record — the pinpoint, the quoted passage — lives in
 * a PAYLOAD: a customXml data part the control binds to, written in the same transaction as the
 * control and handed back already checked against the schema below.
 */

import { defineCustomNode } from '@docx-editor.dev/pro';
import { z } from 'zod';

/**
 * What a citation carries, as an ordinary zod schema.
 *
 * Declaring it means the payload is parsed and checked ONCE, at the read boundary — a `.docx` is
 * a zip of XML whoever sent it controls, so `data.year` being a number is a fact you would
 * otherwise have to re-establish at every call site.
 */
export const CitationData = z.object({
  sourceId: z.string().min(1),
  page: z.string(),
  /** The passage itself. This is the field that could never have fitted in a tag. */
  quote: z.string().max(2000),
});
export type CitationData = z.infer<typeof CitationData>;

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

  /** The payload's shape. Checked writing it and reading it back out of a file. */
  schema: CitationData,

  /**
   * What the DOCUMENT says, derived from the payload.
   *
   * With this declared a citation has ONE representation: `insertCustomNode(editor, Citation,
   * { data })` computes the tag and the text, so the three can never disagree. The tag gets the
   * identity and nothing else — 64 characters is not a bibliography.
   */
  toDocx: (data) => ({
    attrs: { sourceId: data.sourceId },
    text: data.page ? `(${data.sourceId}, p. ${data.page})` : `(${data.sourceId})`,
  }),

  /**
   * A card in the review sidebar for every citation in the document.
   *
   * `data` is typed by the schema — and OPTIONAL, because a real document can produce a node
   * without one: no payload, a binding whose store node is missing, or a payload that failed
   * the schema. The last two report through `customNodesModule({ onDiagnostic })`.
   */
  reviewCard: ({ attrs, text, data }) => ({
    title: `Citation — ${attrs['sourceId'] ?? 'unknown source'}`,
    detail: data?.quote || text || (attrs['label'] ?? ''),
  }),
});
