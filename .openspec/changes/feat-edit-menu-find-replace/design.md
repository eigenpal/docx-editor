# Design: Edit Menu + Find & Replace + Spell Check

## Problem Statement

1. **No Edit menu** — Standard word processors have File, Edit, Format, Insert. We have File, Format, Insert but no Edit. Common editing operations (Find, Replace, Select All) have no menu entry.

2. **Find & Replace hidden** — A full Find & Replace dialog exists (`FindReplaceDialog.tsx`, 700+ lines with find, replace, match case, whole words, replace all) but it's only accessible via Ctrl+F / Ctrl+H. Users who don't know shortcuts can't discover it.

3. **No spell check** — The hidden ProseMirror contenteditable doesn't have `spellcheck` enabled. Browser-native spell checking is free and would catch basic typos.

## Current State

### Find & Replace

- **FindReplaceDialog.tsx** (708 lines) — Full non-modal dialog positioned top-right
- **findReplaceUtils.ts** (396 lines) — Search, match highlighting, replacement logic
- **useFindReplace.ts** (228 lines) — React hook managing dialog state
- **Features**: Find next/prev, match case, whole words, replace single/all, match counter
- **Accessible via**: Ctrl+F (find), Ctrl+H (find & replace) only — no menu entry
- **Pre-fills** selected text when opened

### Spell Check

- Hidden ProseMirror has no `spellcheck` attribute set
- Browser default for contenteditable varies (some browsers enable, some don't)
- No custom spell check implementation

### Edit Menu

- Does not exist. Toolbar has: File, Format, Insert.

## Proposed Solution

### Add Edit menu between File and Format

```
File ▼   Edit ▼   Format ▼   Insert ▼

Edit ▼
├── Undo                  Ctrl+Z
├── Redo                  Ctrl+Y
├── ─────────────
├── Find                  Ctrl+F
├── Find and Replace      Ctrl+H
├── ─────────────
├── Select All            Ctrl+A
├── ─────────────
├── Spelling              ✓
└──────────────────────────
```

### Enable browser spell check

Set `spellcheck="true"` on the hidden ProseMirror contenteditable element. Add a toggle in the Edit menu to enable/disable.

### Why this approach

- **Discoverability**: Users expect Edit menu in a word processor. Find & Replace is invisible without it.
- **Zero new components**: F&R dialog exists, just needs a menu trigger.
- **Spell check is free**: Browser handles it; we just enable the attribute.
- **Standard UX**: Matches Google Docs, Word, LibreOffice menu structure.

## Architecture Impact

- **Very low risk**: Adding a menu, toggling an attribute, wiring existing dialog
- **Files**: Toolbar.tsx (new Edit menu), HiddenProseMirror.tsx (spellcheck attr), minimal state for spell check toggle
- **No schema/extension changes**
