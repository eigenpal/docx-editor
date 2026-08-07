/**
 * The agent's tool catalog. One file, imported by both halves.
 *
 * `@docx-editor.dev/editor-api` ships no tool schemas on purpose: which
 * operations a model may reach, and how they are described to it, is a decision
 * about the model's interface and belongs to the app that owns the model. This
 * is that decision, kept in one place so the route (which advertises the
 * schemas) and the browser executor (which runs them) cannot drift apart.
 *
 * Every tool is declared WITHOUT an `execute`, so the AI SDK forwards the call
 * to the client, where `run-tool.ts` runs it against the editor the reader is
 * looking at.
 *
 * The catalog is also the allowlist. Roastmaster is read + comment only, so it
 * exposes no text-mutating tool at all: a model that decides to rewrite your
 * document has nothing to call, rather than merely being told not to.
 */

import { tool } from 'ai';
import { z } from 'zod';

/**
 * Paragraphs are addressed by `uniqueLocalId`, the editor-api object model's
 * own handle. It is issued by the runtime, so every paragraph has one, whether
 * or not the OOXML carried an id for it.
 */
const paragraphId = z
  .string()
  .describe("The paragraph's id, exactly as returned by read_document.");

const searchPhrase = z
  .string()
  .describe(
    'A short, VERBATIM phrase from that paragraph to anchor to. Must appear in the paragraph exactly, including case and punctuation. Keep it under 10 words so it stays unique.'
  );

export const AGENT_TOOLS = {
  read_document: tool({
    description:
      'Read the whole document as an ordered list of paragraphs, each with its id and text. Call this once at the start. Empty paragraphs are omitted.',
    inputSchema: z.object({}),
  }),

  find_text: tool({
    description:
      'Find occurrences of a phrase in the document. Returns the matching text with the id of the paragraph holding it.',
    inputSchema: z.object({
      query: z.string().describe('The text to search for.'),
      matchCase: z.boolean().optional().describe('Case-sensitive search. Defaults to false.'),
    }),
  }),

  add_comment: tool({
    description:
      'Leave a comment anchored to a phrase inside a paragraph. The phrase is selected in the document and the comment attaches to that selection, so it points at the offending words rather than the whole block.',
    inputSchema: z.object({
      paragraphId,
      search: searchPhrase,
      comment: z.string().describe('The comment text. Keep it under 25 words.'),
    }),
  }),

  read_comments: tool({
    description:
      'List the comments already on the document, with their text, author and resolved state.',
    inputSchema: z.object({}),
  }),

  reply_comment: tool({
    description: 'Reply to an existing comment thread.',
    inputSchema: z.object({
      commentId: z.string().describe("The comment's id, as returned by read_comments."),
      reply: z.string().describe('The reply text.'),
    }),
  }),

  resolve_comment: tool({
    description: 'Mark an existing comment thread as resolved.',
    inputSchema: z.object({
      commentId: z.string().describe("The comment's id, as returned by read_comments."),
    }),
  }),
} as const;

/** Chat-log labels. The raw tool name is a poor thing to show a reader. */
const TOOL_LABELS: Record<string, string> = {
  read_document: 'Reading the document',
  find_text: 'Searching the document',
  add_comment: 'Leaving a comment',
  read_comments: 'Reading comments',
  reply_comment: 'Replying to a comment',
  resolve_comment: 'Resolving a comment',
};

export function getToolDisplayName(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ');
}

/**
 * What the client sends about the reader's current view. Deliberately small: it
 * is advisory context for the prompt, not a document read.
 */
export interface AgentContextSnapshot {
  paragraphCount?: number;
}

export function formatContext(ctx: AgentContextSnapshot | undefined): string {
  if (!ctx?.paragraphCount) return '';
  return `\n\n[CONTEXT]\nDocument has ${ctx.paragraphCount} non-empty paragraph(s).`;
}
