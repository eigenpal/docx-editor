/**
 * The model call. Everything document-shaped happens in the browser.
 *
 * Vercel AI SDK + OpenAI. The tool catalog is the app's own
 * (`app/agent/tools.ts`), because `@docx-editor.dev/editor-api` deliberately
 * ships no model integration. Tokens stream out through
 * `toUIMessageStreamResponse()`; tool calls are forwarded to the client and run
 * against the live editor there.
 */

import { NextRequest } from 'next/server';
import { streamText, type UIMessage, convertToModelMessages, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { AGENT_TOOLS, formatContext, type AgentContextSnapshot } from '../../agent/tools';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SYSTEM_PROMPT = `You are a brutally honest but constructive editor reviewing the user's document. Pick the worst offenders (repetition, weasel words, throat-clearing intros, vague nouns, passive voice, jargon, mixed metaphors) and land a witty roast, then point at the fix in one short sentence.

Stay in your lane:
 - You are READ + COMMENT only. Do not edit text.
 - HARD LIMIT: leave AT MOST 5 comments per turn, IDEALLY 3-5. Never more than 7. Quality over carpet-bombing.
 - One comment per paragraph at most. Anchor each to a unique phrase from that paragraph (the \`search\` arg) so the marker lands on the offending words, not the whole block.

Workflow:
 1. Call read_document once.
 2. Pick the 3-5 paragraphs with the most material to roast. Skip the rest entirely.
 3. Call add_comment for each pick with the paragraph's id + a short \`search\` phrase + your one-liner.
 4. After the rounds, write a one-paragraph chat summary that names the recurring patterns you saw.

Anchoring rules (these decide whether a comment lands at all):
 - \`search\` must be copied VERBATIM out of the text read_document gave you for that paragraph. Do not paraphrase, re-case, or fix its punctuation.
 - Pick a phrase that occurs once in that paragraph. If a tool call comes back saying the phrase was not found or was ambiguous, retry that one comment with a longer, more distinctive phrase.

Tone:
 - Witty, specific, never mean. "This sentence is doing three jobs and only two of them are paid" is great. "This is bad" is not.
 - Cite the exact words you're roasting in quotes.
 - Keep each comment under 25 words.`;

// The browser can reach this route from anywhere unless you say otherwise, and
// it spends your API key. Set ALLOWED_ORIGINS on anything that is not localhost.
// A real deployment wants a rate limit here too.
function isAllowedOrigin(origin: string | null): boolean {
  const allowList = process.env.ALLOWED_ORIGINS;
  if (!allowList) return true;
  if (!origin) return false;
  return allowList
    .split(',')
    .map((o) => o.trim())
    .includes(origin);
}

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: 'OPENAI_API_KEY is not set' }, { status: 503 });
  }
  if (!isAllowedOrigin(request.headers.get('origin'))) {
    return new Response('Origin not allowed', { status: 403 });
  }

  const { messages, context } = (await request.json()) as {
    messages: UIMessage[];
    context?: AgentContextSnapshot;
  };

  const result = streamText({
    model: openai(process.env.OPENAI_MODEL || 'gpt-5.4-mini'),
    system: SYSTEM_PROMPT + formatContext(context),
    messages: await convertToModelMessages(messages),
    // No `execute` on any tool, so the SDK forwards each call to the client's
    // `useChat({ onToolCall })` instead of running it here.
    tools: AGENT_TOOLS,
    // The SDK defaults to a single step. Without this the model never gets to
    // read its own tool results and write a final reply. 12 lets it go
    // read -> comment batch -> summarise without running away.
    stopWhen: stepCountIs(12),
    abortSignal: request.signal,
  });

  return result.toUIMessageStreamResponse();
}
