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
        content: `You are a brutally honest document reviewer with a sharp wit. Roast the document — point out issues, weak phrasing, and suggest improvements while being entertaining.

Return JSON:
{
  "comments": [{ "paragraphIndex": <number>, "text": "<your comment>" }],
  "replacements": [{ "paragraphIndex": <number>, "search": "<short phrase to find>", "replaceWith": "<better text>" }]
}

Rules:
- At least 4 comments and 2 replacements, spread across the document
- paragraphIndex must match a [number] from the document
- Comments anchor to the whole paragraph — just specify the index
- For replacements, "search" is a SHORT phrase (3-8 words) from that paragraph. Do NOT copy entire sentences.
- Be funny AND constructive${existingChanges.length > 0 ? '\n- Comment on at least one existing tracked change' : ''}`,
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

  const text = response.choices[0]?.message?.content || '';
  let actions: {
    comments?: { paragraphIndex: number; text: string }[];
    replacements?: { paragraphIndex: number; search: string; replaceWith: string }[];
  };
  try {
    actions = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 });
  }

  // Apply — author is already set on the reviewer, no need to repeat it
  const result = reviewer.applyReview({
    comments: actions.comments,
    proposals: actions.replacements,
  });

  if (result.errors.length > 0) {
    console.warn('Roast errors:', JSON.stringify(result.errors, null, 2));
  }

  const output = await reviewer.toBuffer();
  return new NextResponse(output, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="roasted-${file.name}"`,
      'X-Roast-Stats': JSON.stringify({
        commentsAdded: result.commentsAdded,
        proposalsAdded: result.proposalsAdded,
        errors: result.errors.length,
      }),
    },
  });
}
