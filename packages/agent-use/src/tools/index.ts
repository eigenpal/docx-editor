/**
 * Agent tool definitions and execution.
 *
 * Tools use OpenAI function calling format (the de facto standard).
 * Works with OpenAI, Anthropic (via adapter), Vercel AI SDK, etc.
 */

export type { AgentToolDefinition, AgentToolResult } from './types';
import type { AgentToolDefinition, AgentToolResult } from './types';
import type { EditorBridge } from '../bridge';

// ── Tool definitions ────────────────────────────────────────────────────────

const readDocument: AgentToolDefinition<{ fromIndex?: number; toIndex?: number }> = {
  name: 'read_document',
  description:
    'Read the document content. Returns indexed lines like "[0] First paragraph". ' +
    'Use fromIndex/toIndex to read a specific range. Always read before commenting or suggesting changes.',
  inputSchema: {
    type: 'object',
    properties: {
      fromIndex: { type: 'number', description: 'Start paragraph index (inclusive)' },
      toIndex: { type: 'number', description: 'End paragraph index (inclusive)' },
    },
  },
  handler: (input, bridge) => {
    const text = bridge.getContentAsText({ fromIndex: input.fromIndex, toIndex: input.toIndex });
    return { success: true, data: text };
  },
};

const readComments: AgentToolDefinition = {
  name: 'read_comments',
  description: 'List all comments currently in the document.',
  inputSchema: { type: 'object', properties: {} },
  handler: (_input, bridge) => {
    const comments = bridge.getComments();
    if (comments.length === 0) return { success: true, data: 'No comments in the document.' };
    const text = comments
      .map(
        (c) =>
          `[Comment #${c.id} on paragraph ${c.paragraphIndex}] ${c.author}: "${c.text}"` +
          (c.anchoredText ? ` (anchored to: "${c.anchoredText}")` : '') +
          (c.replies.length > 0
            ? '\n' + c.replies.map((r) => `  Reply by ${r.author}: "${r.text}"`).join('\n')
            : '')
      )
      .join('\n');
    return { success: true, data: text };
  },
};

const readChanges: AgentToolDefinition = {
  name: 'read_changes',
  description: 'List all tracked changes (insertions/deletions) currently in the document.',
  inputSchema: { type: 'object', properties: {} },
  handler: (_input, bridge) => {
    const changes = bridge.getChanges();
    if (changes.length === 0) return { success: true, data: 'No tracked changes in the document.' };
    const text = changes
      .map(
        (c) =>
          `[Change #${c.id} in paragraph ${c.paragraphIndex}] ${c.type} by ${c.author}: "${c.text}"`
      )
      .join('\n');
    return { success: true, data: text };
  },
};

const addComment: AgentToolDefinition<{
  paragraphIndex: number;
  text: string;
  search?: string;
}> = {
  name: 'add_comment',
  description:
    'Add a comment to a specific paragraph. Optionally anchor it to a specific phrase using "search".',
  inputSchema: {
    type: 'object',
    properties: {
      paragraphIndex: { type: 'number', description: 'Paragraph index to comment on' },
      text: { type: 'string', description: 'Comment text' },
      search: {
        type: 'string',
        description: 'Optional: anchor the comment to this specific phrase (3-8 words)',
      },
    },
    required: ['paragraphIndex', 'text'],
  },
  handler: (input, bridge) => {
    const id = bridge.addComment({
      paragraphIndex: input.paragraphIndex,
      text: input.text,
      search: input.search,
    });
    if (id === null)
      return {
        success: false,
        error: 'Failed to add comment — paragraph not found or search text not found.',
      };
    return {
      success: true,
      data: `Comment added (id: ${id}) on paragraph ${input.paragraphIndex}.`,
    };
  },
};

const suggestReplacement: AgentToolDefinition<{
  paragraphIndex: number;
  search: string;
  replaceWith: string;
}> = {
  name: 'suggest_replacement',
  description:
    'Suggest replacing text in a paragraph. Creates a tracked change the user can accept or reject.',
  inputSchema: {
    type: 'object',
    properties: {
      paragraphIndex: { type: 'number', description: 'Paragraph index' },
      search: { type: 'string', description: 'Short phrase to find (3-8 words)' },
      replaceWith: { type: 'string', description: 'Replacement text' },
    },
    required: ['paragraphIndex', 'search', 'replaceWith'],
  },
  handler: (input, bridge) => {
    const ok = bridge.replace({
      paragraphIndex: input.paragraphIndex,
      search: input.search,
      replaceWith: input.replaceWith,
    });
    if (!ok)
      return {
        success: false,
        error: `Text "${input.search}" not found in paragraph ${input.paragraphIndex}.`,
      };
    return {
      success: true,
      data: `Tracked change created: "${input.search}" → "${input.replaceWith}"`,
    };
  },
};

const scrollTo: AgentToolDefinition<{ paragraphIndex: number }> = {
  name: 'scroll_to',
  description: 'Scroll the document to a specific paragraph.',
  inputSchema: {
    type: 'object',
    properties: {
      paragraphIndex: { type: 'number', description: 'Paragraph index to scroll to' },
    },
    required: ['paragraphIndex'],
  },
  handler: (input, bridge) => {
    bridge.scrollTo(input.paragraphIndex);
    return { success: true, data: `Scrolled to paragraph ${input.paragraphIndex}.` };
  },
};

// ── Registry ────────────────────────────────────────────────────────────────

/** All built-in agent tools. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const agentTools: AgentToolDefinition<any>[] = [
  readDocument,
  readComments,
  readChanges,
  addComment,
  suggestReplacement,
  scrollTo,
];

/**
 * Execute a tool call against an EditorBridge.
 * Returns the result (never throws).
 */
export function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  bridge: EditorBridge
): AgentToolResult {
  const tool = agentTools.find((t) => t.name === toolName);
  if (!tool) return { success: false, error: `Unknown tool: ${toolName}` };
  try {
    return tool.handler(input, bridge);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Get tool schemas in OpenAI function calling format.
 * This is the de facto standard — works with OpenAI, Vercel AI SDK,
 * and most providers (Anthropic adapters accept this format too).
 */
export function getToolSchemas() {
  return agentTools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}
