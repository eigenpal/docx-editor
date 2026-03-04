# Extension System (Internal)

The editor's ProseMirror layer is built on a Tiptap-style extension system. Each extension encapsulates a piece of editor functionality — a schema node, a mark, commands, keyboard shortcuts, or plugins.

> This system is internal. For adding features to the editor from the outside, use the [Plugin API](./PLUGINS.md).

## Architecture

### Extension Types

| Type            | Purpose                                                   | Example                               |
| --------------- | --------------------------------------------------------- | ------------------------------------- |
| `Extension`     | Plugins, commands, keyboard shortcuts (no schema changes) | History, BaseKeymap, SelectionTracker |
| `NodeExtension` | Adds a `NodeSpec` to the ProseMirror schema               | Paragraph, Table, Image, HardBreak    |
| `MarkExtension` | Adds a `MarkSpec` to the ProseMirror schema               | Bold, Italic, TextColor, FontSize     |

### Two-Phase Lifecycle

1. **`buildSchema()`** — Collects all `NodeSpec`/`MarkSpec` from extensions, creates the ProseMirror `Schema`
2. **`initializeRuntime()`** — Calls `onSchemaReady()` on each extension (in priority order), collects commands, keyboard shortcuts, and plugins

```typescript
const manager = new ExtensionManager(createStarterKit());
manager.buildSchema(); // Phase 1: schema
manager.initializeRuntime(); // Phase 2: commands + plugins

const schema = manager.getSchema();
const plugins = manager.getPlugins();
const toggleBold = manager.getCommand('toggleBold');
```

## Creating Extensions

### Factory Functions

Three factory functions in `src/prosemirror/extensions/create.ts`:

#### Mark Extension

```typescript
import { createMarkExtension } from '../create';
import { toggleMark } from 'prosemirror-commands';

export const BoldExtension = createMarkExtension({
  name: 'bold',
  schemaMarkName: 'bold',
  markSpec: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
    toDOM() {
      return ['strong', 0];
    },
  },
  onSchemaReady(ctx) {
    return {
      commands: {
        toggleBold: () => toggleMark(ctx.schema.marks.bold),
      },
      keyboardShortcuts: {
        'Mod-b': toggleMark(ctx.schema.marks.bold),
      },
    };
  },
});
```

#### Node Extension

```typescript
import { createNodeExtension } from '../create';

export const HardBreakExtension = createNodeExtension({
  name: 'hardBreak',
  schemaNodeName: 'hardBreak',
  nodeSpec: {
    inline: true,
    group: 'inline',
    selectable: false,
    toDOM() {
      return ['br'];
    },
    parseDOM: [{ tag: 'br' }],
  },
  onSchemaReady(ctx) {
    return {
      keyboardShortcuts: {
        'Shift-Enter': (state, dispatch) => {
          if (dispatch)
            dispatch(state.tr.replaceSelectionWith(ctx.schema.nodes.hardBreak.create()));
          return true;
        },
      },
    };
  },
});
```

#### Feature Extension (no schema)

```typescript
import { createExtension, Priority } from '../create';
import { history, undo, redo } from 'prosemirror-history';

export const HistoryExtension = createExtension<{ depth?: number }>({
  name: 'history',
  defaultOptions: { depth: 100 },
  onSchemaReady(_ctx, options) {
    return {
      plugins: [history({ depth: options.depth })],
      commands: { undo: () => undo, redo: () => redo },
      keyboardShortcuts: { 'Mod-z': undo, 'Mod-Shift-z': redo },
    };
  },
});
```

### onSchemaReady Return Value

```typescript
interface ExtensionRuntime {
  commands?: Record<string, (...args: any[]) => Command>;
  keyboardShortcuts?: Record<string, Command>;
  plugins?: ProseMirrorPlugin[];
}
```

- **commands** — registered in a flat namespace, accessible via `manager.getCommand(name)`
- **keyboardShortcuts** — converted to `keymap()` plugins, ordered by extension priority
- **plugins** — raw ProseMirror plugins, also ordered by priority

### Options

Extensions can accept typed options with defaults:

```typescript
const MyExtension = createExtension<{ debug?: boolean; maxItems?: number }>({
  name: 'myFeature',
  defaultOptions: { debug: false, maxItems: 100 },
  onSchemaReady(ctx, options) {
    // options.debug and options.maxItems are available here
  },
});

// Usage:
MyExtension({ debug: true }); // maxItems defaults to 100
```

For node/mark extensions, `nodeSpec`/`markSpec` can be a function receiving options:

```typescript
const MyNode = createNodeExtension<{ placeholder?: string }>({
  name: 'myNode',
  schemaNodeName: 'myNode',
  defaultOptions: { placeholder: '' },
  nodeSpec: (options) => ({
    attrs: { placeholder: { default: options.placeholder } },
    // ...
  }),
});
```

### Priority

Controls the order in which extensions contribute keymaps and plugins:

```typescript
const Priority = {
  Highest: 0,
  High: 50, // ListExtension — intercepts Tab/Enter before base keymap
  Default: 100,
  Low: 150, // BaseKeymapExtension — fallback handlers
  Lowest: 200,
};
```

Higher-priority extensions can override keyboard shortcuts from lower-priority ones.

## StarterKit

`createStarterKit()` bundles all 26+ built-in extensions:

```typescript
interface StarterKitOptions {
  disable?: string[]; // Extension names to exclude
  historyDepth?: number; // Default: 100
  historyNewGroupDelay?: number; // Default: 500
  onSelectionChange?: SelectionChangeCallback;
}

const extensions = createStarterKit({ disable: ['footnoteRef'] });
```

### Built-in Extensions

**Core:** doc, text, paragraph, history

**Marks:** bold, italic, underline, strike, textColor, highlight, fontSize, fontFamily, superscript, subscript, hyperlink, allCaps, smallCaps, footnoteRef

**Nodes:** hardBreak, tab, image, horizontalRule, table (+ tableRow, tableCell, tableHeader)

**Features:** list, baseKeymap, selectionTracker

## Command Registry

All extension commands are registered in a flat namespace:

| Category    | Commands                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| Formatting  | `toggleBold`, `toggleItalic`, `toggleUnderline`, `toggleStrike`, `toggleSuperscript`, `toggleSubscript`    |
| Color       | `setTextColor`, `clearTextColor`, `setHighlight`, `clearHighlight`                                         |
| Font        | `setFontSize`, `setFontFamily`, `clearFormatting`                                                          |
| Paragraph   | `setAlignment`, `alignLeft`, `alignCenter`, `alignRight`, `alignJustify`                                   |
| Spacing     | `setLineSpacing`, `singleSpacing`, `oneAndHalfSpacing`, `doubleSpacing`, `setSpaceBefore`, `setSpaceAfter` |
| Indentation | `increaseIndent`, `decreaseIndent`                                                                         |
| Lists       | `toggleBulletList`, `toggleNumberedList`, `increaseListLevel`, `decreaseListLevel`, `removeList`           |
| Styles      | `applyStyle`, `clearStyle`                                                                                 |
| History     | `undo`, `redo`                                                                                             |

Access via `manager.getCommand('toggleBold')()` — note the double call: first gets the factory, second creates the ProseMirror `Command`.

## File Structure

```
src/prosemirror/extensions/
├── types.ts              # Type definitions
├── create.ts             # Factory functions (createExtension, createNodeExtension, createMarkExtension)
├── ExtensionManager.ts   # Two-phase manager
├── StarterKit.ts         # Bundles all extensions
├── index.ts              # Barrel export
├── core/                 # doc, text, paragraph, history
├── marks/                # bold, italic, underline, strike, colors, fonts, ...
│   └── markUtils.ts      # Shared mark utilities (setMark, removeMark, isMarkActive)
├── nodes/                # hardBreak, tab, image, horizontalRule, table
└── features/             # baseKeymap, list, selectionTracker
```
