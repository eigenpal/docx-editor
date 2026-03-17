## Context

The editor has complete OOXML support for track changes and comments (types, parsers, serializers, ProseMirror marks/commands). Missing: a high-level API that works with paragraph indices and IDs instead of ProseMirror positions.

Monorepo: `packages/core` (`@eigenpal/docx-core`, MIT), `packages/react`, `packages/vue`. Root workspace `"packages/*"`. Build: tsup. New package: `packages/agent-use` → `@eigenpal/docx-editor-agents` (BSL-1.1).

## Goals / Non-Goals

**Goals:**

- 14-method `DocxReviewer` class that covers: read, discover, comment, propose, resolve, batch, export
- `paragraphIndex` as primary anchor (deterministic, no quoting errors)
- `search` as optional sub-paragraph refinement only
- Chunked reading for long documents
- Headless-first, peer dep on core

**Non-Goals:**

- Section tree / document structure parsing (LLMs understand headings in flat text)
- Filtered bulk operations (`acceptByAuthor`, `rejectByType`) — agents can filter in JS
- Comment management (`resolve`, `delete`, `reopen`) — agents add comments, humans manage them
- Runtime license enforcement — BSL is legal, not technical
- Track changes authoring mode, sidebar UI, real-time collaboration
- MCP tools (can add later, keep v1 focused on the class API)

## Decisions

### 1. Separate BSL-1.1 package, not a plugin

`packages/agent-use/` with `@eigenpal/docx-core` as peer dep. Published on public npm under BSL-1.1.

**Why not CorePlugin?** DocxReviewer is a standalone class with its own lifecycle. Plugin registration adds unnecessary ceremony for something that's just `new DocxReviewer(doc)`.

**Why BSL over private npm?** Lower friction. Public npm, anyone can evaluate. Enterprise customers pay because they respect the license. No registry infra.

### 2. `paragraphIndex` as primary anchor

Every `getContent()` block has an `index`. The agent references that index in `addComment()`, `proposeReplacement()`, etc.

**Why not text search as primary?** LLMs don't reproduce text verbatim — they paraphrase, drop punctuation, change quotes. Paragraph index is deterministic. `search` is only used as optional refinement for sub-paragraph targeting (scoped to one paragraph, much less ambiguous).

```typescript
// Agent sees: { index: 15, text: 'aggregate liability shall not exceed $50,000.' }
// Agent does:
reviewer.addComment({ paragraphIndex: 15, author: 'AI', text: 'Cap too low.' });
reviewer.proposeReplacement({
  paragraphIndex: 15,
  search: '$50,000',
  author: 'AI',
  replaceWith: '$500,000',
});
```

### 3. Chunked reading, not structure trees

Long docs (50+ pages) don't fit in one LLM call. Solution: `getContent({ fromIndex: 50, toIndex: 80 })` returns a slice.

**Why not `getStructure()` with section trees?** Over-engineering. LLMs already understand headings in flat text. An agent can scan `getContent()` output, see headings, and decide which paragraph ranges to drill into. We don't need to parse legal numbering schemes.

### 4. Mutable operations, immutable output

`DocxReviewer` deep-clones the document on construction. Operations mutate the clone. `toDocument()` / `toBuffer()` returns the final state.

### 5. Minimal surface — 14 methods

```
Read:      getContent(options?)
Discover:  getChanges(filter?), getComments(filter?)
Comment:   addComment({paragraphIndex, author, text, search?}), replyTo(commentId, {author, text})
Propose:   proposeReplacement({...}), proposeInsertion({...}), proposeDeletion({...})
Resolve:   acceptChange(id), rejectChange(id), acceptAll(), rejectAll()
Batch:     applyReview({...})
Export:    toBuffer(), toDocument()
```

Everything cut from the earlier design (`acceptByAuthor`, `rejectByType`, `resolveComment`, `deleteComment`, `getSummary`, `addCommentAtRange`) can be done by composing these 14 methods. Agent calls `getChanges({ author: 'Jane' })` → loops → `acceptChange(id)`. No need for a dedicated bulk method.

## Risks / Trade-offs

**[Risk] `paragraphIndex` changes if agent adds/removes paragraphs mid-session** → Mitigation: Document that indices are snapshot-based. Batch operations process in order. For multi-pass workflows, agent should re-read `getContent()` between passes.

**[Risk] `search` within a paragraph still fails on LLM misquotes** → Mitigation: Scoped to one paragraph, so much less ambiguous. Can add fuzzy matching later if needed.

**[Risk] No MCP tools in v1** → Accepted trade-off. Class API is the priority. MCP wrappers are trivial to add later — each tool just calls one `DocxReviewer` method.

**[Trade-off] No section-level operations** → Accepted. `paragraphIndex` + `fromIndex`/`toIndex` chunking covers the same use cases without inventing a section parser.
