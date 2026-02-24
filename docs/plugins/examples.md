# Plugin Examples & Cookbook

## Example Plugins

### Hello World — Word Count

A minimal `EditorPlugin` with a right-hand panel showing word, character, and paragraph counts. Demonstrates `initialize`, `onStateChange`, `Panel`, and `panelConfig`.

```bash
cd examples/plugins/hello-world
npm install && npm run dev    # http://localhost:5175
```

Source: [`examples/plugins/hello-world/src/wordCountPlugin.ts`](../../examples/plugins/hello-world/src/wordCountPlugin.ts)

### Docxtemplater

Full-featured template variable plugin combining both plugin systems:

- **EditorPlugin** (`src/plugins/template/`) — ProseMirror decorations that highlight `{variable}` tags, plus an annotation panel listing the template schema
- **CorePlugin** (`src/core-plugins/docxtemplater/`) — headless command handlers for server-side template operations

```bash
cd examples/plugins/docxtemplater
npm install && npm run dev    # http://localhost:5174
```

Source: [`examples/plugins/docxtemplater/`](../../examples/plugins/docxtemplater/)

## Patterns

### Combining EditorPlugin + CorePlugin

A single feature can span both systems. The docxtemplater plugin does this:

| Concern                 | System                                 | Location                          |
| ----------------------- | -------------------------------------- | --------------------------------- |
| Syntax highlighting     | EditorPlugin (ProseMirror decorations) | `src/plugins/template/`           |
| Annotation panel        | EditorPlugin (Panel component)         | `src/plugins/template/`           |
| Insert variable command | CorePlugin (command handler)           | `src/core-plugins/docxtemplater/` |

Register both independently — they share data through the `Document` model.

### Adding Keyboard Shortcuts

Use `proseMirrorPlugins` with `prosemirror-keymap`:

```ts
import { keymap } from 'prosemirror-keymap';

const shortcutPlugin: EditorPlugin = {
  id: 'my-shortcuts',
  name: 'Shortcuts',
  proseMirrorPlugins: [
    keymap({
      'Mod-Shift-c': (state, dispatch) => {
        const text = state.doc.textContent;
        const words = text.split(/\s+/).filter(Boolean).length;
        console.log(`Word count: ${words}`);
        return true; // handled
      },
    }),
  ],
};
```

### Filtering or Appending Transactions

Use ProseMirror plugin hooks for transaction middleware:

```ts
import { Plugin } from 'prosemirror-state';

const guardPlugin: EditorPlugin = {
  id: 'max-length',
  name: 'Max Length',
  proseMirrorPlugins: [
    new Plugin({
      filterTransaction(tr, state) {
        // Block transactions that would exceed 10000 characters
        if (tr.docChanged) {
          const newSize = tr.doc.textContent.length;
          if (newSize > 10000) return false;
        }
        return true;
      },
    }),
  ],
};
```

### ProseMirror Decorations

```ts
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

const key = new PluginKey('spell-check');

const spellCheckPlugin: EditorPlugin = {
  id: 'spell-check',
  name: 'Spell Check',
  proseMirrorPlugins: [
    new Plugin({
      key,
      state: {
        init(_, state) {
          return findErrors(state.doc);
        },
        apply(tr, decorations, oldState, newState) {
          if (tr.docChanged) return findErrors(newState.doc);
          return decorations.map(tr.mapping, tr.doc);
        },
      },
      props: {
        decorations(state) {
          return key.getState(state);
        },
      },
    }),
  ],
};

function findErrors(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  // ... walk doc, create Decoration.inline(from, to, { class: 'error' })
  return DecorationSet.create(doc, decorations);
}
```

### Overlays with Position Mapping

Render absolutely-positioned React elements over the visible pages:

```tsx
renderOverlay(context, state, editorView) {
  if (!editorView) return null;
  const { from } = editorView.state.selection;
  const coords = context.getCoordinatesForPosition(from);
  if (!coords) return null;

  return (
    <div style={{
      position: 'absolute',
      left: coords.x,
      top: coords.y + coords.height + 4,
      background: '#fff',
      border: '1px solid #ccc',
      borderRadius: 4,
      padding: 8,
      pointerEvents: 'none',
    }}>
      Cursor at position {from}
    </div>
  );
}
```

### Connecting Plugin to Host App UI

Use `PluginHostRef` to bridge your app's buttons/controls with plugin state:

```tsx
function App() {
  const hostRef = useRef<PluginHostRef>(null);

  const clearHighlights = () => {
    hostRef.current?.setPluginState('highlights', { ranges: [] });
  };

  const getWordCount = () => {
    const state = hostRef.current?.getPluginState<{ words: number }>('word-count');
    alert(`${state?.words ?? 0} words`);
  };

  const insertAtCursor = () => {
    const view = hostRef.current?.getEditorView();
    if (!view) return;
    const { from } = view.state.selection;
    view.dispatch(view.state.tr.insertText('Inserted by app', from));
  };

  return (
    <>
      <div className="my-app-toolbar">
        <button onClick={clearHighlights}>Clear</button>
        <button onClick={getWordCount}>Count</button>
        <button onClick={insertAtCursor}>Insert</button>
      </div>
      <PluginHost ref={hostRef} plugins={[wordCountPlugin, highlightPlugin]}>
        <DocxEditor documentBuffer={file} />
      </PluginHost>
    </>
  );
}
```

## API Cookbook

### Scroll to a ProseMirror Position

From a panel component:

```ts
function MyPanel({ scrollToPosition }: PluginPanelProps<MyState>) {
  return <button onClick={() => scrollToPosition(42)}>Go to pos 42</button>;
}
```

### Select a Text Range

```ts
function MyPanel({ selectRange }: PluginPanelProps<MyState>) {
  return <button onClick={() => selectRange(10, 25)}>Select range</button>;
}
```

### Read Document Text

```ts
onStateChange(view) {
  const text = view.state.doc.textContent;
  const nodeCount = view.state.doc.childCount;
  return { text, nodeCount };
}
```

### Dispatch a ProseMirror Transaction

From a panel (or overlay) that has `editorView`:

```ts
function MyPanel({ editorView }: PluginPanelProps<MyState>) {
  const makeBold = () => {
    if (!editorView) return;
    const { from, to } = editorView.state.selection;
    if (from === to) return;
    // Look up the bold mark type from the schema
    const boldType = editorView.state.schema.marks.bold;
    if (!boldType) return;
    editorView.dispatch(
      editorView.state.tr.addMark(from, to, boldType.create())
    );
  };
  return <button onClick={makeBold}>Bold</button>;
}
```

### Get Rects for a Range (Multi-line Highlight)

```ts
renderOverlay(context, state) {
  const rects = context.getRectsForRange(state.from, state.to);
  return (
    <>
      {rects.map((r, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: r.x, top: r.y,
          width: r.width, height: r.height,
          background: 'rgba(255, 200, 0, 0.3)',
          pointerEvents: 'none',
        }} />
      ))}
    </>
  );
}
```

### Detect Selection Changes in onStateChange

Since there's no dedicated selection event, compare states:

```ts
let lastFrom = -1;
let lastTo = -1;

const selectionPlugin: EditorPlugin<SelectionInfo> = {
  id: 'selection-tracker',
  name: 'Selection',
  onStateChange(view) {
    const { from, to } = view.state.selection;
    if (from !== lastFrom || to !== lastTo) {
      lastFrom = from;
      lastTo = to;
      return { from, to, hasSelection: from !== to };
    }
    return undefined; // no change — skip re-render
  },
};
```
