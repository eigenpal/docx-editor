<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/pro"><img src="https://img.shields.io/npm/v/@docx-editor.dev/pro.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/packages/pro/LICENSE.md"><img src="https://img.shields.io/badge/license-EigenPal_Pro_Evaluation_1.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs/2.x/pro"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/pro

Four capabilities for the [docx-editor.dev](https://docx-editor.dev) React and
Vue editors:

- **Tracked changes**: Suggesting mode, markup rendering, accept, and reject.
- **Comments**: Threads anchored to a range, with replies.
- **Collaboration**: Provider-neutral sessions with WebRTC and Hocuspocus helpers.
- **Custom nodes**: Inline node types stored as Word content controls.

```bash
npm install @docx-editor.dev/react @docx-editor.dev/pro
```

The framework-neutral entry is `@docx-editor.dev/pro`. Framework chrome lives at
`@docx-editor.dev/pro/react` and `@docx-editor.dev/pro/vue`.

## Register a module

Capabilities are modules passed to the editor root. Registration happens at construction, so
the array identity must be stable. Build it outside render, or the editor rebuilds every time.

```tsx
import { DocxEditor } from '@docx-editor.dev/react';
import { reviewModule, DocxEditorReview } from '@docx-editor.dev/pro/react';

const MODULES = [reviewModule()];

export function Reviewer({ bytes }: { bytes: Uint8Array }) {
  return (
    <DocxEditor.Root document={bytes} modules={MODULES} author="Jess Lin">
      <DocxEditor.Toolbar />
      <DocxEditor.Viewport>
        <DocxEditor.Content />
        {/* Tracked changes and comments as cards beside the page. */}
        <DocxEditorReview />
      </DocxEditor.Viewport>
    </DocxEditor.Root>
  );
}
```

`author` is what lands in `w:author`. OOXML requires it, so the engine refuses a comment or
reply with no author rather than writing an empty attribute.

Without a review module the editor still opens a document containing revisions and comments and
still saves them back untouched. It renders revisions in their final state and offers no review
UI; the module is what makes them visible and actionable.

## Collaboration

Use `collaborationModule` with a Yjs 13 provider. The package includes WebRTC and
Hocuspocus helpers for React and Vue.

Install the peer package for your transport:

```bash
npm install @docx-editor.dev/pro yjs y-webrtc
npm install @docx-editor.dev/pro yjs @hocuspocus/provider
```

Start with the
[real-time collaboration quickstart](https://www.docx-editor.dev/docs/2.x/collaboration).
Use the
[collaboration reference](https://www.docx-editor.dev/docs/2.x/pro/collaboration)
for room lifecycles, presence, recovery, and limits.

## Chrome or hooks

Everything the packaged sidebar renders is reachable from `useReview()`. Use the sidebar for
Word-like cards out of the box, or the hook to render your own markup.

```tsx
import { useReview } from '@docx-editor.dev/pro/react';

function ChangeList() {
  const { items, accept, reject, resolve, reopen, ready } = useReview();
  if (!ready) return null;

  return (
    <ul>
      {items.map((item) => (
        <li key={item.key}>
          {/* File-derived. Render as text, never as markup. */}
          {item.text} — {item.author}
          {item.kind === 'revision' && !item.readOnly && (
            <>
              <button onClick={() => accept(item)}>Accept</button>
              <button onClick={() => reject(item)}>Reject</button>
            </>
          )}
          {item.kind === 'comment' && (
            <button onClick={() => (item.resolved ? reopen(item) : resolve(item))}>
              {item.resolved ? 'Reopen' : 'Resolve'}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
```

Items come from the document tree rather than from what is currently painted, and each anchor
comes from layout records rather than measured DOM, so a sidebar built on this does not lag a
repaint behind the page or break during pagination.

## Custom nodes

An inline node type you define (a citation, a mention, a merge field) stored as a Word content
control whose `w:tag` carries your identity and attributes. Word opens the document, shows the
node's text, and gives it back unchanged.

```ts
import { defineCustomNode, customNodesModule } from '@docx-editor.dev/pro';

const Citation = defineCustomNode({
  name: 'citation',
  tagPrefix: 'docx',
  label: 'Citation',
  chrome: { color: '#7c3aed' },
  fromDocx: ({ attrs, text }) => ({ ...attrs, label: text }),
});

const MODULES = [customNodesModule({ nodes: [Citation] })];
```

Every value reaching `fromDocx` came out of a `.docx`, so treat `attrs` and `text` as untrusted.

`insertCustomNode`, `updateCustomNode`, and `removeCustomNode` author them from code, and
`customNodeXml` builds the same content control on a server with no editor and no DOM.

## Licensing

This package is licensed under the [EigenPal Pro License](https://github.com/eigenpal/docx-editor/blob/main/packages/pro/LICENSE.md), and you can compare and buy license and support levels on the [pricing page](https://www.docx-editor.dev/pricing).

Both module factories accept an optional `licenseKey`. Construction never validates it and never
touches the network.

## Documentation

- [Pro overview](https://www.docx-editor.dev/docs/2.x/pro)
- [Tracked changes](https://www.docx-editor.dev/docs/2.x/pro/tracked-changes)
- [Comments](https://www.docx-editor.dev/docs/2.x/pro/comments)
- [Collaboration](https://www.docx-editor.dev/docs/2.x/pro/collaboration)
- [Custom nodes](https://www.docx-editor.dev/docs/2.x/pro/custom-nodes)
