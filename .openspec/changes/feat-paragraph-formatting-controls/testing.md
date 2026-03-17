# Testing: Paragraph Formatting Controls

## Test Strategy

- E2E tests for paragraph spacing toggle and indent/outdent on non-list paragraphs
- Regression tests for existing list indent behavior
- Visual verification of spacing/indent changes on rendered pages

## Test Cases

### Category 1: Paragraph Spacing — Add/Remove

#### Test 1.1: Add space before paragraph

**Setup:** Load DOCX with paragraphs that have no explicit spacing
**Steps:**

1. Click into a paragraph
2. Open line spacing dropdown
3. Click "Add space before paragraph"
   **Expected:**

- Paragraph gains visible top margin (~8pt)
- Re-opening dropdown shows "Remove space before paragraph"
- Visible page updates immediately

#### Test 1.2: Remove space before paragraph

**Setup:** Load DOCX with a paragraph that has spaceBefore set
**Steps:**

1. Click into that paragraph
2. Open line spacing dropdown → "Remove space before paragraph"
   **Expected:**

- Top margin disappears
- Dropdown label changes to "Add space before paragraph"

#### Test 1.3: Add space after paragraph

**Setup:** Paragraph with no spaceAfter
**Steps:** Line spacing dropdown → "Add space after paragraph"
**Expected:** Bottom margin added, label toggles to "Remove"

#### Test 1.4: Remove space after paragraph

**Steps:** On paragraph with spaceAfter → "Remove space after paragraph"
**Expected:** Bottom margin removed

#### Test 1.5: Spacing label reflects paragraph state

**Setup:** Load DOCX with mixed spacing — para 1 has spaceBefore, para 2 doesn't
**Steps:**

1. Click into para 1 → open dropdown → verify "Remove space before" shown
2. Click into para 2 → open dropdown → verify "Add space before" shown
   **Expected:** Labels change dynamically based on cursor position

### Category 2: Paragraph Spacing — Multi-paragraph

#### Test 2.1: Add spacing to selection spanning multiple paragraphs

**Setup:** Load DOCX with 3 paragraphs
**Steps:**

1. Select text from para 1 through para 3
2. Open line spacing → "Add space before paragraph"
   **Expected:** All 3 paragraphs gain spaceBefore

### Category 3: Indent/Outdent — Non-list Paragraphs

#### Test 3.1: Indent plain paragraph

**Setup:** Load DOCX with plain (non-list) paragraphs
**Steps:** Click into plain paragraph → click indent button (→)
**Expected:**

- Paragraph left margin increases by ~0.5in (720 twips)
- NOT converted to a list

#### Test 3.2: Multiple indents accumulate

**Steps:** Click indent button 3 times on same paragraph
**Expected:** Left margin is ~1.5in (3 × 720 twips)

#### Test 3.3: Outdent indented paragraph

**Steps:** Click indent once, then click outdent once
**Expected:** Paragraph returns to 0 indent

#### Test 3.4: Outdent disabled at zero indent

**Setup:** Plain paragraph with no indent
**Steps:** Observe outdent button state
**Expected:** Outdent button is disabled (grayed/non-clickable) when not in list and indent is 0

#### Test 3.5: Outdent doesn't go negative

**Steps:** On zero-indent paragraph, attempt to outdent
**Expected:** Nothing happens, no negative margin

### Category 4: List Indent Regression

#### Test 4.1: Indent in list still changes list level

**Setup:** Load DOCX with bullet list
**Steps:** Click into list item → click indent
**Expected:** List nesting increases (deeper level), NOT paragraph margin change

#### Test 4.2: Outdent in list still changes list level

**Setup:** Nested list item
**Steps:** Click outdent
**Expected:** List level decreases

#### Test 4.3: Outdent at level 0 in list removes list

**Steps:** Click outdent on top-level list item
**Expected:** Item removed from list (becomes plain paragraph) — existing behavior preserved

### Category 5: Round-trip

#### Test 5.1: Paragraph spacing survives save/reload

**Steps:** Add space before → save DOCX → reload
**Expected:** `w:spacing w:before="160"` in OOXML, renders correctly

#### Test 5.2: Indent survives save/reload

**Steps:** Indent paragraph → save DOCX → reload
**Expected:** `w:ind w:left="720"` in OOXML, renders correctly

### Category 6: Line Spacing Regression

#### Test 6.1: Existing line spacing presets still work

**Steps:** Open line spacing dropdown → select "Double"
**Expected:** Line spacing changes to double — existing functionality preserved

#### Test 6.2: Line spacing and paragraph spacing are independent

**Steps:** Set double line spacing + add space before
**Expected:** Both applied: double line spacing within paragraph, top margin between paragraphs

## Automated Test File

**File:** `tests/line-spacing.spec.ts` (extend existing) and `tests/cursor-paragraph-ops.spec.ts`

```typescript
test('add space before paragraph via line spacing picker', async ({ page }) => {
  // Load doc, click paragraph, open dropdown, click "Add space before"
  // Assert marginTop on visible paragraph element
});

test('indent non-list paragraph via toolbar', async ({ page }) => {
  // Load doc, click non-list paragraph, click indent button
  // Assert marginLeft increases on visible paragraph
  // Assert paragraph is NOT in a list
});

test('outdent button disabled at zero indent', async ({ page }) => {
  // Load doc, click zero-indent paragraph
  // Assert outdent button has disabled attribute
});
```

## Manual Verification Checklist

- [ ] Line spacing dropdown shows "Paragraph spacing" section with add/remove items
- [ ] "Add space before/after" toggles label correctly
- [ ] Spacing changes visible immediately on pages
- [ ] Indent button works on plain paragraphs (not just lists)
- [ ] Outdent disabled when paragraph has no indent and not in list
- [ ] List indent/outdent unchanged (regression)
- [ ] Line spacing presets still work (regression)
