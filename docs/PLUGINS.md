# Plugin System

The editor has a plugin system that lets you add UI panels, document overlays, ProseMirror plugins, and custom styles — without modifying editor internals.

## Quick Start

```tsx
import { DocxEditor, PluginHost, templatePlugin } from '@eigenpal/docx-js-editor';
import '@eigenpal/docx-js-editor/styles.css';

function Editor({ file }: { file: ArrayBuffer }) {
  return (
    <PluginHost plugins={[templatePlugin]}>
      <DocxEditor documentBuffer={file} />
    </PluginHost>
  );
}
```

Wrap `DocxEditor` in `PluginHost` and pass an array of plugins. Each plugin can contribute any combination of:

- **ProseMirror plugins** — decorations, keymaps, transaction listeners
- **Panels** — React components rendered alongside the editor (left, right, or bottom)
- **Overlays** — React elements positioned over the rendered pages
- **CSS styles** — injected automatically on mount, cleaned up on unmount

## EditorPlugin Interface

```typescript
interface EditorPlugin<TState = any> {
  /** Unique plugin identifier */
  id: string;

  /** Display name (shown in panel toggle buttons) */
  name: string;

  /** ProseMirror plugins merged with the editor's internal plugins */
  proseMirrorPlugins?: ProseMirrorPlugin[];

  /** React component rendered in a side/bottom panel */
  Panel?: React.ComponentType<PluginPanelProps<TState>>;

  /** Panel position and size configuration */
  panelConfig?: PanelConfig;

  /** Called on every editor state change. Return new state or undefined to keep existing. */
  onStateChange?: (view: EditorView, context?: PluginStateChangeContext) => TState | undefined;

  /** Called once when the plugin is first loaded */
  initialize?: (view: EditorView | null) => TState;

  /** Called when the plugin is destroyed (cleanup timers, subscriptions) */
  destroy?: () => void;

  /** CSS string injected into the document head */
  styles?: string;

  /** Render overlay elements positioned over the document pages */
  renderOverlay?: (
    context: RenderedDomContext,
    state: TState,
    editorView: EditorView | null
  ) => ReactNode;
}
```

## Creating a Plugin

### Minimal Example

A plugin that logs every document change:

```typescript
import type { EditorPlugin } from '@eigenpal/docx-js-editor';

const loggerPlugin: EditorPlugin = {
  id: 'logger',
  name: 'Logger',
  onStateChange(view) {
    console.log('Doc size:', view.state.doc.content.size);
    return undefined; // no state to track
  },
};
```

### Plugin with a Panel

```typescript
import type { EditorPlugin, PluginPanelProps } from '@eigenpal/docx-js-editor';

interface WordCountState {
  words: number;
  characters: number;
}

function WordCountPanel({ pluginState }: PluginPanelProps<WordCountState>) {
  return (
    <div style={{ padding: 12 }}>
      <p>Words: {pluginState?.words ?? 0}</p>
      <p>Characters: {pluginState?.characters ?? 0}</p>
    </div>
  );
}

const wordCountPlugin: EditorPlugin<WordCountState> = {
  id: 'word-count',
  name: 'Word Count',
  Panel: WordCountPanel,
  panelConfig: {
    position: 'right',
    defaultSize: 200,
    collapsible: true,
    defaultCollapsed: false,
  },
  initialize: () => ({ words: 0, characters: 0 }),
  onStateChange(view) {
    const text = view.state.doc.textContent;
    return {
      words: text.split(/\s+/).filter(Boolean).length,
      characters: text.length,
    };
  },
};
```

### Plugin with an Overlay

Overlays render on top of the document pages. Use the `RenderedDomContext` to map ProseMirror positions to pixel coordinates.

```typescript
import type { EditorPlugin, RenderedDomContext } from '@eigenpal/docx-js-editor';

const highlightPlugin: EditorPlugin<number[]> = {
  id: 'highlight',
  name: 'Highlight',
  initialize: () => [],
  renderOverlay(context: RenderedDomContext, positions: number[]) {
    // Get pixel rects for each position range
    const rects = positions.flatMap((pos) =>
      context.getRectsForRange(pos, pos + 1)
    );

    return (
      <>
        {rects.map((rect, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              background: 'rgba(255, 255, 0, 0.3)',
              pointerEvents: 'none',
            }}
          />
        ))}
      </>
    );
  },
};
```

### Plugin with ProseMirror Plugins

```typescript
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorPlugin } from '@eigenpal/docx-js-editor';

const pluginKey = new PluginKey('my-decorations');

const decorationPlugin: EditorPlugin = {
  id: 'my-decorations',
  name: 'Decorations',
  proseMirrorPlugins: [
    new Plugin({
      key: pluginKey,
      state: {
        init() {
          return DecorationSet.empty;
        },
        apply(tr, set) {
          // Update decorations based on transactions
          return set.map(tr.mapping, tr.doc);
        },
      },
      props: {
        decorations(state) {
          return pluginKey.getState(state);
        },
      },
    }),
  ],
};
```

## Panel Configuration

```typescript
interface PanelConfig {
  position: 'left' | 'right' | 'bottom'; // default: 'right'
  defaultSize: number; // pixels, default: 280
  minSize?: number; // default: 200
  maxSize?: number; // default: 500
  resizable?: boolean; // default: true
  collapsible?: boolean; // default: true
  defaultCollapsed?: boolean; // default: false
}
```

Right-positioned panels render inside the editor viewport and scroll with the document. Left and bottom panels render outside the viewport as fixed sidebars.

## PluginPanelProps

Panel components receive these props:

```typescript
interface PluginPanelProps<TState> {
  editorView: EditorView | null;
  doc: ProseMirrorNode | null;
  scrollToPosition: (pos: number) => void;
  selectRange: (from: number, to: number) => void;
  pluginState: TState;
  panelWidth: number;
  renderedDomContext: RenderedDomContext | null;
}

interface PluginStateChangeContext {
  documentModel: Document | null;
  mutateDocumentModel?: (updater: (document: Document) => Document | null) => boolean;
}
```

- `scrollToPosition` — scrolls the editor to show a ProseMirror position
- `selectRange` — sets a text selection in the editor
- `renderedDomContext` — for mapping ProseMirror positions to DOM coordinates (may be null during initial render)

## RenderedDomContext

The rendered DOM context bridges ProseMirror document positions and the visual page layout:

```typescript
interface RenderedDomContext {
  pagesContainer: HTMLElement;
  zoom: number;
  getCoordinatesForPosition(pmPos: number): { x: number; y: number; height: number } | null;
  findElementsForRange(from: number, to: number): Element[];
  getRectsForRange(
    from: number,
    to: number
  ): Array<{ x: y; y: number; width: number; height: number }>;
  getContainerOffset(): { x: number; y: number };
}
```

This is necessary because the editor uses a dual-DOM architecture: a hidden ProseMirror instance handles editing while a separate visual renderer (LayoutPainter) draws the paginated output. The context translates between the two.

## PluginHost Ref

For programmatic access, use a ref on `PluginHost`:

```tsx
const hostRef = useRef<PluginHostRef>(null);

// Get/set plugin state
const state = hostRef.current?.getPluginState<MyState>('my-plugin');
hostRef.current?.setPluginState('my-plugin', newState);

// Access the editor view
const view = hostRef.current?.getEditorView();

// Force refresh all plugin states
hostRef.current?.refreshPluginStates();

<PluginHost ref={hostRef} plugins={plugins}>
  <DocxEditor documentBuffer={file} />
</PluginHost>;
```

## Built-in Plugins

### Docxtemplater Plugin

Syntax highlighting and annotation panel for [docxtemplater](https://docxtemplater.com) template tags.

```tsx
import { DocxEditor, PluginHost, templatePlugin } from '@eigenpal/docx-js-editor';

// Default configuration
<PluginHost plugins={[templatePlugin]}>
  <DocxEditor documentBuffer={file} />
</PluginHost>;

// Custom configuration
import { createTemplatePlugin } from '@eigenpal/docx-js-editor';

const myPlugin = createTemplatePlugin({
  panelPosition: 'left',
  panelWidth: 320,
  defaultCollapsed: true,
});

<PluginHost plugins={[myPlugin]}>
  <DocxEditor documentBuffer={file} />
</PluginHost>;
```

Features:

- Detects variables (`{name}`), loops (`{#items}...{/items}`), and conditionals
- Color-coded highlighting by tag type
- Side panel showing template structure
- Click-to-navigate from panel to tag in the document

See [`src/plugins/template/README.md`](../src/plugins/template/README.md) for full details.

### Review Plugin

Tracked changes review plugin for documents that already contain revisions.

```tsx
import { DocxEditor, PluginHost, reviewPlugin } from '@eigenpal/docx-js-editor';

<PluginHost plugins={[reviewPlugin]}>
  <DocxEditor documentBuffer={file} />
</PluginHost>;
```

Features:

- Extract revision ranges (insertions, deletions, moves)
- Per-page, right-side review rails near the active pages
- Click-to-jump from rail items to document locations
- Per-item accept/reject for supported revisions
- Header/footer revisions are included in the rail (view-only for now)
- Guarded fallback for unsupported revision structures

See [`src/plugins/review/README.md`](../src/plugins/review/README.md) for details.

## Internal Extension System

Under the hood, the editor uses a separate **extension system** (`src/prosemirror/extensions/`) for its core ProseMirror schema, commands, and keyboard shortcuts. This is a Tiptap-style architecture with three extension types:

- **Extension** — contributes plugins and commands (e.g., history, base keymap)
- **NodeExtension** — adds a node to the ProseMirror schema (e.g., paragraph, table, image)
- **MarkExtension** — adds a mark to the schema (e.g., bold, italic, text color)

All 26+ built-in extensions are bundled via `createStarterKit()`. This system is internal and not part of the public API — use the Plugin API described above for extending the editor.

For details on the extension architecture, see [`docs/EXTENSIONS.md`](./EXTENSIONS.md).
