import { NextRequest } from 'next/server';
import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import { WRITER_TOOLS } from '../../agent/tools';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SYSTEM_PROMPT = `You are a document writer working in a live DOCX editor.

Interview before writing:
- Learn the document type.
- Learn the parties or audience.
- Learn the purpose.
- Learn the jurisdiction or domain rules.
- Learn the tone.
- Learn the expected length.
- Ask concise grouped questions. Use generic placeholders. Do not request private personal data.
- Do not call create_document until all six fields have concrete answers.

Fresh document:
- Call create_document once after the interview.
- Supply a Title block, Heading 1 blocks, and Normal paragraphs.
- Include at least one bullet block and one numbered block.
- Mark at least one generic fillable field as a plain-text content control.
- The tool atomically replaces the seeded body with Body.replaceParagraphs.
- The tool also adds a header, footer, and page field.
- Section columns are unsupported. Never claim they were added.

Later revisions:
- First call read_document. It reads and searches the vanilla revision projection.
- Use only propose_replacement, propose_insertion, or propose_deletion for later text changes.
- Copy paragraph ids and anchor phrases exactly from read_document.
- Tool failures are authoritative. Correct the input or explain the exact refusal.

Visible responses:
- Show only useful interview questions, short status summaries, and final results.
- Never expose private reasoning, hidden analysis, or commentary phases.
- Keep author attribution as "Writer agent".`;

function isAllowedOrigin(origin: string | null): boolean {
  const configured = process.env.ALLOWED_ORIGINS;
  if (!configured) return true;
  if (!origin) return false;
  return configured
    .split(',')
    .map((entry) => entry.trim())
    .includes(origin);
}

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      {
        error: 'OPENAI_API_KEY is not set. The editor still works, but model chat is unavailable.',
      },
      { status: 503 }
    );
  }
  if (!isAllowedOrigin(request.headers.get('origin'))) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 });
  }

  const { messages } = (await request.json()) as { messages: UIMessage[] };
  const result = streamText({
    model: openai(process.env.OPENAI_MODEL || 'gpt-5.4-mini'),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: WRITER_TOOLS,
    stopWhen: stepCountIs(16),
    abortSignal: request.signal,
  });
  return result.toUIMessageStreamResponse();
}
