/**
 * Agent tool definitions and execution.
 *
 * Tools use OpenAI function-calling format. The pattern mirrors Word's JS API:
 * locate first (`read_document` / `find_text` / `read_selection` return paraId
 * handles), then mutate (`comment` / `suggest_change` / `reply_comment` /
 * `resolve_comment` / `scroll`). paraId anchors are stable across edits.
 */

export type { AgentToolDefinition, AgentToolResult } from './types';
import type { AgentToolDefinition, AgentToolResult } from './types';
import type { EditorBridge } from '../bridge';

// ── Locate tools ────────────────────────────────────────────────────────────

const readDocument: AgentToolDefinition<{ fromIndex?: number; toIndex?: number }> = {
  name: 'read_document',
  description:
    'Read the document content. Returns lines tagged with a stable paragraph id, e.g. ' +
    '"[2A1F3B] First paragraph". Use the bracketed id as `paraId` when commenting or ' +
    'suggesting changes — it survives edits, unlike ordinal indices. Tracked changes ' +
    'and comment markers are stripped; use read_comments / read_changes to inspect them.',
  inputSchema: {
    type: 'object',
    properties: {
      fromIndex: { type: 'number', description: 'Start ordinal index (inclusive). Optional.' },
      toIndex: { type: 'number', description: 'End ordinal index (inclusive). Optional.' },
    },
  },
  handler: (input, bridge) => {
    const text = bridge.getContentAsText({
      fromIndex: input.fromIndex,
      toIndex: input.toIndex,
      includeTrackedChanges: false,
      includeCommentAnchors: false,
    });
    return { success: true, data: text };
  },
};

const readSelection: AgentToolDefinition = {
  name: 'read_selection',
  description:
    "Read the user's current cursor or selection. Returns the selected text, the " +
    "paragraph it lives in, and that paragraph's `paraId`. Use this when the user " +
    'asks "fix this" or "review what I have selected".',
  inputSchema: { type: 'object', properties: {} },
  handler: (_input, bridge) => {
    const sel = bridge.getSelection();
    if (!sel) return { success: false, error: 'No selection (editor not focused).' };
    return { success: true, data: sel };
  },
};

const findText: AgentToolDefinition<{
  query: string;
  caseSensitive?: boolean;
  limit?: number;
}> = {
  name: 'find_text',
  description:
    'Locate paragraphs containing `query`. Returns up to `limit` handles, each with ' +
    '`paraId`, the matched substring, and surrounding context. Pass any returned ' +
    '`paraId` (and the `match` as `search`) to add_comment / suggest_change.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text to find (substring match).' },
      caseSensitive: { type: 'boolean', description: 'Default: false.' },
      limit: { type: 'number', description: 'Max paragraphs to return. Default: 20.' },
    },
    required: ['query'],
  },
  handler: (input, bridge) => {
    const matches = bridge.findText(input.query, {
      caseSensitive: input.caseSensitive,
      limit: input.limit,
    });
    if (matches.length === 0) return { success: true, data: 'No matches.' };
    return { success: true, data: matches };
  },
};

const readComments: AgentToolDefinition = {
  name: 'read_comments',
  description: 'List all comments in the document with their paragraph anchors.',
  inputSchema: { type: 'object', properties: {} },
  handler: (_input, bridge) => {
    const comments = bridge.getComments();
    if (comments.length === 0) return { success: true, data: 'No comments.' };
    const text = comments
      .map(
        (c) =>
          `[Comment #${c.id}] ${c.author}: "${c.text}"` +
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
  description: 'List tracked changes (insertions / deletions) currently in the document.',
  inputSchema: { type: 'object', properties: {} },
  handler: (_input, bridge) => {
    const changes = bridge.getChanges();
    if (changes.length === 0) return { success: true, data: 'No tracked changes.' };
    const text = changes
      .map((c) => `[Change #${c.id}] ${c.type} by ${c.author}: "${c.text}"`)
      .join('\n');
    return { success: true, data: text };
  },
};

// ── Mutate tools ────────────────────────────────────────────────────────────

const addComment: AgentToolDefinition<{
  paraId: string;
  text: string;
  search?: string;
}> = {
  name: 'add_comment',
  description:
    'Attach a comment to a paragraph, optionally anchored to a unique phrase within ' +
    'it. The user sees it instantly in the comments sidebar.',
  inputSchema: {
    type: 'object',
    properties: {
      paraId: { type: 'string', description: 'Paragraph id from read_document / find_text.' },
      text: { type: 'string', description: 'Comment body.' },
      search: {
        type: 'string',
        description: 'Optional: anchor to this exact phrase within the paragraph. Must be unique.',
      },
    },
    required: ['paraId', 'text'],
  },
  handler: (input, bridge) => {
    const id = bridge.addComment({
      paraId: input.paraId,
      text: input.text,
      search: input.search,
    });
    if (id === null) {
      return {
        success: false,
        error:
          'Could not add comment. The paraId may not exist, or `search` is missing / ambiguous.',
      };
    }
    return { success: true, data: `Comment ${id} added on ${input.paraId}.` };
  },
};

const suggestChange: AgentToolDefinition<{
  paraId: string;
  search: string;
  replaceWith: string;
}> = {
  name: 'suggest_change',
  description:
    'Suggest a tracked change. Three modes: ' +
    '(1) replacement — `search` non-empty, `replaceWith` non-empty; ' +
    '(2) deletion — `search` non-empty, `replaceWith` empty; ' +
    '(3) insertion at paragraph end — `search` empty, `replaceWith` non-empty. ' +
    'The user can accept or reject in the editor UI.',
  inputSchema: {
    type: 'object',
    properties: {
      paraId: { type: 'string', description: 'Paragraph id from read_document / find_text.' },
      search: {
        type: 'string',
        description: 'Phrase to find (must be unique). Empty string = insert at paragraph end.',
      },
      replaceWith: {
        type: 'string',
        description: 'Replacement text. Empty string = delete the matched phrase.',
      },
    },
    required: ['paraId', 'search', 'replaceWith'],
  },
  handler: (input, bridge) => {
    const ok = bridge.proposeChange({
      paraId: input.paraId,
      search: input.search,
      replaceWith: input.replaceWith,
    });
    if (!ok) {
      return {
        success: false,
        error:
          'Could not propose change. Possible causes: paraId not found; search missing or ' +
          'ambiguous; or the target overlaps an existing tracked change.',
      };
    }
    if (!input.search) return { success: true, data: `Insertion proposed on ${input.paraId}.` };
    if (!input.replaceWith) {
      return { success: true, data: `Deletion proposed: "${input.search}" on ${input.paraId}.` };
    }
    return {
      success: true,
      data: `Replacement proposed: "${input.search}" → "${input.replaceWith}" on ${input.paraId}.`,
    };
  },
};

const replyComment: AgentToolDefinition<{ commentId: number; text: string }> = {
  name: 'reply_comment',
  description: 'Reply to an existing comment by id. Threaded under the original.',
  inputSchema: {
    type: 'object',
    properties: {
      commentId: { type: 'number', description: 'Comment id from read_comments.' },
      text: { type: 'string', description: 'Reply body.' },
    },
    required: ['commentId', 'text'],
  },
  handler: (input, bridge) => {
    const id = bridge.replyTo(input.commentId, { text: input.text });
    if (id === null) return { success: false, error: `Comment #${input.commentId} not found.` };
    return { success: true, data: `Reply ${id} added to comment ${input.commentId}.` };
  },
};

const resolveComment: AgentToolDefinition<{ commentId: number }> = {
  name: 'resolve_comment',
  description: 'Mark a comment as resolved (done).',
  inputSchema: {
    type: 'object',
    properties: {
      commentId: { type: 'number', description: 'Comment id from read_comments.' },
    },
    required: ['commentId'],
  },
  handler: (input, bridge) => {
    bridge.resolveComment(input.commentId);
    return { success: true, data: `Comment ${input.commentId} resolved.` };
  },
};

// ── Navigate ────────────────────────────────────────────────────────────────

const scroll: AgentToolDefinition<{ paraId: string }> = {
  name: 'scroll',
  description: "Scroll the editor to a paragraph by paraId. Does not move the user's cursor.",
  inputSchema: {
    type: 'object',
    properties: {
      paraId: { type: 'string', description: 'Paragraph id from read_document / find_text.' },
    },
    required: ['paraId'],
  },
  handler: (input, bridge) => {
    const ok = bridge.scrollTo(input.paraId);
    if (!ok) return { success: false, error: `paraId ${input.paraId} not found.` };
    return { success: true, data: `Scrolled to ${input.paraId}.` };
  },
};

// ── Registry ────────────────────────────────────────────────────────────────

/** All built-in agent tools. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const agentTools: AgentToolDefinition<any>[] = [
  readDocument,
  readSelection,
  findText,
  readComments,
  readChanges,
  addComment,
  suggestChange,
  replyComment,
  resolveComment,
  scroll,
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
 * Works directly with OpenAI SDK; Anthropic and Vercel AI SDK both accept this shape.
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
