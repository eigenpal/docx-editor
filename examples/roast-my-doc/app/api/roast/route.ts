import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { DocxReviewer } from '@eigenpal/docx-editor-agent-use';

const openai = new OpenAI();
const model = process.env.OPENAI_MODEL || 'gpt-4o';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const reviewer = await DocxReviewer.fromBuffer(buffer);

  // Step 1: Read the document
  const content = reviewer.getContent();
  const existingChanges = reviewer.getChanges();
  const existingComments = reviewer.getComments();

  // Step 2: Ask the LLM to roast it
  const response = await openai.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a brutally honest document reviewer with a sharp sense of humor. Your job is to "roast" documents — point out issues, bad phrasing, weak arguments, and suggest improvements, all while being entertaining.

You MUST return a JSON object with this exact structure:
{
  "comments": [
    { "paragraphIndex": <number>, "text": "<your roast comment>", "search": "<optional: specific text to target within that paragraph>" }
  ],
  "replacements": [
    { "paragraphIndex": <number>, "search": "<exact text to replace — copy precisely from the document>", "replaceWith": "<better text>" }
  ]
}

Rules:
- paragraphIndex must match an index from the document content
- search must be an EXACT substring from that paragraph's text — copy it character-for-character
- Add 3-8 comments on different parts of the document
- Suggest 1-3 text replacements where the writing could genuinely be stronger
- Be funny but constructive — the goal is to help, not just mock
- Each comment should be witty AND actionable`,
      },
      {
        role: 'user',
        content: `Roast this document:

${JSON.stringify(content, null, 2)}

${existingChanges.length > 0 ? `\nExisting tracked changes:\n${JSON.stringify(existingChanges, null, 2)}` : ''}
${existingComments.length > 0 ? `\nExisting comments:\n${JSON.stringify(existingComments, null, 2)}` : ''}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '';

  let actions: {
    comments?: { paragraphIndex: number; text: string; search?: string }[];
    replacements?: {
      paragraphIndex: number;
      search: string;
      replaceWith: string;
    }[];
  };

  try {
    actions = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 });
  }

  // Step 3: Apply the roast
  const result = reviewer.applyReview({
    comments: (actions.comments ?? []).map((c) => ({
      paragraphIndex: c.paragraphIndex,
      author: 'Document Roaster',
      text: c.text,
      search: c.search,
    })),
    proposals: (actions.replacements ?? []).map((r) => ({
      paragraphIndex: r.paragraphIndex,
      search: r.search,
      author: 'Document Roaster',
      replaceWith: r.replaceWith,
    })),
  });

  // Step 4: Export the roasted document
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
