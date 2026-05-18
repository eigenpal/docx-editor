/**
 * Framework-agnostic Vercel AI SDK adapter logic. The React and Vue
 * subpaths re-export from here so consumers don't have to import a
 * cross-framework path.
 */

import type { AgentMessage, AgentToolCall } from '../agent-types';

/** Minimal structural shape of a Vercel AI SDK `UIMessage`. */
export interface AiSdkUIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts?: ReadonlyArray<{
    type: string;
    text?: string;
    toolCallId?: string;
    state?: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
  }>;
}

/**
 * Adapt AI SDK's `UIMessage[]` (from `useChat`) to the `AgentMessage[]`
 * shape `<AgentChatLog>` consumes.
 *
 * @param uiMessages - the `messages` array from `useChat`
 * @param status - the `status` from `useChat`. The last assistant
 *   message is marked `streaming` while the chat is still in flight.
 */
export function toAgentMessages(
  uiMessages: ReadonlyArray<AiSdkUIMessage>,
  status: string
): AgentMessage[] {
  return uiMessages.map((m, i) => {
    let text = '';
    const toolCalls: AgentToolCall[] = [];
    for (const part of m.parts ?? []) {
      if (part.type === 'text') {
        text += part.text ?? '';
      } else if (part.type.startsWith('tool-')) {
        const callStatus: AgentToolCall['status'] =
          part.state === 'output-available'
            ? 'done'
            : part.state === 'output-error'
              ? 'error'
              : 'running';
        toolCalls.push({
          id: part.toolCallId ?? `${m.id}-tc-${toolCalls.length}`,
          name: part.type.slice('tool-'.length),
          input: part.input,
          result: typeof part.output === 'string' ? part.output : undefined,
          error: part.errorText,
          status: callStatus,
        });
      }
    }
    const isLast = i === uiMessages.length - 1;
    const isStreaming =
      m.role === 'assistant' && isLast && (status === 'streaming' || status === 'submitted');
    return {
      id: m.id,
      role: m.role === 'user' ? 'user' : 'assistant',
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      status: isStreaming ? 'streaming' : 'done',
    };
  });
}
