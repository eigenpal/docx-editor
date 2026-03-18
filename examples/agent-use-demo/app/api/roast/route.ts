import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { DocxReviewer } from '@eigenpal/docx-editor-agents';

const openai = new OpenAI();
const model = process.env.OPENAI_MODEL || 'gpt-4o';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

  const reviewer = await DocxReviewer.fromBuffer(await file.arrayBuffer(), 'Document Roaster');

  // Read document as plain text — no JSON escaping, no quote issues
  const contentText = reviewer.getContentAsText({
    includeTrackedChanges: false,
    includeCommentAnchors: false,
  });
  const existingChanges = reviewer.getChanges();
  const existingComments = reviewer.getComments();

  const response = await openai.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a stand-up comedian who moonlights as a document reviewer. You've been hired to roast this document ON STAGE. Every comment should land like a punchline — sharp, surprising, and genuinely hilarious. Think John Mulaney reviewing a legal contract, or Anthony Jeselnik editing a corporate memo.

Return JSON:
{
  "summary": "<your opening bit — a devastating 1-2 sentence roast of the whole document, like an opening joke at a roast>",
  "comments": [{ "paragraphIndex": <number>, "text": "<your joke/roast>", "search": "<the specific phrase you're targeting>" }],
  "replacements": [{ "paragraphIndex": <number>, "search": "<short phrase to find>", "replaceWith": "<better text>" }]
}

Rules:
- "summary" is your OPENING BIT — set the tone, make the audience laugh
- At least 4 comments and 2 replacements, spread across the document
- paragraphIndex must match a [number] from the document
- ALWAYS use "search" on comments to target a SPECIFIC phrase (3-8 words) — roast the weakest words, not the whole paragraph
- For replacements, "search" is a SHORT phrase (3-8 words). Do NOT copy entire sentences.
- Every comment is a JOKE FIRST, feedback second. Use callbacks, misdirection, escalation, analogies, pop culture. No dry corporate feedback.
- Imagine the document author is in the front row — roast with love${existingChanges.length > 0 ? '\n- At least one joke about the tracked changes' : ''}`,
      },
      {
        role: 'user',
        content: `Roast this document:\n\n${contentText}${
          existingChanges.length > 0
            ? `\n\nTracked changes:\n${existingChanges.map((c) => `  [${c.paragraphIndex}] ${c.type}: "${c.text}" by ${c.author}`).join('\n')}`
            : ''
        }${
          existingComments.length > 0
            ? `\n\nComments:\n${existingComments.map((c) => `  [${c.paragraphIndex}] ${c.author}: "${c.text}"`).join('\n')}`
            : ''
        }`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) return NextResponse.json({ error: 'Empty AI response' }, { status: 502 });

  let actions: {
    summary?: string;
    comments?: { paragraphIndex: number; text: string; search?: string }[];
    replacements?: { paragraphIndex: number; search: string; replaceWith: string }[];
  };
  try {
    actions = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 });
  }

  // Validate LLM output before applying — reject malformed entries
  const validComments = (actions.comments ?? []).filter(
    (c): c is { paragraphIndex: number; text: string; search?: string } =>
      typeof c.paragraphIndex === 'number' && typeof c.text === 'string'
  );
  const validReplacements = (actions.replacements ?? []).filter(
    (r): r is { paragraphIndex: number; search: string; replaceWith: string } =>
      typeof r.paragraphIndex === 'number' &&
      typeof r.search === 'string' &&
      typeof r.replaceWith === 'string'
  );

  // Add high-level summary roast as the first comment on paragraph 0
  const allComments = [
    ...(actions.summary ? [{ paragraphIndex: 0, text: actions.summary }] : []),
    ...validComments,
  ];

  const result = reviewer.applyReview({
    comments: allComments,
    proposals: validReplacements,
  });

  if (result.errors.length > 0) {
    console.warn('Roast errors:', JSON.stringify(result.errors, null, 2));
  }

  const output = await reviewer.toBuffer();
  return new NextResponse(output, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="roasted-${file.name.replace(/["\n\r]/g, '_')}"`,
      'X-Roast-Stats': JSON.stringify({
        commentsAdded: result.commentsAdded,
        proposalsAdded: result.proposalsAdded,
        errors: result.errors.length,
      }),
    },
  });
}
