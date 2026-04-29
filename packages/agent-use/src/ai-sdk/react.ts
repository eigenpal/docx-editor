/**
 * Vercel AI SDK adapter (React side) — opt-in.
 *
 * Use this only if you're driving the chat with `useChat` from
 * `@ai-sdk/react`. The library's `<AgentChatLog>` consumes a flat
 * `AgentMessage[]` shape; AI SDK's `useChat` produces `UIMessage[]`
 * with structured `parts`. `toAgentMessages()` is the bridge.
 */

/**
 * Local mirror of `AgentMessage` / `AgentToolCall` from
 * `@eigenpal/docx-js-editor`. Inlined here so this subpath has zero
 * runtime/type coupling to the editor package — the shapes are
 * structurally identical, so values flow either way without casting.
 */
export interface AgentToolCall {
  id: string;
  name: string;
  input?: unknown;
  result?: string;
  error?: string;
  status: 'running' | 'done' | 'error';
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: AgentToolCall[];
  status?: 'streaming' | 'done';
}

/**
 * Minimal structural shape of a Vercel AI SDK `UIMessage` — keeps the
 * `ai` package as a peer dep, not a runtime dep.
 */
interface AiSdkUIMessage {
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
 *
 * @example
 * ```tsx
 * const chat = useChat({ ... });
 * const messages = useMemo(
 *   () => toAgentMessages(chat.messages, chat.status),
 *   [chat.messages, chat.status]
 * );
 * return <AgentChatLog messages={messages} />;
 * ```
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
