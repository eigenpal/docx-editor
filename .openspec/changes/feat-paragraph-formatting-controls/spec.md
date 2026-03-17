# Spec: Paragraph Formatting Controls

## Overview

Add paragraph spacing (before/after) toggles to the line spacing dropdown, and fix indent/outdent toolbar buttons to work on non-list paragraphs.

## File Changes

### 1. `packages/core/src/prosemirror/plugins/selectionTracker.ts`

#### 1.1 Add spaceBefore/spaceAfter to paragraph formatting extraction

In the paragraph formatting extraction block (around lines 85-113), add:

```typescript
spaceBefore: resolvedAttrs.spaceBefore ?? 0,
spaceAfter: resolvedAttrs.spaceAfter ?? 0,
```

These values are in twips (20 twips = 1pt).

### 2. `packages/react/src/components/ui/LineSpacingPicker.tsx`

#### 2.1 Add props for paragraph spacing

```typescript
// New props (add to existing interface):
spaceBefore?: number;                         // current spaceBefore in twips
spaceAfter?: number;                          // current spaceAfter in twips
onSpaceBeforeChange?: (twips: number) => void;
onSpaceAfterChange?: (twips: number) => void;
```

#### 2.2 Add paragraph spacing toggle items

Below the line spacing presets and the existing "Paragraph spacing" section header:

```tsx
const DEFAULT_SPACE = 160; // 8pt in twips

// "Add space before" or "Remove space before" depending on current value
<MenuItem onClick={() => onSpaceBeforeChange?.(spaceBefore ? 0 : DEFAULT_SPACE)}>
  {spaceBefore ? 'Remove space before paragraph' : 'Add space before paragraph'}
</MenuItem>

// Same for after
<MenuItem onClick={() => onSpaceAfterChange?.(spaceAfter ? 0 : DEFAULT_SPACE)}>
  {spaceAfter ? 'Remove space after paragraph' : 'Add space after paragraph'}
</MenuItem>
```

#### 2.3 Export spacing constants

```typescript
export const DEFAULT_PARAGRAPH_SPACE_TWIPS = 160; // 8pt
export const TWIPS_PER_PT = 20;
```

### 3. `packages/react/src/components/FormattingBar.tsx`

#### 3.1 Pass spacing props to LineSpacingPicker

Read from selection context and wire to commands:

```typescript
<LineSpacingPicker
  value={paragraphFormatting.lineSpacing}
  onChange={handleLineSpacingChange}       // existing
  spaceBefore={paragraphFormatting.spaceBefore}
  spaceAfter={paragraphFormatting.spaceAfter}
  onSpaceBeforeChange={(twips) => onFormat('setSpaceBefore', twips)}
  onSpaceAfterChange={(twips) => onFormat('setSpaceAfter', twips)}
/>
```

### 4. `packages/react/src/components/ui/ListButtons.tsx`

#### 4.1 Branch indent/outdent on list context

Replace current indent/outdent handlers:

```typescript
const handleIndent = () => {
  if (inList) {
    onFormat('increaseListLevel'); // existing behavior
  } else {
    onFormat('increaseIndent'); // NEW: general paragraph indent
  }
};

const handleOutdent = () => {
  if (inList) {
    onFormat('decreaseListLevel'); // existing behavior
  } else {
    onFormat('decreaseIndent'); // NEW: general paragraph outdent
  }
};
```

#### 4.2 Disable outdent at zero indent

When not in a list and `indentLeft` is 0 or undefined, disable the outdent button:

```typescript
const canOutdent = inList || (paragraphFormatting.indentLeft ?? 0) > 0;
```

### 5. `packages/react/src/components/toolbarUtils.ts`

#### 5.1 Add action handlers

```typescript
case 'increaseIndent':
  return manager.commands.increaseIndent();
case 'decreaseIndent':
  return manager.commands.decreaseIndent();
case 'setSpaceBefore':
  return manager.commands.setSpaceBefore(value as number);
case 'setSpaceAfter':
  return manager.commands.setSpaceAfter(value as number);
```

If `applyFormattingAction` doesn't accept a `value` param yet, extend the signature (may already be done in PR1).

## Icons — Manual SVG Import Required

Icons are inline SVG React components in `packages/react/src/components/ui/Icons.tsx`, registered in an `iconMap` object. They are **not** loaded from Google Fonts CDN.

**To add a new icon:** Copy SVG path from [Material Symbols](https://fonts.google.com/icons), create a component in `Icons.tsx`, register in `iconMap`.

**Icons for this PR:** The indent (`format_indent_increase`) and outdent (`format_indent_decrease`) icons should already exist in `iconMap` since the buttons are already rendered. No new icons expected, but verify before assuming.

## Dependencies

- `ParagraphExtension.setSpaceBefore(twips)` — exists
- `ParagraphExtension.setSpaceAfter(twips)` — exists
- `ParagraphExtension.increaseIndent(amount?)` — exists (default 720 twips)
- `ParagraphExtension.decreaseIndent(amount?)` — exists
- `ParagraphFormatting` type — already has `spaceBefore`, `spaceAfter`, `indentLeft`
