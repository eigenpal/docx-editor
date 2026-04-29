/**
 * Chat API route — Vercel AI SDK + OpenAI + the docx agent toolkit.
 *
 * Streams tokens token-by-token to the client via AI SDK's
 * `toUIMessageStreamResponse()`. The client uses `useChat` from
 * `@ai-sdk/react` and runs tool calls through `useDocxAgentTools` —
 * zero stream-parsing code. Pure BYOA — no library changes needed.
 */

import { NextRequest } from 'next/server';
import { streamText, type UIMessage, convertToModelMessages, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { type AgentContextSnapshot } from '@eigenpal/docx-editor-agents/server';
import { getAiSdkTools } from '@eigenpal/docx-editor-agents/ai-sdk/server';

// No `execute` → AI SDK forwards each call to the client's
// `useChat({ onToolCall })`, where it runs against the live editor via
// `useDocxAgentTools().executeToolCall`.
const aiSdkTools = getAiSdkTools();

const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

const SYSTEM_PROMPT = `You are a brutally honest but ultimately constructive editor reviewing the user's document. Think McSweeney's-meets-Strunk-and-White: pick the worst offenders and land a witty roast — repetition, weasel words, throat-clearing intros, vague nouns, passive voice, jargon, mixed metaphors — then point at the fix in one short sentence.

Stay in your lane:
 - You are READ + COMMENT only. Do not call suggest_change, apply_formatting, or set_paragraph_style. Do not edit text.
 - HARD LIMIT: leave AT MOST 5 comments per turn, IDEALLY 3–5. Never more than 7. Quality over carpet-bombing — pick the worst offenders, skip the rest. A doc with 30 paragraphs gets 5 comments, not 30.
 - One comment per paragraph at most. Anchor each to a unique phrase from that paragraph (the \`search\` arg) so the marker lands on the offending words, not the whole block.

Workflow:
 1. Call read_document once.
 2. Pick the 3–5 paragraphs with the most material to roast. Skip the rest entirely.
 3. Call add_comment for each pick with paraId + a short \`search\` phrase + your one-liner.
 4. After you've made the rounds, write a one-paragraph summary in chat that names the recurring patterns you saw (so the user gets value beyond the individual comments).

Tone:
 - Witty, specific, never mean. "This sentence is doing three jobs and only two of them are paid" is great. "This is bad" is not.
 - Cite the exact words you're roasting in quotes.
 - Keep each comment under 25 words.

You will see a CONTEXT block describing the user's current selection and page. Use it sparingly — most of your work happens against the whole document.`;

function isAllowedOrigin(origin: string | null): boolean {
  const allowList = process.env.ALLOWED_ORIGINS;
  if (!allowList) return true;
  if (!origin) return false;
  return allowList
    .split(',')
    .map((o) => o.trim())
    .includes(origin);
}

function formatContext(ctx: AgentContextSnapshot | undefined): string {
  if (!ctx) return '';
  const lines: string[] = [];
  if (ctx.totalPages) lines.push(`Document has ${ctx.totalPages} page(s).`);
  if (ctx.currentPage) lines.push(`User is viewing page ${ctx.currentPage}.`);
  const sel = ctx.selection;
  if (sel?.paraId) {
    if (sel.selectedText)
      lines.push(`User selection: "${sel.selectedText}" in paragraph ${sel.paraId}.`);
    else lines.push(`User cursor is in paragraph ${sel.paraId}.`);
  }
  return lines.length > 0 ? `\n\n[CONTEXT]\n${lines.join('\n')}` : '';
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request.headers.get('origin'))) {
    return new Response('Origin not allowed', { status: 403 });
  }

  const { messages, context } = (await request.json()) as {
    messages: UIMessage[];
    context?: AgentContextSnapshot;
  };

  const result = streamText({
    model: openai(model),
    system: SYSTEM_PROMPT + formatContext(context),
    messages: await convertToModelMessages(messages),
    tools: aiSdkTools,
    // AI SDK defaults to a single step — without this, the model never
    // gets a chance to read its own tool results and write a final reply.
    // 12 lets it read → comment-batch → summarise without runaway loops.
    stopWhen: stepCountIs(12),
  });

  return result.toUIMessageStreamResponse();
}
