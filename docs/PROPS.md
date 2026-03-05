# Props & Ref Methods

## Props

| Prop                   | Type                                        | Default           | Description                                       |
| ---------------------- | ------------------------------------------- | ----------------- | ------------------------------------------------- |
| `documentBuffer`       | `ArrayBuffer \| Uint8Array \| Blob \| File` | —                 | `.docx` file contents to load                     |
| `document`             | `Document`                                  | —                 | Pre-parsed document (alternative to buffer)       |
| `author`               | `string`                                    | `'User'`          | Author name for comments and track changes        |
| `readOnly`             | `boolean`                                   | `false`           | Read-only preview (hides toolbar, rulers, panel)  |
| `showToolbar`          | `boolean`                                   | `true`            | Show formatting toolbar                           |
| `showRuler`            | `boolean`                                   | `false`           | Show horizontal & vertical rulers                 |
| `rulerUnit`            | `'inch' \| 'cm'`                            | `'inch'`          | Unit for ruler display                            |
| `showZoomControl`      | `boolean`                                   | `true`            | Show zoom controls in toolbar                     |
| `showPrintButton`      | `boolean`                                   | `true`            | Show print button in toolbar                      |
| `showPageNumbers`      | `boolean`                                   | `true`            | Show page number indicator                        |
| `enablePageNavigation` | `boolean`                                   | `true`            | Enable interactive page navigation                |
| `pageNumberPosition`   | `string`                                    | `'bottom-center'` | Position of page number indicator                 |
| `showOutline`          | `boolean`                                   | `false`           | Show document outline sidebar (table of contents) |
| `showMarginGuides`     | `boolean`                                   | `false`           | Show page margin guide boundaries                 |
| `marginGuideColor`     | `string`                                    | `'#c0c0c0'`       | Color for margin guides                           |
| `initialZoom`          | `number`                                    | `1.0`             | Initial zoom level                                |
| `theme`                | `Theme \| null`                             | —                 | Theme for styling                                 |
| `toolbarExtra`         | `ReactNode`                                 | —                 | Custom toolbar items appended to the toolbar      |
| `placeholder`          | `ReactNode`                                 | —                 | Placeholder when no document is loaded            |
| `loadingIndicator`     | `ReactNode`                                 | —                 | Custom loading indicator                          |
| `className`            | `string`                                    | —                 | Additional CSS class name                         |
| `style`                | `CSSProperties`                             | —                 | Additional inline styles                          |
| `onChange`             | `(doc: Document) => void`                   | —                 | Called on document change                         |
| `onSave`               | `(buffer: ArrayBuffer) => void`             | —                 | Called on save                                    |
| `onError`              | `(error: Error) => void`                    | —                 | Called on error                                   |
| `onSelectionChange`    | `(state: SelectionState \| null) => void`   | —                 | Called on selection change                        |
| `onFontsLoaded`        | `() => void`                                | —                 | Called when fonts finish loading                  |
| `onPrint`              | `() => void`                                | —                 | Called when print is triggered                    |
| `onCopy`               | `() => void`                                | —                 | Called when content is copied                     |
| `onCut`                | `() => void`                                | —                 | Called when content is cut                        |
| `onPaste`              | `() => void`                                | —                 | Called when content is pasted                     |

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
