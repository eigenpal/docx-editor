# Props & Ref Methods

## Props

| Prop                          | Type                                        | Default     | Description                                                                                            |
| ----------------------------- | ------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `documentBuffer`              | `ArrayBuffer \| Uint8Array \| Blob \| File` | —           | `.docx` file contents to load                                                                          |
| `document`                    | `Document`                                  | —           | Pre-parsed document (alternative to buffer)                                                            |
| `author`                      | `string`                                    | `'User'`    | Author name for comments and track changes                                                             |
| `mode`                        | `'editing' \| 'suggesting' \| 'viewing'`    | `'editing'` | Editor mode — editing, suggesting (track changes), or viewing (read-only with toolbar)                 |
| `onModeChange`                | `(mode: EditorMode) => void`                | —           | Called when the user changes the editing mode                                                          |
| `readOnly`                    | `boolean`                                   | `false`     | Read-only preview (hides toolbar, rulers, panel)                                                       |
| `externalContent`             | `boolean`                                   | `false`     | Treat `document` as schema seed only — content is provided externally (e.g. Yjs)                       |
| `showToolbar`                 | `boolean`                                   | `true`      | Show formatting toolbar                                                                                |
| `showRuler`                   | `boolean`                                   | `false`     | Show horizontal & vertical rulers                                                                      |
| `rulerUnit`                   | `'inch' \| 'cm'`                            | `'inch'`    | Unit for ruler display                                                                                 |
| `showZoomControl`             | `boolean`                                   | `true`      | Show zoom controls in toolbar                                                                          |
| `showPrintButton`             | `boolean`                                   | `true`      | Show print button in toolbar                                                                           |
| `showOutline`                 | `boolean`                                   | `false`     | Show document outline sidebar (table of contents)                                                      |
| `showMarginGuides`            | `boolean`                                   | `false`     | Show page margin guide boundaries                                                                      |
| `marginGuideColor`            | `string`                                    | `'#c0c0c0'` | Color for margin guides                                                                                |
| `initialZoom`                 | `number`                                    | `1.0`       | Initial zoom level                                                                                     |
| `theme`                       | `Theme \| null`                             | —           | Theme for styling                                                                                      |
| `disableFindReplaceShortcuts` | `boolean`                                   | `false`     | Let the browser or host app handle Cmd/Ctrl+F and Cmd/Ctrl+H instead of opening the editor find dialog |
| `toolbarExtra`                | `ReactNode`                                 | —           | Custom toolbar items appended to the toolbar                                                           |
| `placeholder`                 | `ReactNode`                                 | —           | Placeholder when no document is loaded                                                                 |
| `loadingIndicator`            | `ReactNode`                                 | —           | Custom loading indicator                                                                               |
| `className`                   | `string`                                    | —           | Additional CSS class name                                                                              |
| `style`                       | `CSSProperties`                             | —           | Additional inline styles                                                                               |
| `onChange`                    | `(doc: Document) => void`                   | —           | Called on document change                                                                              |
| `onSave`                      | `(buffer: ArrayBuffer) => void`             | —           | Called on save                                                                                         |
| `onError`                     | `(error: Error) => void`                    | —           | Called on error                                                                                        |
| `onSelectionChange`           | `(state: SelectionState \| null) => void`   | —           | Called on selection change                                                                             |
| `onFontsLoaded`               | `() => void`                                | —           | Called when fonts finish loading                                                                       |
| `onPrint`                     | `() => void`                                | —           | Called when print is triggered                                                                         |
| `onCopy`                      | `() => void`                                | —           | Called when content is copied                                                                          |
| `onCut`                       | `() => void`                                | —           | Called when content is cut                                                                             |
| `onPaste`                     | `() => void`                                | —           | Called when content is pasted                                                                          |
| `renderLogo`                  | `() => ReactNode`                           | —           | Custom logo in the title bar                                                                           |
| `documentName`                | `string`                                    | —           | Editable document name in the title bar                                                                |
| `onDocumentNameChange`        | `(name: string) => void`                    | —           | Called when the user edits the document name                                                           |
| `renderTitleBarRight`         | `() => ReactNode`                           | —           | Custom right-side actions in the title bar                                                             |
| `comments`                    | `Comment[]`                                 | —           | Controlled comments. Pair with `onCommentsChange` to sync over Yjs / Liveblocks / etc.                 |
| `onCommentsChange`            | `(comments: Comment[]) => void`             | —           | Fires whenever the comments array changes (controlled mode)                                            |

Source: [`DocxEditorProps`](../packages/react/src/components/DocxEditor.tsx)

## Ref Methods

```tsx
const ref = useRef<DocxEditorRef>(null);

await ref.current.save(); // Returns ArrayBuffer of the .docx
ref.current.getDocument(); // Current document object
ref.current.setZoom(1.5); // Set zoom to 150%
ref.current.focus(); // Focus the editor
ref.current.scrollToPage(3); // Scroll to page 3
ref.current.print(); // Print the document
```

## Read-Only Preview

Use `readOnly` for a preview-only viewer. This disables editing, caret, and selection UI.

```tsx
<DocxEditor documentBuffer={file} readOnly />
```

## Native Browser Find

By default, `DocxEditor` intercepts Cmd/Ctrl+F and Cmd/Ctrl+H to open its
find/replace dialog. Set `disableFindReplaceShortcuts` when the surrounding app
should keep browser-native find or route those shortcuts itself.

```tsx
<DocxEditor documentBuffer={file} disableFindReplaceShortcuts />
```

## External Content (Yjs and other live sources)

Set `externalContent` when something other than the `document` prop is the source of truth for the editor's content — for example, `ySyncPlugin` from `y-prosemirror`, which populates ProseMirror from a Y.Doc. The `document` prop is still required as a schema seed, but the editor will not load it on mount.

```tsx
import { useMemo } from 'react';
import { DocxEditor, createEmptyDocument } from '@eigenpal/docx-js-editor';
import { ySyncPlugin, yUndoPlugin } from 'y-prosemirror';

function CollaborativeEditor({ ydoc }) {
  const fragment = ydoc.getXmlFragment('prosemirror');
  const plugins = useMemo(() => [ySyncPlugin(fragment), yUndoPlugin()], [fragment]);

  return <DocxEditor document={createEmptyDocument()} externalPlugins={plugins} externalContent />;
}
```

**Why this is needed:** Without `externalContent`, DocxEditor's mount-time `useEffect` calls `loadDocument()`, which resets ProseMirror state. If `ySyncPlugin` has already populated ProseMirror with Y.Doc content, that reset wipes it — and then ySync syncs the empty state back into Y.Doc, corrupting the shared document for every connected client.

## Controlled Comments

Comment thread metadata (text, author, replies, resolved status) lives outside the ProseMirror document — only the comment range markers sync via `ySyncPlugin`. To make threads sync across collaborators, pass `comments` and `onCommentsChange` and bridge them to your collab backend (Yjs `Y.Array`, Liveblocks storage, Automerge document, anything keyed by id).

```tsx
import { useEffect, useState, useCallback } from 'react';
import * as Y from 'yjs';
import type { Comment } from '@eigenpal/docx-js-editor';

function useSyncedComments(ydoc: Y.Doc): [Comment[], (next: Comment[]) => void] {
  const yComments = ydoc.getArray<Comment>('comments');
  const [comments, setComments] = useState<Comment[]>(() => yComments.toArray());

  useEffect(() => {
    const sync = () => setComments(yComments.toArray());
    yComments.observeDeep(sync);
    return () => yComments.unobserveDeep(sync);
  }, [yComments]);

  const setCommentsRemote = useCallback(
    (next: Comment[]) => {
      ydoc.transact(() => {
        if (yComments.length > 0) yComments.delete(0, yComments.length);
        if (next.length > 0) yComments.push(next);
      });
    },
    [ydoc, yComments]
  );

  return [comments, setCommentsRemote];
}

// in the component:
const [comments, setComments] = useSyncedComments(ydoc);
return (
  <DocxEditor document={...} comments={comments} onCommentsChange={setComments} />
);
```

When `comments` is omitted, the editor falls back to internal state — existing usages need no changes.

**Tracked changes** sync automatically without any extra props: their metadata (`author`, `date`, `revisionId`) lives in `insertion`/`deletion` mark attributes on the ProseMirror document, which `ySyncPlugin` syncs as part of the doc tree.
