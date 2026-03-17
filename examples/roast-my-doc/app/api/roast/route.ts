import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { DocxReviewer } from '@eigenpal/docx-editor-agent-use';

const anthropic = new Anthropic();

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

  // Step 2: Ask Claude to roast it
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `You are a brutally honest document reviewer with a sense of humor. "Roast" this document — point out issues, suggest improvements, and be entertaining about it.

Document content:
${JSON.stringify(content, null, 2)}

${existingChanges.length > 0 ? `Existing tracked changes:\n${JSON.stringify(existingChanges, null, 2)}` : ''}
${existingComments.length > 0 ? `Existing comments:\n${JSON.stringify(existingComments, null, 2)}` : ''}

Return a JSON object with your review actions. Each comment should be witty but also genuinely helpful. Each replacement should improve the text.

{
  "comments": [
    { "paragraphIndex": <number>, "text": "<your roast comment>", "search": "<optional: specific text to target>" }
  ],
  "replacements": [
    { "paragraphIndex": <number>, "search": "<text to replace>", "replaceWith": "<better text>" }
  ]
}

Rules:
- paragraphIndex must match an index from the document content above
- search must be an EXACT substring from that paragraph's text (copy it precisely)
- Add 3-8 comments on different parts of the document
- Suggest 1-3 text replacements where the writing could be stronger
- Be funny but constructive — the goal is to help, not just mock
- Return ONLY the JSON, no markdown fences or explanation`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  let actions: {
    comments?: { paragraphIndex: number; text: string; search?: string }[];
    replacements?: { paragraphIndex: number; search: string; replaceWith: string }[];
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

  // Step 4: Export
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
