# EditorPlugin API

EditorPlugins run in the browser alongside `DocxEditor`. They can contribute UI panels, document overlays, ProseMirror plugins, and scoped CSS.

## How It Works

`PluginHost` wraps `DocxEditor` and manages the plugin lifecycle:

```
┌─ PluginHost ────────────────────────────────────────┐
│  • Injects ProseMirror plugins into the editor      │
│  • Wraps editor.dispatch() to detect state changes  │
│  • Calls onStateChange() on input/focus/click/dispatch│
│  • Renders panels (left/right/bottom)               │
│  • Renders overlays on top of visible pages         │
│  • Injects/removes CSS <style> tags                 │
│                                                     │
│  ┌─ DocxEditor ──────────────────────────────┐      │
│  │  receives externalPlugins, pluginOverlays │      │
│  │  calls back onEditorViewReady,            │      │
│  │  onRenderedDomContextReady                │      │
│  └───────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────┘
```

Internally, `PluginHost` uses `React.cloneElement` to inject props into the child `DocxEditor`. This means `DocxEditor` **must** be the direct child of `PluginHost`.

## Quick Start

```tsx
import { DocxEditor, PluginHost, templatePlugin } from '@eigenpal/docx-js-editor';

function Editor({ file }: { file: ArrayBuffer }) {
  return (
    <PluginHost plugins={[templatePlugin]}>
      <DocxEditor documentBuffer={file} />
    </PluginHost>
  );
}
```

## EditorPlugin\<TState\>

```ts
interface EditorPlugin<TState = any> {
  id: string;
  name: string;
  proseMirrorPlugins?: ProseMirrorPlugin[];
  Panel?: React.ComponentType<PluginPanelProps<TState>>;
  panelConfig?: PanelConfig;
  onStateChange?: (view: EditorView) => TState | undefined;
  initialize?: (view: EditorView | null) => TState;
  destroy?: () => void;
  styles?: string;
  renderOverlay?: (
    context: RenderedDomContext,
    state: TState,
    editorView: EditorView | null
  ) => ReactNode;
}
```

### Fields

| Field                | Required | Description                                                                                                               |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | Yes      | Unique identifier. Used as key for state storage and CSS `<style>` tag IDs.                                               |
| `name`               | Yes      | Display name shown in panel collapse buttons.                                                                             |
| `proseMirrorPlugins` | No       | ProseMirror plugins merged into the editor. Use for decorations, keymaps, transaction listeners.                          |
| `Panel`              | No       | React component rendered in a side/bottom panel.                                                                          |
| `panelConfig`        | No       | Panel position, size, and collapse behavior.                                                                              |
| `onStateChange`      | No       | Called on every editor state change (input, click, focus, dispatch). Return new `TState` or `undefined` to keep existing. |
| `initialize`         | No       | Called once when the plugin loads. `view` may be `null` if editor hasn't mounted yet. Returns initial `TState`.           |
| `destroy`            | No       | Cleanup callback for timers, subscriptions, DOM listeners.                                                                |
| `styles`             | No       | CSS string injected into `<head>` on mount, removed on unmount.                                                           |
| `renderOverlay`      | No       | Return React elements positioned absolutely over the document pages.                                                      |

## Lifecycle

```
PluginHost mounts
  → initialize(view)                    // view may be null initially
  → styles injected into <head>
  → proseMirrorPlugins merged into editor

Editor mounts
  → onEditorViewReady fires             // PluginHost stores the view
  → onRenderedDomContextReady fires     // layout-painter has rendered pages

User edits / clicks / focuses
  → PluginHost's dispatch wrapper fires
  → onStateChange(view) called for ALL plugins
  → Panel re-renders with new pluginState
  → renderOverlay() called with new state + context

PluginHost unmounts
  → destroy() called
  → styles removed from <head>
```

**Important**: `onStateChange` fires on ANY change — there is no way to subscribe to specific events like "selection changed" or "focus." If you need fine-grained event detection, compare the current `view.state` against your previous state inside `onStateChange`.

## What Plugins Can Do

### 1. Render a Panel

Panel components receive `PluginPanelProps<TState>` with these interaction methods:

```ts
interface PluginPanelProps<TState> {
  editorView: EditorView | null; // Raw ProseMirror view
  doc: ProseMirrorNode | null; // Current document
  scrollToPosition: (pos: number) => void; // Scroll to a PM position
  selectRange: (from: number, to: number) => void; // Select text
  pluginState: TState; // Your managed state
  panelWidth: number; // Current panel width in px
  renderedDomContext: RenderedDomContext | null; // Position mapping (may be null)
}
```

`scrollToPosition` and `selectRange` are convenience methods. For anything beyond these (inserting text, applying formatting, changing selection type), use `editorView` directly:

```ts
function MyPanel({ editorView }: PluginPanelProps<MyState>) {
  const insertText = () => {
    if (!editorView) return;
    const { from } = editorView.state.selection;
    const tr = editorView.state.tr.insertText('Hello', from);
    editorView.dispatch(tr);
  };
  return <button onClick={insertText}>Insert "Hello"</button>;
}
```

This is the intended pattern — the built-in template plugin dispatches transactions directly from its overlay click handlers.

### 2. Render Overlays Over Pages

Overlays are React elements rendered absolutely on top of the visible document pages. Use `RenderedDomContext` to convert ProseMirror positions to pixel coordinates.

```tsx
renderOverlay(context, state, editorView) {
  const coords = context.getCoordinatesForPosition(state.cursorPos);
  if (!coords) return null;

  return (
    <div style={{
      position: 'absolute',
      left: coords.x,
      top: coords.y + coords.height + 4,
      background: '#fff',
      border: '1px solid #ccc',
      padding: 8,
      pointerEvents: 'none',
    }}>
      Tooltip at position {state.cursorPos}
    </div>
  );
}
```

### 3. Add ProseMirror Plugins

For decorations, keymaps, transaction listeners, or custom state:

```ts
import { Plugin, PluginKey } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';

const key = new PluginKey('my-decorations');

const myPlugin: EditorPlugin = {
  id: 'my-decorations',
  name: 'Decorations',
  proseMirrorPlugins: [
    new Plugin({
      key,
      state: {
        init() {
          return DecorationSet.empty;
        },
        apply(tr, set) {
          return set.map(tr.mapping, tr.doc);
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
```

Through ProseMirror plugins, you can also add **keyboard shortcuts** and **transaction filters**:

```ts
import { keymap } from 'prosemirror-keymap';

const myPlugin: EditorPlugin = {
  id: 'my-shortcuts',
  name: 'Shortcuts',
  proseMirrorPlugins: [
    keymap({
      'Mod-Shift-w': (state, dispatch) => {
        // Custom shortcut handler
        console.log('Word count shortcut triggered');
        return true;
      },
    }),
  ],
};
```

### 4. Inject Scoped CSS

```ts
const myPlugin: EditorPlugin = {
  id: 'theme',
  name: 'Theme',
  styles: `
    .ep-root .my-highlight {
      background: rgba(59, 130, 246, 0.15);
      border-bottom: 2px solid #3b82f6;
    }
  `,
};
```

Scope selectors under `.ep-root` to avoid conflicts with the host page. Styles are injected as `<style id="plugin-styles-{id}">` and cleaned up on unmount.

### 5. Access the Editor Programmatically (PluginHostRef)

The parent application can interact with plugins via a ref:

```tsx
const hostRef = useRef<PluginHostRef>(null);

// Read/write plugin state from outside
const state = hostRef.current?.getPluginState<WordCountState>('word-count');
hostRef.current?.setPluginState('word-count', { words: 0, characters: 0 });

// Get the ProseMirror EditorView
const view = hostRef.current?.getEditorView();

// Force all plugins to re-derive state
hostRef.current?.refreshPluginStates();

<PluginHost ref={hostRef} plugins={plugins}>
  <DocxEditor documentBuffer={file} />
</PluginHost>;
```

This is how the **host application ties custom functions to the plugin**. For example, a "clear highlights" button in your app's toolbar:

```tsx
function App() {
  const hostRef = useRef<PluginHostRef>(null);

  const clearHighlights = () => {
    hostRef.current?.setPluginState('highlights', { ranges: [] });
  };

  return (
    <>
      <button onClick={clearHighlights}>Clear Highlights</button>
      <PluginHost ref={hostRef} plugins={[highlightPlugin]}>
        <DocxEditor documentBuffer={file} />
      </PluginHost>
    </>
  );
}
```

## PanelConfig

```ts
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

- **Right** panels render inside the editor viewport and scroll with the document.
- **Left** and **bottom** panels render outside the viewport as fixed sidebars.

## RenderedDomContext

The editor uses a dual-DOM architecture: a hidden ProseMirror instance handles editing, while LayoutPainter draws the paginated visual output. `RenderedDomContext` translates between the two.

```ts
interface RenderedDomContext {
  pagesContainer: HTMLElement;
  zoom: number;
  getCoordinatesForPosition(pmPos: number): PositionCoordinates | null;
  findElementsForRange(from: number, to: number): Element[];
  getRectsForRange(
    from: number,
    to: number
  ): Array<{ x: number; y: number; width: number; height: number }>;
  getContainerOffset(): { x: number; y: number };
}

interface PositionCoordinates {
  x: number;
  y: number;
  height: number;
}
```

Both types are exported from the main package:

```ts
import type { RenderedDomContext, PositionCoordinates } from '@eigenpal/docx-js-editor';
```

**Important**: `renderedDomContext` may be `null` during initial render (before LayoutPainter has painted pages). Always null-check before using.

## What Plugins Cannot Do

These are explicit limitations of the current API:

| Capability                                            | Status        | Workaround                                                          |
| ----------------------------------------------------- | ------------- | ------------------------------------------------------------------- |
| Add toolbar buttons                                   | Not supported | Render buttons in your Panel component                              |
| Add context menu items                                | Not supported | Use overlay + mousedown listener for custom menus                   |
| Subscribe to specific events (selection, focus, blur) | Not supported | Compare state inside `onStateChange`                                |
| Communicate between plugins                           | Not supported | Coordinate through the parent app via `PluginHostRef`               |
| Hook into save/load                                   | Not supported | Parent app handles save; plugins read state from `editorView`       |
| Persist custom data in the DOCX file                  | Not supported | Store plugin data externally                                        |
| Intercept transactions before they apply              | Partial       | Use ProseMirror plugin's `filterTransaction` or `appendTransaction` |

For transaction interception, use a ProseMirror plugin:

```ts
proseMirrorPlugins: [
  new Plugin({
    filterTransaction(tr) {
      // Return false to block a transaction
      return true;
    },
    appendTransaction(transactions, oldState, newState) {
      // Return a new transaction to apply after the original
      return null;
    },
  }),
],
```

## Best Practices

- **Memoize `onStateChange`**: if you return a new object every call, the panel re-renders on every keystroke. Compare values before returning a new object.
- **Prevent focus stealing**: ProseMirror captures `mousedown`. Dropdowns and dialogs in panels need `onMouseDown` with `event.stopPropagation()`.
- **Scope CSS under `.ep-root`**: use inline styles on overlay/panel elements to avoid Tailwind collisions.
- **`renderOverlay` must be fast**: it runs on every state change. Avoid heavy DOM queries inside it.
- **Null-check `renderedDomContext`**: it's `null` until layout-painter finishes the first render.
- **Null-check `editorView`**: it's `null` until ProseMirror mounts. Don't assume it's always available.

## Full Example: Template Plugin

The built-in template plugin (`src/plugins/template/`) demonstrates every feature:

- **ProseMirror plugin** scans the doc for `{variable}` patterns, builds a `DecorationSet`
- **Panel** lists all detected tags with click-to-navigate
- **Overlay** renders colored highlights over the visible pages with hover/click handlers
- **CSS** styles the decorations and hover states
- **State** tracks tags, hovered ID, and selected ID

Key pattern from the template plugin — dispatching transactions from an overlay:

```ts
renderOverlay: (context, state, editorView) => {
  return <TemplateHighlightOverlay
    tags={state.tags}
    onSelect={(tagId) => {
      if (!editorView) return;
      const tag = state.tags.find(t => t.id === tagId);
      if (!tag) return;
      const tr = editorView.state.tr.setSelection(
        TextSelection.near(editorView.state.doc.resolve(tag.from))
      );
      editorView.dispatch(tr);
    }}
  />;
}
```

## Internal Extension System

The editor's core formatting (bold, italic, tables, etc.) uses a separate internal extension system in `src/prosemirror/extensions/`. This is **not** part of the plugin API — use `EditorPlugin` for all external extensions. See [docs/EXTENSIONS.md](../EXTENSIONS.md) for details.
