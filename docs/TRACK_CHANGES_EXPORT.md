# Revision Markup Export

Opt-in DOCX export that embeds Word-compatible revision markup (`w:ins`/`w:del`) by diffing the current document against the originally loaded baseline.

**This is export-time only.** There is no inline visual tracking, accept/reject UI, or commenting in the editor. The saved DOCX can be opened in Word where reviewers can accept or reject changes. For full Track Changes support, see [#81](https://github.com/eigenpal/docx-js-editor/issues/81).

## API

```ts
interface TrackChangesExportOptions {
  enabled?: boolean;
  author?: string;
  date?: string; // ISO 8601
}
```

Available on:

- `DocxEditor` prop: `trackChanges`
- `DocumentAgent.toBuffer(options?)`
- `DocumentAgent.toBlob(mimeType?, options?)`
- `repackDocx(document, options?)`

## React Usage

```tsx
<DocxEditor
  ref={editorRef}
  documentBuffer={file}
  trackChanges={{
    enabled: true,
    author: 'John Doe',
    date: new Date().toISOString(),
  }}
/>;

const buffer = await editorRef.current?.save();
```

## Headless Usage

```ts
import { DocumentAgent } from '@eigenpal/docx-js-editor/headless';

const agent = await DocumentAgent.fromBuffer(originalBuffer);
const trackedBuffer = await agent.toBuffer({
  trackChanges: { enabled: true, author: 'John Doe' },
});
```

## How It Works

On save, the export pipeline compares the current document against a baseline snapshot (captured when the document was first loaded) and emits `w:ins`/`w:del` wrappers in the WordprocessingML output.

- Disabled by default. Normal saves are unaffected.
- If no baseline snapshot exists, falls back to normal (non-tracked) output.
- Author and date metadata are attached to each revision element.

## Supported Revision Types

The codebase includes parser/serializer support for:

- Insertion/deletion wrappers (`w:ins`/`w:del`)
- Move wrappers (`w:moveFrom`/`w:moveTo`) with range markers
- Run/paragraph property changes (`w:rPrChange`/`w:pPrChange`)
- Table structural revisions (`w:tblPrChange`, `w:trPrChange`, `w:tcPrChange`)
