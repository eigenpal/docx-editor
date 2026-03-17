# Testing: Edit Menu + Find & Replace + Spell Check

## Test Strategy

- E2E tests for Edit menu existence and item functionality
- Verify Find & Replace opens from menu (not just keyboard)
- Verify spell check toggle works
- Regression: Ctrl+F/H shortcuts still work

## Test Cases

### Category 1: Edit Menu Existence

#### Test 1.1: Edit menu appears in toolbar

**Setup:** Load editor
**Steps:** Look at menu bar
**Expected:** Menu order is: File, Edit, Format, Insert

#### Test 1.2: Edit menu items are correct

**Steps:** Click "Edit" menu
**Expected:** Items shown: Undo, Redo, separator, Find, Find and Replace, separator, Select All, separator, Spelling

#### Test 1.3: Keyboard shortcuts displayed

**Steps:** Open Edit menu
**Expected:** Undo shows "⌘Z", Redo "⌘Y", Find "⌘F", Find and Replace "⌘H", Select All "⌘A"

### Category 2: Find & Replace via Menu

#### Test 2.1: Open Find from Edit menu

**Steps:** Edit → Find
**Expected:** Find dialog opens in find-only mode (no replace field visible)

#### Test 2.2: Open Find and Replace from Edit menu

**Steps:** Edit → Find and Replace
**Expected:** Find dialog opens with replace field visible

#### Test 2.3: Find dialog pre-fills selected text

**Setup:** Select a word in the document
**Steps:** Edit → Find
**Expected:** Find field pre-populated with the selected word

#### Test 2.4: Find next/previous works after menu open

**Steps:** Edit → Find → type search term → press Enter
**Expected:** First match highlighted, match counter shows "1 of N"

#### Test 2.5: Replace works after menu open

**Steps:** Edit → Find and Replace → type search → type replacement → click Replace
**Expected:** Current match replaced with new text

#### Test 2.6: Keyboard shortcuts still work

**Steps:** Press Ctrl+F (no menu interaction)
**Expected:** Find dialog opens — existing behavior preserved

### Category 3: Undo/Redo via Menu

#### Test 3.1: Undo from Edit menu

**Setup:** Type text in editor
**Steps:** Edit → Undo
**Expected:** Last action undone, same as Ctrl+Z

#### Test 3.2: Redo from Edit menu

**Setup:** Undo an action
**Steps:** Edit → Redo
**Expected:** Action redone, same as Ctrl+Y

#### Test 3.3: Undo disabled when no history

**Setup:** Fresh document, no edits
**Steps:** Open Edit menu
**Expected:** Undo item is disabled/grayed

### Category 4: Select All

#### Test 4.1: Select All from Edit menu

**Setup:** Load document with multiple paragraphs
**Steps:** Edit → Select All
**Expected:** Entire document content is selected (visible selection highlight covers all text)

#### Test 4.2: Select All then format

**Steps:** Edit → Select All → click Bold button
**Expected:** All text in document becomes bold

### Category 5: Spell Check Toggle

#### Test 5.1: Spell check enabled by default

**Setup:** Load editor
**Steps:** Open Edit menu
**Expected:** "Spelling" item shows checkmark (✓)

#### Test 5.2: Toggle spell check off

**Steps:** Edit → Spelling (click to uncheck)
**Expected:**

- Checkmark removed
- Misspelled words no longer show red squiggles (if browser was showing them)
- Re-opening Edit shows no checkmark on Spelling

#### Test 5.3: Toggle spell check back on

**Steps:** Edit → Spelling (click to check again)
**Expected:**

- Checkmark reappears
- Browser spell check re-enabled on contenteditable

#### Test 5.4: Spell check shows squiggles on misspelled words

**Setup:** Spell check enabled
**Steps:** Type a clearly misspelled word (e.g., "teh")
**Expected:** Browser shows red squiggly underline on misspelled word

### Category 6: Regression

#### Test 6.1: Ctrl+Z/Y shortcuts still work

**Steps:** Type text → Ctrl+Z → Ctrl+Y
**Expected:** Undo/redo work as before

#### Test 6.2: Ctrl+F still opens Find directly

**Steps:** Press Ctrl+F
**Expected:** Find dialog opens without going through Edit menu

#### Test 6.3: Ctrl+A still selects all

**Steps:** Press Ctrl+A
**Expected:** All text selected

#### Test 6.4: File, Format, Insert menus unchanged

**Steps:** Open each menu
**Expected:** Same items as before, correct positions

### Category 7: Edge Cases

#### Test 7.1: Find dialog and Edit menu interaction

**Steps:**

1. Open Find via Ctrl+F
2. Close it
3. Open Find via Edit menu
   **Expected:** Dialog opens fresh (or re-opens with last search)

#### Test 7.2: Spell check persists during editing

**Steps:** Toggle spell check on → type misspelled word → type more text
**Expected:** Squiggles remain on misspelled word, new text also checked

## Automated Test File

**File:** `tests/toolbar-state.spec.ts` (extend existing)

```typescript
test('Edit menu exists with correct items', async ({ page }) => {
  // Load editor
  // Click "Edit" menu button
  // Assert menu items: Undo, Redo, Find, Find and Replace, Select All, Spelling
});

test('Find opens from Edit menu', async ({ page }) => {
  // Click Edit → Find
  // Assert find dialog is visible
  // Assert replace field is NOT visible
});

test('Find and Replace opens from Edit menu', async ({ page }) => {
  // Click Edit → Find and Replace
  // Assert find dialog is visible
  // Assert replace field IS visible
});

test('Select All from Edit menu', async ({ page }) => {
  // Load doc with text
  // Edit → Select All
  // Assert selection covers entire document
});
```

## Manual Verification Checklist

- [ ] Edit menu visible between File and Format
- [ ] Edit → Find opens find-only dialog
- [ ] Edit → Find and Replace opens dialog with replace field
- [ ] Edit → Undo/Redo work like toolbar buttons
- [ ] Edit → Select All selects entire document
- [ ] Edit → Spelling toggles checkmark and browser spell check
- [ ] Keyboard shortcuts (Ctrl+F/H/Z/Y/A) still work independently
- [ ] Misspelled words show red squiggles when spelling enabled
- [ ] File, Format, Insert menus unaffected
