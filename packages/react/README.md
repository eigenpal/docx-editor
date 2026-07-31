<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

# @docx-editor.dev/react

React adapter for the docx-editor.dev editor.

It is a thin renderer over the editor contract in
`@docx-editor.dev/core-contract`: it supplies the DOM host, constructs the
editor with `createEditor`, and paints the engine's positioned display list.
All editing, querying, and geometry go through the `Editor` facade — the
adapter holds no editing-engine state of its own.

> **Status.** The engine behind the contract is under active development. Until
> it ships, this adapter mounts against a contract stub and is not yet
> functional.

## Usage

```tsx
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';
import { useRef } from 'react';

export function App() {
  const ref = useRef<DocxEditorRef>(null);
  return <DocxEditor ref={ref} onReady={(editor) => void editor} />;
}
```

`DocxEditor` exposes an imperative handle — `exec`, `snapshot`, `save`, `focus`,
and `getEditor` — that delegates to the `Editor` facade.

## License

Apache-2.0
