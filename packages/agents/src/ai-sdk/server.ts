/**
 * Vercel AI SDK adapter (server side) — opt-in.
 *
 * The core toolkit is runtime-agnostic. Use this entry only if you're
 * wiring `streamText` / `generateText` from `ai` in your route handler.
 * For LangChain / Anthropic SDK / OpenAI direct, import
 * `getToolSchemas` from `@eigenpal/docx-editor-agents/server` and
 * shape it however your runtime expects.
 *
 * @example
 * ```ts
 * import { getAiSdkTools } from '@eigenpal/docx-editor-agents/ai-sdk/server';
 * import { streamText, stepCountIs, convertToModelMessages } from 'ai';
 *
 * const tools = getAiSdkTools();
 *
 * export async function POST(req: Request) {
 *   const { messages } = await req.json();
 *   const result = streamText({
 *     model: 'openai/gpt-4o',
 *     messages: await convertToModelMessages(messages),
 *     tools,
 *     stopWhen: stepCountIs(12),
 *   });
 *   return result.toUIMessageStreamResponse();
 * }
 * ```
 */

import { jsonSchema, type Tool } from 'ai';
import { agentTools } from '../tools';

/**
 * Get tool schemas in Vercel AI SDK shape (`{ [name]: Tool }`). Pass
 * directly to `streamText({ tools })`. No `execute` is set, so AI SDK
 * forwards each tool call to the client's `useChat({ onToolCall })`
 * handler — wire that to `useDocxAgentTools().executeToolCall` from
 * `@eigenpal/docx-editor-agents/ai-sdk/react` or
 * `@eigenpal/docx-editor-agents/react`.
 */
export function getAiSdkTools(): Record<string, Tool> {
  return Object.fromEntries(
    agentTools.map((t) => [
      t.name,
      {
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
      } satisfies Tool,
    ])
  );
}
