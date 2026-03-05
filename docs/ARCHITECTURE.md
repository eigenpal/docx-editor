# Architecture

## Dual Rendering System

The editor has two rendering systems running simultaneously:

```
┌──────────────────────────────────────────┐
│  HIDDEN ProseMirror (off-screen)         │
│  Real editing state, selection, undo     │
│  Receives keyboard input                 │
│  CSS: .paged-editor__hidden-pm           │
└──────────────┬───────────────────────────┘
               │ state changes
               ▼
┌──────────────────────────────────────────┐
│  VISIBLE Pages (layout-painter)          │
│  What the user sees — static DOM         │
│  Rebuilt from PM state on every change   │
│  CSS: .paged-editor__pages               │
└──────────────────────────────────────────┘
```

User clicks on visible pages get mapped back to ProseMirror positions via `getPositionFromMouse()`.

## Data Flow

```
DOCX → unzip → parser → Document model (types/)
  → toProseDoc → ProseMirror doc
  → HiddenProseMirror (off-screen)
  → layout-painter renders visible pages
  → user edits → PM state updates → re-render

Saving: PM state → fromProseDoc → Document model → serializer → XML → rezip → DOCX
```

## Key Directories

| Directory                     | What it does                              |
| ----------------------------- | ----------------------------------------- |
| `src/docx/`                   | DOCX XML parsing (paragraphs, tables...)  |
| `src/types/`                  | Document model types                      |
| `src/prosemirror/conversion/` | `toProseDoc` / `fromProseDoc` converters  |
| `src/prosemirror/extensions/` | ProseMirror schema, commands, keybindings |
| `src/layout-painter/`         | Visible page rendering                    |
| `src/paged-editor/`           | PagedEditor component, click/selection    |
| `src/components/`             | Toolbar, dialogs, UI                      |
| `src/plugin-api/`             | External plugin system                    |

## Extension System (Internal)

The ProseMirror layer uses a Tiptap-style extension system. Three types:

| Type            | Purpose                        | Examples                           |
| --------------- | ------------------------------ | ---------------------------------- |
| `Extension`     | Plugins, commands, keybindings | History, BaseKeymap, ListExtension |
| `NodeExtension` | Adds a NodeSpec to the schema  | Paragraph, Table, Image            |
| `MarkExtension` | Adds a MarkSpec to the schema  | Bold, Italic, TextColor, FontSize  |

Two-phase lifecycle:

```typescript
const manager = new ExtensionManager(createStarterKit());
manager.buildSchema(); // Phase 1: collect NodeSpec/MarkSpec → Schema
manager.initializeRuntime(); // Phase 2: collect commands, keymaps, plugins
```

Extensions live in `src/prosemirror/extensions/` — `core/`, `marks/`, `nodes/`, `features/`. `StarterKit.ts` bundles all 26+ built-in extensions.

For adding features **from the outside**, use the [Plugin API](./PLUGINS.md) instead.

## Common Pitfall

If you fix a visual bug in ProseMirror's `toDOM`, **the user won't see it** — visible pages are rendered by `layout-painter/`, not by ProseMirror.
