/**
 * Server entry — for API routes / Node.js / serverless / Workers.
 *
 * Import the toolkit here without pulling React peer deps. Use this in your
 * Next.js route, FastAPI bridge, Cloudflare Worker, or any other backend
 * that streams an LLM call with tool definitions.
 *
 * @example
 * ```ts
 * import { getToolSchemas } from '@eigenpal/docx-editor-agents/server';
 * import { streamText, jsonSchema, convertToModelMessages } from 'ai';
 *
 * // `getToolSchemas()` returns OpenAI function-calling format. For Vercel
 * // AI SDK v5, adapt to `{ [name]: { description, inputSchema } }` once.
 * const tools = Object.fromEntries(
 *   getToolSchemas().map((s) => [
 *     s.function.name,
 *     { description: s.function.description, inputSchema: jsonSchema(s.function.parameters as never) },
 *   ])
 * );
 *
 * export async function POST(req: Request) {
 *   const { messages } = await req.json();
 *   const result = streamText({ model: 'openai/gpt-4o', messages: convertToModelMessages(messages), tools });
 *   return result.toUIMessageStreamResponse();
 * }
 * ```
 */

export {
  agentTools as docxAgentTools,
  getToolSchemas,
  executeToolCall,
  getToolDisplayName,
} from './tools';
export type { AgentToolDefinition, AgentToolResult } from './tools';

// Headless reviewer + bridge — same toolkit, no live editor.
export { DocxReviewer } from './DocxReviewer';
export { createReviewerBridge } from './reviewerBridge';

// Bridge / EditorBridge type — required to type a custom bridge for tools.
export type { EditorBridge } from './bridge';

// Context snapshot — type the request body coming from the client when
// using `useDocxAgentTools().getContext()`.
export type { AgentContextSnapshot, SelectionInfo } from './types';
