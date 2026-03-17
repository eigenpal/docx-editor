# Spec: Format Menu + Text Formatting

## Overview

Expand the Format menu with text formatting options (strikethrough, small caps, all caps, character spacing). Add a strikethrough button to the toolbar. Wire everything to existing extension commands.

## File Changes

### 1. `packages/core/src/prosemirror/plugins/selectionTracker.ts`

#### 1.1 Track smallCaps, allCaps, characterSpacing in textFormatting

In the text formatting extraction (where marks at cursor are read), ensure these fields are included:

```typescript
// In the marks extraction loop:
smallCaps: boolean; // from SmallCapsExtension mark
allCaps: boolean; // from AllCapsExtension mark
characterSpacing: number; // from CharacterSpacingExtension mark's 'spacing' attr (twips)
```

If `textFormatting` already includes these from the `TextFormatting` type, verify they're actually being read from active marks. If not, add extraction logic.

### 2. `packages/react/src/components/Toolbar.tsx`

#### 2.1 Restructure Format menu

Replace the current Format menu (which only has LTR/RTL) with a full menu:

```tsx
const formatMenuItems = [
  // Text formatting section
  { type: 'header', label: 'Text' },
  { label: 'Bold', action: 'toggleBold', shortcut: '⌘B', checked: textFormatting.bold },
  { label: 'Italic', action: 'toggleItalic', shortcut: '⌘I', checked: textFormatting.italic },
  {
    label: 'Underline',
    action: 'toggleUnderline',
    shortcut: '⌘U',
    checked: textFormatting.underline,
  },
  {
    label: 'Strikethrough',
    action: 'toggleStrike',
    shortcut: '⌘⇧X',
    checked: textFormatting.strike,
  },
  { type: 'separator' },
  { label: 'Small Caps', action: 'toggleSmallCaps', checked: textFormatting.smallCaps },
  { label: 'All Caps', action: 'toggleAllCaps', checked: textFormatting.allCaps },
  { type: 'separator' },
  // Character spacing submenu
  {
    label: 'Character spacing',
    submenu: [
      { label: 'Normal', action: 'setCharSpacing', value: 0 },
      { label: 'Expanded (+1pt)', action: 'setCharSpacing', value: 20 },
      { label: 'Expanded (+2pt)', action: 'setCharSpacing', value: 40 },
      { label: 'Condensed (−1pt)', action: 'setCharSpacing', value: -20 },
      { label: 'Condensed (−2pt)', action: 'setCharSpacing', value: -40 },
    ],
  },
  { type: 'separator' },
  // Bidi (existing)
  { label: 'Left-to-Right Text', action: 'setLtr' },
  { label: 'Right-to-Left Text', action: 'setRtl' },
];
```

Note: The `checked` property on text items shows a checkmark when that formatting is active on the current selection. The character spacing submenu shows a checkmark on the matching value.

### 3. `packages/react/src/components/FormattingBar.tsx`

#### 3.1 Add strikethrough button

Insert after the underline button (before text color):

```tsx
<ToolbarButton
  icon="strikethrough_s"
  tooltip="Strikethrough (Ctrl+Shift+X)"
  active={textFormatting.strike}
  onClick={() => onFormat('toggleStrike')}
/>
```

The Material Symbol `strikethrough_s` should already be available (same icon set used for other toolbar buttons).

### 4. `packages/react/src/components/toolbarUtils.ts`

#### 4.1 Add formatting action handlers

In `applyFormattingAction()` add:

```typescript
case 'toggleStrike':
  return manager.commands.toggleStrike();
case 'toggleSmallCaps':
  return manager.commands.toggleSmallCaps();
case 'toggleAllCaps':
  return manager.commands.toggleAllCaps();
case 'setCharSpacing':
  // value passed as parameter (twips)
  return manager.commands.setCharacterSpacing({ spacing: value });
```

For the character spacing action, the menu item click handler needs to pass the `value` parameter through. If `applyFormattingAction` doesn't support value params, extend its signature:

```typescript
export function applyFormattingAction(
  manager: ExtensionManager,
  action: string,
  value?: number | string
): boolean;
```

### 5. `packages/react/src/components/ui/MenuDropdown.tsx`

#### 5.1 Support `checked` state on menu items (if not already)

Menu items need to show a checkmark (✓) when `checked: true`. Verify this is supported. If not, add:

```tsx
{
  item.checked && <span className="menu-check">✓</span>;
}
```

#### 5.2 Support submenu rendering (if not already)

The "Character spacing" item needs a submenu flyout. Verify `MenuDropdown` supports nested `submenu` arrays. If not, add hover-triggered submenu rendering.

## Icons — Manual SVG Import Required

Icons are **not** loaded from Google Fonts CDN. They are inline SVG React components in `packages/react/src/components/ui/Icons.tsx` (~900 lines). Each icon is a function component using a `SvgIcon` wrapper (viewBox `0 -960 960 960`, `fill="currentColor"`), registered in an `iconMap` object.

**To add a new icon:**

1. Find the icon on [Material Symbols](https://fonts.google.com/icons)
2. Copy the SVG path data
3. Add a new component in `Icons.tsx`:
   ```tsx
   function IconMyIcon({ size, className, style }: IconProps) {
     return (
       <SvgIcon size={size} className={className} style={style}>
         <path d="..." />
       </SvgIcon>
     );
   }
   ```
4. Register in `iconMap`: `my_icon: IconMyIcon,`

**Icons needed for this PR:**

- `strikethrough_s` — **already exists** in iconMap (verify before adding)
- No new icons needed for Format menu items (they're text-only menu items, no icons)

**Usage pattern:**

```tsx
import { MaterialSymbol } from './ui/MaterialSymbol';
<MaterialSymbol name="strikethrough_s" size={18} />;
```

## Dependencies

- `StrikeExtension.toggleStrike()` — exists
- `SmallCapsExtension.toggleSmallCaps()` — exists
- `AllCapsExtension.toggleAllCaps()` — exists
- `CharacterSpacingExtension.setCharacterSpacing({ spacing })` — exists

## TypeScript Types

No new types. Existing `TextFormatting` from `types/formatting.ts` already includes `strike`, `smallCaps`, `allCaps`. Character spacing value comes from the mark's `spacing` attribute.
