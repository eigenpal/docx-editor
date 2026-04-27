/**
 * /api/roast — server-side AI agent that roasts a DOCX document.
 *
 * Demo of the canonical "build your own server-side agent" pattern from
 * @eigenpal/docx-editor-agents:
 *
 *   1. Parse the uploaded DOCX into a DocxReviewer.
 *   2. Wrap it in a paraId-anchored EditorBridge via createReviewerBridge.
 *   3. Hand the bridge's tool catalog (`agentTools`) to OpenAI as function tools.
 *   4. Run a tool-call loop: the model decides which tools to call, the server
 *      dispatches them through `executeToolCall`, results feed back to the
 *      model. Loop until the model stops calling tools.
 *   5. reviewer.toBuffer() to serialize the modified DOCX.
 *
 * This is exactly the shape a customer would use to host their own MCP server,
 * minus the MCP transport — we're our own client, so we call executeToolCall
 * directly instead of going through MCP's JSON-RPC.
 *
 * Compare to @eigenpal/docx-editor-agents/mcp:
 *
 *   const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI');
 *   const bridge   = createReviewerBridge(reviewer);
 *   const server   = new McpServer(bridge);  // <-- only thing different
 *   // wire server.handle() to your transport
 *
 * Same building blocks, different transport.
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import {
  DocxReviewer,
  createReviewerBridge,
  agentTools,
  executeToolCall,
  getToolSchemas,
} from '@eigenpal/docx-editor-agents';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

const openai = new OpenAI();
const model = process.env.OPENAI_MODEL || 'gpt-4o';
const MAX_TOOL_ITERATIONS = 8;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/** Optional comma-separated origin allowlist. Unset = open (local dev). Set
 *  ALLOWED_ORIGINS in production so visitors can't drive your OpenAI key. */
function isAllowedOrigin(origin: string | null): boolean {
  const allow = process.env.ALLOWED_ORIGINS;
  if (!allow) return true;
  if (!origin) return false;
  return allow
    .split(',')
    .map((o) => o.trim())
    .includes(origin);
}

const SYSTEM_PROMPT = `You are a stand-up comedian who moonlights as a document reviewer. You've been hired to roast this document ON STAGE. Every comment should land like a punchline — sharp, surprising, and genuinely hilarious. Think John Mulaney reviewing a legal contract, or Anthony Jeselnik editing a corporate memo.

You have tools to operate on a real DOCX file in real time:
  - read_document  — get the document as paraId-tagged lines, e.g. "[2A1F3B] paragraph text"
  - find_text      — locate a specific phrase, returns paraId handles
  - add_comment    — drop a comment on a paragraph (use the [paraId] tag, NOT a number)
  - suggest_change — tracked-change replacement / deletion / insertion (one tool, three modes via empty-string semantics)
  - read_comments  — see what you've already added
  - read_changes   — see existing tracked changes from previous reviewers (riff on them!)

Roasting playbook:
  1. Call read_document FIRST to see what you're working with.
  2. Call read_changes to find existing edits — those are gold for callback jokes.
  3. Drop 4-6 comments on specific weak phrases (use search="..." to anchor to the funny part).
  4. Suggest 2-3 tracked changes — replace bad phrasing with funnier-but-actually-better wording.
  5. End with a final read_comments to verify, then stop.

Rules:
  - Every comment is a JOKE FIRST, feedback second. Use callbacks, misdirection, escalation, analogies, pop culture.
  - Anchor each comment to a SPECIFIC weak phrase (the search arg). Don't roast whole paragraphs vaguely.
  - For tracked changes, use a short unique search phrase (3-8 words). Don't copy entire sentences.
  - Imagine the document author is in the front row — roast with love.
  - Stop when you've landed 4-6 jokes. Quality over quantity.`;

interface RoastStats {
  commentsAdded: number;
  proposalsAdded: number;
  errors: number;
  toolCalls: number;
  iterations: number;
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request.headers.get('origin'))) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes; max ${MAX_UPLOAD_BYTES})` },
      { status: 413 }
    );
  }

  // 1. Parse + wrap.
  const reviewer = await DocxReviewer.fromBuffer(await file.arrayBuffer(), 'Document Roaster');
  const bridge = createReviewerBridge(reviewer);

  // 2. Build the tool catalog OpenAI sees. agentTools is the live array of
  //    every tool the bridge supports; getToolSchemas serializes them into
  //    OpenAI function-calling format.
  const tools: ChatCompletionTool[] = getToolSchemas() as ChatCompletionTool[];

  // 3. Tool-call loop. The model reads, decides what to do, calls tools, sees
  //    results, decides again, until it stops calling tools.
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Roast this document. Filename: "${file.name}".` },
  ];

  let toolCallCount = 0;
  let errorCount = 0;
  let iter = 0;

  for (iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    // Forward the request's AbortSignal so a client disconnect cancels the
    // (potentially long) OpenAI call instead of racking up cost in the
    // background.
    const response = await openai.chat.completions.create(
      { model, messages, tools },
      { signal: request.signal }
    );
    const msg = response.choices[0]?.message;
    if (!msg) {
      return NextResponse.json({ error: 'Empty AI response' }, { status: 502 });
    }

    // No more tool calls — model is done.
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      messages.push({ role: 'assistant', content: msg.content ?? '' });
      break;
    }

    // Persist the assistant message so OpenAI sees it on the next turn.
    messages.push(msg);

    // Execute every tool call the model requested.
    for (const tc of msg.tool_calls) {
      toolCallCount++;
      let args: Record<string, unknown>;
      let toolMessage: string;
      try {
        args = JSON.parse(tc.function.arguments);
        const result = executeToolCall(tc.function.name, args, bridge);
        if (!result.success) errorCount++;
        toolMessage = result.success
          ? typeof result.data === 'string'
            ? result.data
            : JSON.stringify(result.data)
          : (result.error ?? 'Unknown tool error');
      } catch (e) {
        // Malformed JSON args — tell the model so it self-corrects, instead
        // of silently feeding {} which produces a confusing handler error.
        errorCount++;
        toolMessage = `Tool arguments were not valid JSON (${
          e instanceof Error ? e.message : 'parse failed'
        }). Retry with a valid JSON object.`;
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: toolMessage,
      });
    }
  }

  // 4. Snapshot the final state and serialize.
  const commentsAdded = reviewer.getComments().length;
  const proposalsAdded = reviewer.getChanges().length;
  const stats: RoastStats = {
    commentsAdded,
    proposalsAdded,
    errors: errorCount,
    toolCalls: toolCallCount,
    iterations: iter,
  };

  if (errorCount > 0) {
    console.warn(`Roast: ${errorCount} of ${toolCallCount} tool calls failed`);
  }

  const output = await reviewer.toBuffer();
  return new NextResponse(output, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="roasted-${file.name.replace(/["\n\r]/g, '_')}"`,
      'X-Roast-Stats': JSON.stringify(stats),
      'X-Roast-Tools': JSON.stringify(agentTools.map((t) => t.name)),
    },
  });
}
