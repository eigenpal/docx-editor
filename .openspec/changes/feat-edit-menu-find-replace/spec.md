# Spec: Edit Menu + Find & Replace + Spell Check

## Overview

Add an Edit menu to the toolbar with Undo/Redo, Find & Replace, Select All, and a spell check toggle. Connect Find & Replace menu items to the existing dialog. Enable browser-native spell check.

## File Changes

### 1. `packages/react/src/components/Toolbar.tsx`

#### 1.1 Add Edit menu between File and Format

```tsx
<MenuDropdown label="Edit" items={editMenuItems} />
```

Position: after File menu, before Format menu.

#### 1.2 Define Edit menu items

```tsx
const editMenuItems = [
  { label: 'Undo', shortcut: '⌘Z', action: 'undo', disabled: !canUndo },
  { label: 'Redo', shortcut: '⌘Y', action: 'redo', disabled: !canRedo },
  { type: 'separator' },
  { label: 'Find', shortcut: '⌘F', action: 'openFind' },
  { label: 'Find and Replace', shortcut: '⌘H', action: 'openFindReplace' },
  { type: 'separator' },
  { label: 'Select All', shortcut: '⌘A', action: 'selectAll' },
  { type: 'separator' },
  { label: 'Spelling', action: 'toggleSpellCheck', checked: spellCheckEnabled },
];
```

#### 1.3 Handle Edit menu actions

```typescript
const handleEditAction = (action: string) => {
  switch (action) {
    case 'undo':
      onFormat('undo');
      break;
    case 'redo':
      onFormat('redo');
      break;
    case 'openFind':
      onOpenFind?.();
      break;
    case 'openFindReplace':
      onOpenFindReplace?.();
      break;
    case 'selectAll':
      onFormat('selectAll');
      break;
    case 'toggleSpellCheck':
      onToggleSpellCheck?.();
      break;
  }
};
```

The `onOpenFind` and `onOpenFindReplace` callbacks trigger the existing `FindReplaceDialog` in find-only or find-and-replace mode. These callbacks likely already exist (used by the Ctrl+F/H keyboard handlers).

### 2. `packages/react/src/components/DocxEditor.tsx` (or parent component)

#### 2.1 Wire Find & Replace menu triggers

The component that manages `FindReplaceDialog` state needs to expose open callbacks. If it uses `useFindReplace` hook, the hook likely has `openFind()` and `openFindReplace()` methods. Pass these as props to `Toolbar`.

#### 2.2 Add spell check state

```typescript
const [spellCheckEnabled, setSpellCheckEnabled] = useState(true);
```

Pass `spellCheckEnabled` and `setSpellCheckEnabled` to both:

- Toolbar (for the Edit menu toggle)
- HiddenProseMirror (for the contenteditable attribute)

### 3. `packages/react/src/components/paged-editor/HiddenProseMirror.tsx`

#### 3.1 Set spellcheck attribute

On the contenteditable element (the ProseMirror mount point), set:

```tsx
<div
  ref={editorRef}
  spellCheck={spellCheckEnabled}
  // ... existing props
/>
```

Note: ProseMirror EditorView may need the attribute set via `EditorView.dom.setAttribute('spellcheck', 'true')` after view creation, since PM manages its own DOM. Check how PM handles this — the `attributes` option in `EditorView` config is the cleanest:

```typescript
new EditorView(mountEl, {
  // existing config...
  attributes: {
    spellcheck: spellCheckEnabled ? 'true' : 'false',
  },
});
```

Or use `EditorView.setProps()` to update dynamically when toggle changes.

### 4. `packages/react/src/components/toolbarUtils.ts`

#### 4.1 Add selectAll action

```typescript
case 'selectAll':
  // Select entire document
  const { doc } = view.state;
  const tr = view.state.tr.setSelection(
    TextSelection.create(doc, 0, doc.content.size)
  );
  view.dispatch(tr);
  return true;
```

Or use ProseMirror's built-in `selectAll` command from `prosemirror-commands` if available.

## Icons — Manual SVG Import Required

Icons are inline SVG React components in `packages/react/src/components/ui/Icons.tsx`, registered in an `iconMap` object. They are **not** loaded from Google Fonts CDN.

**To add a new icon:** Copy SVG path from [Material Symbols](https://fonts.google.com/icons), create a component in `Icons.tsx`, register in `iconMap`.

**Icons for this PR:**

- Edit menu items are text-only (like Format menu) — no icons needed for menu items
- If the "Spelling" toggle item needs a `spellcheck` icon, add it to `Icons.tsx`
- Undo/Redo icons already exist in `iconMap` (`undo`, `redo`)

## Dependencies

- `FindReplaceDialog.tsx` — exists, fully functional
- `useFindReplace.ts` — hook with open/close/search methods
- `HistoryExtension` — provides `undo`/`redo` commands
- `MenuDropdown` component — used for File/Format menus already

## TypeScript Types

```typescript
// New Toolbar props (add to existing):
onOpenFind?: () => void;
onOpenFindReplace?: () => void;
onToggleSpellCheck?: () => void;
spellCheckEnabled?: boolean;
```
