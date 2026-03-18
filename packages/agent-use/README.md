# @eigenpal/docx-editor-agents

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)

Word-like API for AI document review. Add comments, suggest replacements, accept/reject tracked changes — all headless, no DOM required.

## Install

```bash
npm install @eigenpal/docx-editor-agents
```

## Usage

```ts
import { DocxReviewer } from '@eigenpal/docx-editor-agents';

const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI Reviewer');

// Read
const text = reviewer.getContentAsText();

// Comment
reviewer.addComment(5, 'This cap seems too low.');

// Replace (tracked change)
reviewer.replace(5, '$50k', '$500k');

// Batch from LLM response
reviewer.applyReview({
  comments: [{ paragraphIndex: 5, text: 'Too low.' }],
  proposals: [{ paragraphIndex: 5, search: '$50k', replaceWith: '$500k' }],
});

// Export
const output = await reviewer.toBuffer();
```

## License

[AGPL-3.0](./LICENSE) — free to use and modify, but you must open-source your code. For commercial licensing without AGPL obligations, contact [founders@eigenpal.com](mailto:founders@eigenpal.com).
