<p align="center">
  <a href="https://www.docx-editor.dev/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/readme-logo-dark.svg" />
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/readme-logo-light.svg" />
      <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/readme-logo-light.svg" alt="DOCX Editor by EigenPal" width="320" height="90" />
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/pro"><img src="https://img.shields.io/npm/v/@docx-editor.dev/pro.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/packages/pro/LICENSE.md"><img src="https://img.shields.io/badge/license-EigenPal_Pro_License-blue.svg?style=flat-square&color=3B5BDB" alt="EigenPal Pro License" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs/2.x/pro"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/pro

Add advanced drawing rendering, review, collaboration, and custom content to the [docx-editor.dev](https://docx-editor.dev) React and Vue editors. The package provides these capabilities:

- [Tracked changes](https://www.docx-editor.dev/docs/2.x/pro/tracked-changes): Suggesting mode, markup rendering, accept, and reject.
- [Comments](https://www.docx-editor.dev/docs/2.x/pro/comments): Threads anchored to a range, with replies.
- [Collaboration](https://www.docx-editor.dev/docs/2.x/pro/collaboration): Provider-neutral sessions with WebRTC and Hocuspocus helpers.
- [Custom nodes](https://www.docx-editor.dev/docs/2.x/pro/custom-nodes): Inline node types stored as content controls.
- [Advanced drawing rendering](https://www.docx-editor.dev/docs/2.x/pro/drawing): Charts, SmartArt layout, shape effects, WordArt, and EMF and WMF pictures.

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core @docx-editor.dev/pro
```

The framework-neutral entry is `@docx-editor.dev/pro`. Framework chrome lives at `@docx-editor.dev/pro/react` and `@docx-editor.dev/pro/vue`. Drawing rendering is at `@docx-editor.dev/pro/drawing` for both frameworks; `reviewModule()` installs it too.

## Register a module

Pass capability modules to the editor root. Keep the module array stable across renders to avoid rebuilding the editor.

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

Set `author` to the name stored in `w:author`. The engine requires an author to create comments or replies.

Without a review module, the editor preserves revisions and comments when saving. It displays final revision content. Add the review module to display markup and review controls.

## Collaboration

Use `collaborationModule` with a Yjs 13 provider. The package includes WebRTC and Hocuspocus helpers for React and Vue.

Install the peer package for your transport:

```bash
npm install @docx-editor.dev/pro yjs y-webrtc
npm install @docx-editor.dev/pro yjs @hocuspocus/provider
```

Start with the [real-time collaboration quickstart](https://www.docx-editor.dev/docs/2.x/collaboration). Use the [collaboration reference](https://www.docx-editor.dev/docs/2.x/pro/collaboration) for room lifecycles, presence, recovery, and limits.

## Chrome or hooks

Use the packaged sidebar to display review cards. Use `useReview()` to build your own review interface.

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

Items come from the document tree. Anchors come from layout records. These sources keep your sidebar aligned with the document during pagination.

## Custom nodes

Define inline nodes such as citations, mentions, and merge fields. Each node uses a content control with its identity and attributes in `w:tag`. Other DOCX editors display the node's text and preserve the control.

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

`insertCustomNode`, `updateCustomNode`, and `removeCustomNode` author them from code, and `customNodeXml` builds the same content control on a server with no editor and no DOM.

## Which API for which job

| Job | Use |
| --- | --- |
| Build a review UI in the browser | The React or Vue adapter hooks, plus the review hooks and `DocxEditorReview` from `@docx-editor.dev/pro/react` or `@docx-editor.dev/pro/vue`. |
| Edit in a headless, server, or agent pipeline | The editing API in `@docx-editor.dev/editor-api`, which follows the Office.js object model. |

| Task | Browser host (React or Vue) | Headless, server, or agent |
| --- | --- | --- |
| [Comment on found text](https://www.docx-editor.dev/docs/2.x/recipes/comment-on-found-text) | `editor.findMatches`, `editor.selectMatch`, then `useReview().comment` | `body.search`, then `Range.insertComment` |
| Reply to a thread | `useReview().reply(item, text)` | `Comment.reply(text)` |
| [Record a tracked replacement](https://www.docx-editor.dev/docs/2.x/recipes/tracked-replacement) | Suggesting mode, then `editor.exec({ type: 'replaceMatch', match, text })` | `document.changeTrackingMode = 'TrackMineOnly'`, then `Range.insertText(text, 'Replace')` |
| [Propose an AI rewrite as tracked changes](https://www.docx-editor.dev/docs/2.x/recipes/propose-rewrite) | The same code through `DocxEditor.createBrowser` from `@docx-editor.dev/editor-api/browser` | `prepareRewrite` from `@docx-editor.dev/editor-api/agent` |
| [Accept or reject a change](https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling) | `useReview().accept(item)` or `useReview().reject(item)` | `Revision.accept()` or `Revision.reject()` |
| [Open or reveal a change without scrolling](https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling) | `useReview().setActive(key, { reveal: false })` | Not applicable: no viewport |
| [Highlight ranges](https://www.docx-editor.dev/docs/2.x/recipes/highlight-ranges) | `useHighlights(name, source, options)` | Not applicable |
| [Custom review rail cards](https://www.docx-editor.dev/docs/2.x/recipes/custom-review-cards) | `DocxEditorReview` with `preset` set to `false`, `useReview().items`, `useStackedReviewPositions`, and `useReviewRailMetrics` | Not applicable |
| Comment-on-selection button | `DocxEditorReview.AddComment` as a direct child of `DocxEditorReview`, or `useEditorCommand('review.addComment')` | Not applicable |
| Page setup and paragraph dialogs from a custom toolbar | `DocxEditor.PageSetupDialog` or `DocxEditor.ParagraphDialog` with `open` and a close handler (`onClose` in React, `@close` in Vue); enable the button from `usePageSetup().isEnabled` or `useParagraphFormat().isEnabled` | `Section.pageSetup`, and `Paragraph` properties such as `alignment` |

The review hooks need `reviewModule()` from `@docx-editor.dev/pro` in the editor's modules, and an editor `author` for comments and tracked changes. The editing API takes its author from the `author` option of `DocxEditor.createServer`, imported from `@docx-editor.dev/editor-api`, or of `DocxEditor.createBrowser`, imported from `@docx-editor.dev/editor-api/browser`.

This package ships the task recipes in [`docs/index.md`](./docs/index.md). They are also on the site: [Task recipes](https://www.docx-editor.dev/docs/2.x/recipes).

## Render charts and advanced drawings

Register `drawingModule()` to render charts, SmartArt saved without its drawing, shape effects, WordArt, and EMF and WMF pictures. If you already register `reviewModule()`, you don't need it.

```ts
import { drawingModule } from '@docx-editor.dev/pro/drawing';

// Next.js; with Vite, read import.meta.env.VITE_DOCX_LICENSE.
const MODULES = [drawingModule({ licenseKey: process.env.NEXT_PUBLIC_DOCX_LICENSE })];
```

For headless use, call `installDrawing()` from the same entry before you open documents.

## Licensing

This package uses the [EigenPal Pro License](https://github.com/eigenpal/docx-editor/blob/main/packages/pro/LICENSE.md). See [pricing](https://www.docx-editor.dev/pricing) for license and support options.

`reviewModule`, `customNodesModule`, `collaborationModule`, `drawingModule`, and `installDrawing` accept an optional `licenseKey`. Pass the key once, to any of them. The key is optional and is never validated or sent anywhere: every module works the same with or without it. Production use requires an EigenPal Pro License, and the key identifies yours when you contact support. The key is not a secret, so you can ship it in browser code. Construction never validates it and never touches the network.

## Documentation

- [Pro overview](https://www.docx-editor.dev/docs/2.x/pro)
- [Tracked changes](https://www.docx-editor.dev/docs/2.x/pro/tracked-changes)
- [Comments](https://www.docx-editor.dev/docs/2.x/pro/comments)
- [Collaboration](https://www.docx-editor.dev/docs/2.x/pro/collaboration)
- [Custom nodes](https://www.docx-editor.dev/docs/2.x/pro/custom-nodes)
