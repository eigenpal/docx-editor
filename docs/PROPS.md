# Props and ref methods

The documented root API shape is shared by the React and Vue packages.

```ts
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';
```

```ts
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/vue';
```

Both packages export `DocxEditor`, `DocxEditorProps`, `DocxEditorRef`, and
`EditorMode` from the package root. The React package also exports its provider
primitives, shared hooks, and compound chrome from that same root entry. There
are no current `/ui`, `/hooks`, `/composables`, `/dialogs`, or `/plugin-api`
public package exports.

Staged React/Vue prop divergences are enforced by `bun run check:editor-contract`
so they stay explicit instead of accidental.

## Props

### Shared root props

| Prop          | Type                                             | Package(s) | Description                                      |
| ------------- | ------------------------------------------------ | ---------- | ------------------------------------------------ |
| `document`    | `DocumentSource`                                 | React, Vue | DOCX bytes or an existing `DocumentHandle`.      |
| `fonts`       | `FontConfiguration \| FontConfigurationFragment` | React, Vue | Font bytes used for shaping and pagination.      |
| `author`      | `string`                                         | React, Vue | Ambient author for authored commands.            |
| `mode`        | `'edit' \| 'view' \| 'suggesting'`               | React, Vue | Mount-time editing mode.                         |
| `zoom`        | `number`                                         | React, Vue | Mount-time zoom value.                           |
| `zoomMode`    | `ZoomMode \| 'auto'`                             | React, Vue | Automatic or fixed zoom behavior.                |
| `locale`      | `string`                                         | React, Vue | Locale passed to the underlying editor instance. |
| `i18n`        | `Translations`                                   | React, Vue | Translation overrides for editor chrome.         |
| `t`           | `(key, params?) => string`                       | React, Vue | Host translation function for editor chrome.     |
| `colorMode`   | `'light' \| 'dark' \| 'system'`                  | React, Vue | Color mode for editor chrome.                    |
| `rulers`      | `boolean`                                        | React, Vue | Toggles the packaged rulers.                     |
| `modules`     | `readonly EditorModule[]`                        | React, Vue | Feature modules applied at mount.                |
| `onFontError` | `(error: EditorFontError) => void`               | React, Vue | Reports typed font-resolution failures.          |

### React root chrome props

| Prop                                         | Type                                    | Description                                            |
| -------------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| `chrome`                                     | `boolean`                               | Toggle the packaged frame around the painted document. |
| `title`                                      | `string`                                | Title shown in the title bar.                          |
| `onTitleChange`                              | `(title: string) => void`               | Makes the title editable.                              |
| `renderTitleBarLeft` / `renderTitleBarRight` | `() => ReactNode`                       | Host-owned title-bar slots.                            |
| `menu`                                       | `boolean \| DocxEditorMenuProps`        | Toggle or customize the packaged menu row.             |
| `navigation`                                 | `boolean`                               | Toggle the packaged navigation pane.                   |
| `hyperlinkPopup`                             | `boolean`                               | Toggle the packaged link popover.                      |
| `contextMenu`                                | `boolean \| DocxEditorContextMenuProps` | Toggle or customize the packaged context menu.         |
| `children`                                   | `ReactNode`                             | Render host chrome inside the viewport.                |
| `onReady`                                    | `(editor: Editor) => void`              | Fired after the editor instance is created.            |
| `onChange`                                   | `(change: DocumentChange) => void`      | Fired after document mutations.                        |
| `onSave` / `onOpen`                          | `() => void`                            | Override the packaged File → Save / Open actions.      |

Source: [`packages/react/src/types.ts`](../packages/react/src/types.ts) and [`packages/vue/src/types.ts`](../packages/vue/src/types.ts).

For full details, see the
[React props](https://www.docx-editor.dev/docs/2.x/react/props) and
[Vue props](https://www.docx-editor.dev/docs/2.x/vue/props).

## Ref methods

```tsx
const ref = useRef<DocxEditorRef>(null);

await ref.current?.save();
ref.current?.getEditor();
ref.current?.focus();
ref.current?.load(bytes);
ref.current?.exec(command, { scope: { kind: 'body' } });
ref.current?.snapshot();
```

The current shared handle methods are `load`, `save`, `getDocumentHandle`,
`getEditor`, `focus`, `exec`, and `snapshot`.
