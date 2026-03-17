# Testing: Format Menu + Text Formatting

## Test Strategy

- E2E tests for each new Format menu item and the toolbar strikethrough button
- Verify checked/active states reflect current selection
- Regression: existing formatting (bold, italic, underline) unchanged

## Test Cases

### Category 1: Strikethrough Toolbar Button

#### Test 1.1: Apply strikethrough via toolbar

**Setup:** Load DOCX, type text, select a word
**Steps:** Click the strikethrough (S̶) button in the toolbar
**Expected:** Selected text gets `text-decoration: line-through`; button shows active state

#### Test 1.2: Remove strikethrough via toolbar

**Setup:** Select strikethrough text
**Steps:** Click strikethrough button again
**Expected:** Line-through removed; button deactivates

#### Test 1.3: Button state follows cursor

**Setup:** Load DOCX with mixed normal + strikethrough text
**Steps:** Click into strikethrough text, then into normal text
**Expected:** Button active in strikethrough text, inactive in normal text

#### Test 1.4: Ctrl+Shift+X shortcut works

**Steps:** Select text → press Ctrl+Shift+X
**Expected:** Strikethrough toggled, same as button click

### Category 2: Format Menu — Small Caps & All Caps

#### Test 2.1: Apply small caps from Format menu

**Setup:** Select text
**Steps:** Format → Small Caps
**Expected:** Text renders with `font-variant: small-caps`

#### Test 2.2: Toggle small caps off

**Setup:** Select small-caps text
**Steps:** Format → Small Caps (should show checkmark ✓)
**Expected:** Small caps removed, checkmark gone

#### Test 2.3: Apply all caps from Format menu

**Steps:** Select text → Format → All Caps
**Expected:** Text renders with `text-transform: uppercase`

#### Test 2.4: Toggle all caps off

**Steps:** Select all-caps text → Format → All Caps
**Expected:** Removed

#### Test 2.5: Checkmarks reflect selection state

**Setup:** Load DOCX with small-caps text
**Steps:** Click into small-caps text → open Format menu
**Expected:** "Small Caps" shows checkmark, "All Caps" does not

### Category 3: Format Menu — Character Spacing

#### Test 3.1: Apply expanded spacing

**Steps:** Select text → Format → Character spacing → "Expanded (+1pt)"
**Expected:** Visible wider letter spacing (CSS `letter-spacing` increases)

#### Test 3.2: Apply condensed spacing

**Steps:** Select text → Format → Character spacing → "Condensed (−1pt)"
**Expected:** Tighter letter spacing

#### Test 3.3: Reset to normal

**Steps:** Select expanded text → Format → Character spacing → "Normal"
**Expected:** Default letter spacing restored

#### Test 3.4: Checkmark on current spacing

**Setup:** Apply "Expanded (+2pt)" to text
**Steps:** Click into that text → Format → Character spacing submenu
**Expected:** "Expanded (+2pt)" shows checkmark

### Category 4: Format Menu — Text Section

#### Test 4.1: Bold/Italic/Underline accessible from Format menu

**Steps:** Format → Bold / Italic / Underline
**Expected:** Toggles formatting same as toolbar buttons

#### Test 4.2: Keyboard shortcuts shown in Format menu

**Steps:** Open Format menu
**Expected:** Bold shows "⌘B", Italic "⌘I", Underline "⌘U", Strikethrough "⌘⇧X"

### Category 5: Interaction & Edge Cases

#### Test 5.1: Multiple formatting stacks

**Steps:** Apply bold → apply small caps → apply strikethrough to same text
**Expected:** All three render correctly together

#### Test 5.2: Character spacing on multi-paragraph selection

**Steps:** Select text spanning 2 paragraphs → apply expanded spacing
**Expected:** Both paragraphs' text gets expanded spacing

#### Test 5.3: Formatting on empty selection (cursor)

**Steps:** Place cursor (no selection) → Format → Small Caps → type new text
**Expected:** Newly typed text is in small caps

### Category 6: Round-trip Preservation

#### Test 6.1: Strikethrough round-trip

**Steps:** Apply strikethrough → save DOCX → reload
**Expected:** `w:strike` present in OOXML, renders on reload

#### Test 6.2: Small caps round-trip

**Steps:** Apply → save → reload
**Expected:** `w:smallCaps` preserved

#### Test 6.3: Character spacing round-trip

**Steps:** Apply expanded 2pt → save → reload
**Expected:** `w:spacing w:val="40"` in OOXML

## Automated Test File

**File:** `tests/formatting.spec.ts` (extend existing)

```typescript
test('apply strikethrough via toolbar button', async ({ page }) => {
  // Load doc, select text, click strikethrough button
  // Assert text-decoration: line-through on visible text
});

test('apply small caps via Format menu', async ({ page }) => {
  // Load doc, select text, Format → Small Caps
  // Assert font-variant: small-caps on visible text
});

test('apply character spacing via Format menu', async ({ page }) => {
  // Load doc, select text, Format → Character spacing → Expanded (+1pt)
  // Assert letter-spacing on visible text
});
```

## Manual Verification Checklist

- [ ] Strikethrough button visible between Underline and text color
- [ ] Strikethrough button toggles correctly with active state
- [ ] Format menu shows full text formatting section
- [ ] Bold/Italic/Underline/Strikethrough in menu with shortcuts
- [ ] Small Caps / All Caps toggle with checkmarks
- [ ] Character spacing submenu opens on hover
- [ ] All checkmarks update when moving cursor
- [ ] LTR/RTL still works in Format menu (regression)
- [ ] Existing toolbar buttons unaffected (regression)
