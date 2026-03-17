# Design: Format Menu + Text Formatting

## Problem Statement

Several text formatting features are fully implemented in the engine (parsed, stored in PM, rendered, commands exist) but have no UI. The toolbar is already crowded. Google Docs solves this by putting less-common formatting under the **Format** menu, keeping the toolbar lean.

## Current State

| Feature           | Extension                   | Parsed | Rendered                    | Command                 | Toolbar   | Keyboard     |
| ----------------- | --------------------------- | ------ | --------------------------- | ----------------------- | --------- | ------------ |
| Strikethrough     | `StrikeExtension`           | Yes    | `line-through`              | `toggleStrike()`        | No button | Ctrl+Shift+X |
| Small Caps        | `SmallCapsExtension`        | Yes    | `font-variant: small-caps`  | `toggleSmallCaps()`     | No        | No           |
| All Caps          | `AllCapsExtension`          | Yes    | `text-transform: uppercase` | `toggleAllCaps()`       | No        | No           |
| Character Spacing | `CharacterSpacingExtension` | Yes    | `letter-spacing`            | `setCharacterSpacing()` | No        | No           |

Our **Format menu** currently only has: Left-to-Right, Right-to-Left. Very bare.

## Proposed Solution

### Expand Format menu (Google Docs style)

```
Format ▼
├── Text
│   ├── Bold                    Ctrl+B
│   ├── Italic                  Ctrl+I
│   ├── Underline               Ctrl+U
│   ├── Strikethrough           Ctrl+Shift+X
│   ├── ─────────────
│   ├── Small Caps
│   └── All Caps
├── ─────────────
├── Character spacing  ▸
│   ├── Normal
│   ├── Expanded (+1pt)
│   ├── Expanded (+2pt)
│   ├── Condensed (-1pt)
│   └── Condensed (-2pt)
├── ─────────────
├── Left-to-Right Text
└── Right-to-Left Text
```

### Add strikethrough button to toolbar

Strikethrough is common enough to warrant a toolbar button (Google Docs has it). Add between Underline and text color.

### Why this approach

- **Declutters toolbar**: Small caps, all caps, character spacing are rare — menu is the right place
- **Matches Google Docs UX**: Users know to look in Format for text formatting
- **Quick win**: All commands exist, just wiring UI to existing plumbing
- **Strikethrough exception**: Common enough for toolbar button, plus Google Docs has it there too

## Architecture Impact

- **Low risk**: No schema changes, no new extensions, no serializer changes
- **Files changed**: Toolbar.tsx (Format menu), FormattingBar.tsx (strikethrough button), toolbarUtils.ts (action handlers), selectionTracker.ts (track smallCaps/allCaps/charSpacing)

## Backwards Compatibility

Fully backwards compatible. No data model changes.
