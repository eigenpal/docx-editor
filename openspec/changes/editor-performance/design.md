# Design: Editor Performance

## Large document loading

### Root cause analysis needed

Profile the loading pipeline to identify the bottleneck:

1. **DOCX parsing** (XML → Document model) — likely fast
2. **ProseMirror document construction** (toProseDoc) — may be slow for huge documents
3. **Layout-painter rendering** (measure + paint all pages) — likely the main bottleneck

### Optimization strategies

**Incremental page rendering:**

- Render first N pages immediately (above the fold)
- Render remaining pages in batches using `requestIdleCallback` or `setTimeout(0)` chunks
- Show placeholder/loading indicator for un-rendered pages
- This prevents the main thread from blocking for 60+ seconds

**Web Worker for parsing:**

- Move DOCX parsing (unzip + XML parse) to a Web Worker
- Post the Document model back to main thread
- Keeps UI responsive during parsing phase

**Prevent tab throttling:**

- Use `requestAnimationFrame` or `setTimeout` chunking instead of synchronous loops
- Browser throttles long-running synchronous tasks when tab loses focus

## Tracked changes performance

### Root cause

Each tracked change creates:

- PM marks on the text (insertion/deletion)
- DOM elements for change highlighting
- Associated comment in the sidebar
- Scroll-to-highlight event listeners

With 100+ changes, this multiplies DOM nodes and event listeners significantly.

### Optimization strategies

**Virtualize comment sidebar:**

- Only render comments visible in the viewport
- Use intersection observer to load/unload comments

**Batch tracked change rendering:**

- Merge adjacent tracked changes by the same author into single DOM spans
- Reduce per-change DOM overhead

**Lazy change resolution:**

- Don't resolve change details (author, date, diff) until the change is scrolled into view

## Key files

| File                                       | Change                           |
| ------------------------------------------ | -------------------------------- |
| `src/layout-painter/renderPage.ts`         | Incremental rendering            |
| `src/paged-editor/PagedEditor.tsx`         | Chunked page rendering           |
| `src/docx/parser.ts`                       | Web Worker offloading            |
| `src/prosemirror/conversion/toProseDoc.ts` | PM doc construction optimization |
