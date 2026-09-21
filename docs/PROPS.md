# Props and ref methods

React and Vue share the root editor contract. Import the component and ref type for your framework.

```ts
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';
```

For Vue, use the Vue package:

```ts
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/vue';
```

Both packages export `DocxEditor`, `DocxEditorProps`, `DocxEditorRef`, and `EditorMode` from the package root. The React package also exports its provider primitives, shared hooks, and compound chrome from that same root entry. There are no `/ui`, `/hooks`, `/composables`, `/dialogs`, or `/plugin-api` public package exports.

Staged React/Vue prop divergences are enforced by `bun run check:editor-contract` so they stay explicit instead of accidental.

## Props

### Shared root props

| Prop | Type | Package(s) | Description |
| --- | --- | --- | --- |
| `document` | `DocumentSource` | React, Vue | DOCX bytes, `'blank'`, or an existing `DocumentHandle`. |
| `fonts` | `FontConfiguration \| FontConfigurationFragment \| FontResolver` | React, Vue | Font bytes or a resolver used for shaping and pagination. |
| `author` | `string` | React, Vue | Author name for editing commands. |
| `mode` | `'edit' \| 'view' \| 'suggesting'` | React, Vue | Editing mode; changes apply without remounting. |
| `zoom` | `number` | React, Vue | Fixed zoom scale; changes apply without remounting. |
| `zoomMode` | `ZoomMode \| 'auto'` | React, Vue | Automatic or fixed zoom behavior. |
| `locale` | `string` | React, Vue | Regional date input and generated labels; defaults to `en-US`. |
| `i18n` | `Translations` | React, Vue | UI translations, including form controls; separate from `locale`. |
| `t` | `(key, params?) => string` | React, Vue | Host translation function for editor chrome. |
| `colorMode` | `'light' \| 'dark' \| 'system'` | React, Vue | Color mode for editor chrome. |
| `rulers` | `boolean` | React, Vue | Toggles the packaged rulers. |
| `modules` | `readonly EditorModule[]` | React, Vue | Feature modules applied at mount. |
| `onFontError` | `(error: EditorFontError) => void` | React, Vue | Reports typed font-resolution failures. |

### React root chrome props

| Prop | Type | Description |
| --- | --- | --- |
| `chrome` | `boolean` | Toggle the packaged frame around the painted document. |
| `title` | `string` | Title shown in the title bar. |
| `onTitleChange` | `(title: string) => void` | Makes the title editable. |
| `renderTitleBarLeft` / `renderTitleBarRight` | `() => ReactNode` | Host-owned title-bar slots. |
| `menu` | `boolean \| DocxEditorMenuProps` | Toggle or customize the packaged menu row. |
| `navigation` | `boolean \| DocxEditorNavigationProps` | Toggle or customize the packaged navigation pane. |
| `hyperlinkPopup` | `boolean` | Toggle the packaged link popover. |
| `contextMenu` | `boolean \| DocxEditorContextMenuProps` | Toggle or customize the packaged context menu. |
| `children` | `ReactNode` | Render host chrome inside the viewport. |
| `onReady` | `(editor: Editor) => void` | Fired after the editor instance is created. |
| `onChange` | `(change: DocumentChange) => void` | Fired after document mutations. |
| `onSave` / `onOpen` | `() => void` | Override the packaged File → Save / Open actions. |

Source: [`packages/react/src/types.ts`](../packages/react/src/types.ts) and [`packages/vue/src/types.ts`](../packages/vue/src/types.ts).

For full details, see the [React props](https://www.docx-editor.dev/docs/2.x/react/props) and [Vue props](https://www.docx-editor.dev/docs/2.x/vue/props).

## Ref methods

The shared ref exposes these methods:

| Method                    | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `load(document)`          | Open DOCX bytes, `'blank'`, or a document handle.              |
| `save()`                  | Return a `Promise<ArrayBuffer \| null>` containing DOCX bytes. |
| `getDocumentHandle()`     | Read the loaded document's identity and revision.              |
| `getEditor()`             | Access the editor instance.                                    |
| `focus()`                 | Focus the document surface.                                    |
| `exec(command, options?)` | Run a command and return its result.                           |
| `snapshot(options?)`      | Read the editor state.                                         |

Attach a React ref to the editor, then call its methods from event handlers:

```tsx
import { useRef } from 'react';
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';

function Editor({ bytes }: { bytes: Uint8Array }) {
  const ref = useRef<DocxEditorRef>(null);

  function undo() {
    ref.current?.exec({ type: 'undo' }, { scope: { kind: 'body' } });
    ref.current?.focus();
  }

  return (
    <>
      <button type="button" onClick={undo}>
        Undo
      </button>
      <DocxEditor ref={ref} document={bytes} />
    </>
  );
}
```

Use `getEditor()` and `getDocumentHandle()` after the editor mounts; either can return `null`. `save()` can also return `null` before mount.
