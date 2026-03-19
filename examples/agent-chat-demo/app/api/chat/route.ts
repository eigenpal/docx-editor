/**
 * Chat API route — thin proxy to OpenAI.
 *
 * Does NOT touch the document. Tool definitions are passed to OpenAI,
 * but tool execution happens on the client via the EditorBridge.
 *
 * Flow:
 * 1. Client sends { messages, tools } to this route
 * 2. Route calls OpenAI with the tools
 * 3. If OpenAI returns tool_calls, route returns them to the client
 * 4. Client executes tools via EditorBridge, sends results back
 * 5. Repeat until OpenAI returns text
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

function getClient() {
  return new OpenAI();
}
const model = process.env.OPENAI_MODEL || 'gpt-4o';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, tools } = body as {
      messages: ChatCompletionMessageParam[];
      tools: ChatCompletionTool[];
    };

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    const openai = getClient();
    const response = await openai.chat.completions.create({
      model,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
    });

    const choice = response.choices[0];
    if (!choice) {
      return NextResponse.json({ error: 'Empty response from AI' }, { status: 502 });
    }

    return NextResponse.json({
      message: choice.message,
      finishReason: choice.finish_reason,
    });
  } catch (err) {
    console.error('Chat API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
