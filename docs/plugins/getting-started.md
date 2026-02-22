# Getting Started with Plugins

The docx-editor has two plugin systems for different use cases:

|              | **EditorPlugin**                                           | **CorePlugin**                                     |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------- |
| Environment  | Browser (React)                                            | Node.js (headless)                                 |
| Purpose      | UI panels, overlays, ProseMirror decorations               | Command handlers, MCP tools for AI                 |
| Registration | `<PluginHost plugins={[...]}>` wrapping `<DocxEditor>`     | `pluginRegistry.register(plugin)`                  |
| State model  | Reactive — `onStateChange` fires on every edit/click/focus | Stateless — pure functions transforming `Document` |
| Entry point  | `src/plugin-api`                                           | `src/core-plugins`                                 |

Most plugins are **EditorPlugins**. Use a **CorePlugin** only when you need headless document manipulation (no DOM) or want to expose tools to AI assistants via MCP.

## How Registration Works

### EditorPlugin

Plugins are passed as an array to `PluginHost`, which wraps your `DocxEditor`:

```tsx
import { DocxEditor, PluginHost } from '@eigenpal/docx-js-editor';
import { myPlugin } from './myPlugin';

<PluginHost plugins={[myPlugin]}>
  <DocxEditor documentBuffer={file} />
</PluginHost>;
```

`PluginHost` uses `React.cloneElement` internally to inject the plugin's ProseMirror plugins and overlay renderers into `DocxEditor`. It also wraps the editor's `dispatch` function to detect state changes and call your `onStateChange` callbacks.

**There is no imperative `register()` call** — the plugin array is declarative. Adding or removing a plugin means changing the array prop.

### CorePlugin

CorePlugins are registered imperatively on the global registry:

```ts
import { pluginRegistry, docxtemplaterPlugin } from '@eigenpal/docx-js-editor';

pluginRegistry.register(docxtemplaterPlugin);
```

## Hello World — Word Count Plugin

### 1. Define plugin state

```ts
interface WordCountState {
  words: number;
  characters: number;
  paragraphs: number;
}
```

### 2. Create the panel component

The panel receives `PluginPanelProps<TState>`. Key props:

- `pluginState` — your managed state
- `editorView` — raw ProseMirror `EditorView` (use for dispatching transactions)
- `scrollToPosition(pos)` — scroll to a position
- `selectRange(from, to)` — select a text range
- `renderedDomContext` — map PM positions to pixel coordinates (may be null)

```tsx
function WordCountPanel({ pluginState }: PluginPanelProps<WordCountState>) {
  return (
    <div style={{ padding: 16 }}>
      <p>Words: {pluginState.words}</p>
      <p>Characters: {pluginState.characters}</p>
      <p>Paragraphs: {pluginState.paragraphs}</p>
    </div>
  );
}
```

### 3. Wire it into an EditorPlugin

```ts
import type { EditorPlugin } from '@eigenpal/docx-js-editor';

export const wordCountPlugin: EditorPlugin<WordCountState> = {
  id: 'word-count',
  name: 'Word Count',
  Panel: WordCountPanel,
  panelConfig: { position: 'right', defaultSize: 220, collapsible: true },

  initialize: () => ({ words: 0, characters: 0, paragraphs: 0 }),

  onStateChange(view) {
    const text = view.state.doc.textContent;
    return {
      words: text.split(/\s+/).filter(Boolean).length,
      characters: text.length,
      paragraphs: view.state.doc.childCount,
    };
  },
};
```

### 4. Mount it

```tsx
<PluginHost plugins={[wordCountPlugin]}>
  <DocxEditor documentBuffer={file} />
</PluginHost>
```

### 5. Connect it to your app

The parent app can interact with plugin state via `PluginHostRef`:

```tsx
const hostRef = useRef<PluginHostRef>(null);

// Read plugin state from the outside
const count = hostRef.current?.getPluginState<WordCountState>('word-count');
console.log(`Document has ${count?.words} words`);

// Force all plugins to refresh
hostRef.current?.refreshPluginStates();

<PluginHost ref={hostRef} plugins={[wordCountPlugin]}>
  <DocxEditor documentBuffer={file} />
</PluginHost>;
```

### 6. Run the example

```bash
cd examples/plugins/hello-world
npm install   # or bun install
npm run dev   # opens http://localhost:5175
```

## What Plugins Can and Cannot Do

**Can do:**

- Render panels (left/right/bottom) with full React UI
- Render overlays positioned over the document pages
- Add ProseMirror plugins (decorations, keymaps, transaction filters)
- Inject/remove scoped CSS
- Read the full ProseMirror state (`editorView.state`)
- Dispatch ProseMirror transactions (`editorView.dispatch(tr)`)
- Scroll to positions and select text ranges

**Cannot do (current limitations):**

- Add buttons to the built-in toolbar
- Add items to the context menu
- Subscribe to specific events (only `onStateChange` for all changes)
- Communicate directly between plugins
- Hook into save/load
- Persist custom data in the DOCX file

See [EditorPlugin API](./editor-plugins.md) for the full reference including workarounds.

## Next Steps

- [EditorPlugin API reference](./editor-plugins.md) — full interface, lifecycle, panels, overlays, limitations
- [CorePlugin & MCP](./core-plugins.md) — headless plugins, command handlers, AI integration
- [Examples & Cookbook](./examples.md) — advanced patterns and recipes
