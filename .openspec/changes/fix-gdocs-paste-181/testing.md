# Test Plan: Fix Google Docs Paste (#181)

## Test Strategy

Three layers of testing:

1. **Unit tests**: Test the HTML transformation functions in isolation
2. **E2E tests**: Simulate Google Docs paste via ClipboardEvent in Playwright
3. **Regression tests**: Run existing formatting and table tests to ensure no breakage

---

## Unit Tests

### File: `packages/core/src/prosemirror/extensions/features/PasteStyleInlinerExtension.test.ts`

To test the exported `transformPastedHTML` behavior, we need to either:

- Export the function directly (not ideal -- it's private to the extension)
- Test through the plugin's `transformPastedHTML` prop (preferred -- tests integration)
- Extract helpers to a testable utility module

**Recommended approach**: Extract the `unwrapGoogleDocsStructuralB` and CSS parsing helpers to a utility file (e.g., `pasteUtils.ts`) and test them directly.

### Test Cases: Google Docs `<b>` Unwrapping

```
Test: "unwraps structural <b> with docs-internal-guid id"
  Input:  '<b id="docs-internal-guid-abc123" style="font-weight:normal;"><p>Hello</p></b>'
  Expect: '<p>Hello</p>'

Test: "does not unwrap regular <b> tags"
  Input:  '<p><b>Bold text</b></p>'
  Expect: '<p><b>Bold text</b></p>'

Test: "does not unwrap <b> with non-google id"
  Input:  '<b id="my-custom-id"><p>Hello</p></b>'
  Expect: '<b id="my-custom-id"><p>Hello</p></b>'

Test: "preserves all children when unwrapping"
  Input:  '<b id="docs-internal-guid-x"><h1>Title</h1><p>Body</p><table>...</table></b>'
  Expect: '<h1>Title</h1><p>Body</p><table>...</table>'

Test: "handles multiple structural <b> wrappers"
  Input:  '<b id="docs-internal-guid-a"><p>A</p></b><b id="docs-internal-guid-b"><p>B</p></b>'
  Expect: '<p>A</p><p>B</p>'

Test: "handles nested content inside structural <b>"
  Input:  '<b id="docs-internal-guid-x"><p><span style="font-weight:400">normal</span><span style="font-weight:700">bold</span></p></b>'
  Expect: '<p><span style="font-weight:400">normal</span><span style="font-weight:700">bold</span></p>'
```

### Test Cases: BoldExtension `getAttrs`

```
Test: "<b> with no style -> bold mark applied"
  Input:  '<b>text</b>'
  Expect: text has bold mark

Test: '<b style="font-weight:normal"> -> bold mark NOT applied'
  Input:  '<b style="font-weight:normal">text</b>'
  Expect: text does NOT have bold mark

Test: '<b style="font-weight:400"> -> bold mark NOT applied'
  Input:  '<b style="font-weight:400">text</b>'
  Expect: text does NOT have bold mark

Test: '<b style="font-weight:700"> -> bold mark applied'
  Input:  '<b style="font-weight:700">text</b>'
  Expect: text has bold mark

Test: '<b style="font-weight:bold"> -> bold mark applied'
  Input:  '<b style="font-weight:bold">text</b>'
  Expect: text has bold mark

Test: '<b style="color:red"> -> bold mark applied (no font-weight override)'
  Input:  '<b style="color:red">text</b>'
  Expect: text has bold mark (font-weight is not set, so default <b> behavior)
```

### Test Cases: CSS Border Parsing

```
Test: "parses Google Docs border shorthand"
  Input CSS: "border-left:solid #000000 1pt" (via style.borderLeftStyle='solid', etc.)
  Expect: { left: { style: 'single', size: 8, color: { rgb: '000000' } } }

Test: "parses all four borders"
  Input CSS: border-top/right/bottom/left all set to solid #000000 1pt
  Expect: all four sides have { style: 'single', size: 8, color: { rgb: '000000' } }

Test: "returns null when no borders set"
  Input CSS: no border properties
  Expect: null

Test: "handles border-style: none"
  Input CSS: border-left-style: none
  Expect: left border is undefined

Test: "maps CSS solid to OOXML single"
  Expect: cssBorderKindToOoxml('solid') === 'single'

Test: "maps CSS double to OOXML double"
  Expect: cssBorderKindToOoxml('double') === 'double'

Test: "maps CSS dashed to OOXML dashed"
  Expect: cssBorderKindToOoxml('dashed') === 'dashed'

Test: "converts 1pt border width to 8 eighths"
  Expect: cssBorderWidthToEighths('1pt') === 8

Test: "converts 2pt border width to 16 eighths"
  Expect: cssBorderWidthToEighths('2pt') === 16

Test: "converts 1px border width to 6 eighths"
  Expect: cssBorderWidthToEighths('1px') === 6

Test: "converts thin keyword to 4 eighths"
  Expect: cssBorderWidthToEighths('thin') === 4
```

### Test Cases: CSS Color Parsing

```
Test: "parses hex color #000000"
  Expect: parseCssColorToColorValue('#000000') === { rgb: '000000' }

Test: "parses hex color #FF0000"
  Expect: parseCssColorToColorValue('#FF0000') === { rgb: 'FF0000' }

Test: "parses rgb(0, 0, 0)"
  Expect: parseCssColorToColorValue('rgb(0, 0, 0)') === { rgb: '000000' }

Test: "parses rgb(255, 128, 0)"
  Expect: parseCssColorToColorValue('rgb(255, 128, 0)') === { rgb: 'FF8000' }

Test: "returns null for transparent"
  Expect: parseCssColorToColorValue('transparent') === null

Test: "returns null for empty string"
  Expect: parseCssColorToColorValue('') === null
```

### Test Cases: Cell Padding Parsing

```
Test: "parses padding 5pt"
  Input CSS: padding: 5pt 5pt 5pt 5pt
  Expect: { top: 100, right: 100, bottom: 100, left: 100 } (5pt * 20 = 100 twips)

Test: "parses padding with mixed values"
  Input CSS: padding: 10pt 5pt
  Expect: { top: 200, right: 100, bottom: 200, left: 100 }

Test: "returns null when no padding"
  Input CSS: no padding
  Expect: null
```

---

## E2E Tests (Playwright)

### File: `e2e/tests/google-docs-paste.spec.ts`

#### Test Fixture: Google Docs HTML

Create a constant with representative Google Docs clipboard HTML:

```ts
const GOOGLE_DOCS_HTML = `<meta charset="utf-8"><b id="docs-internal-guid-test-1234" style="font-weight:normal;"><h1 style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;"><span style="font-size:20pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Test Heading</span></h1><p style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">This is normal body text. Only this word is </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:700;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">bold</span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;"> in this sentence.</span></p><br><br><div dir="ltr" align="left"><table style="border:none;border-collapse:collapse;"><colgroup><col width="50%"><col width="50%"></colgroup><tbody><tr style="height:0pt;"><td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;"><p style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Product</span></p></td><td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;"><p style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Price</span></p></td></tr><tr style="height:0pt;"><td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;"><p style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Widget</span></p></td><td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;"><p style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">$9.99</span></p></td></tr></tbody></table></div><br></b>`;
```

#### Paste Simulation Helper

```ts
async function pasteHTML(page: Page, html: string): Promise<void> {
  await page.evaluate((htmlContent) => {
    const target =
      document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
    if (!target) throw new Error('Editable target not found');

    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/html', htmlContent);
    dataTransfer.setData('text/plain', 'fallback text');

    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });

    target.dispatchEvent(event);
  }, html);
}
```

#### Test Cases

```ts
test.describe('Google Docs Paste', () => {
  test.beforeEach(async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
  });

  test('body text is not bold after paste', async ({ page }) => {
    await pasteHTML(page, GOOGLE_DOCS_HTML);
    // Wait for paste processing
    await page.waitForTimeout(500);

    // Get the ProseMirror document state and check marks on body text
    const hasBoldOnNormalText = await page.evaluate(() => {
      const pmView = document.querySelector('.ProseMirror')?.pmViewDesc?.view;
      if (!pmView) return null;
      const doc = pmView.state.doc;
      let foundBoldOnNormal = false;
      doc.descendants((node, pos) => {
        if (node.isText && node.text?.includes('normal body text')) {
          const marks = node.marks.map((m) => m.type.name);
          if (marks.includes('bold')) foundBoldOnNormal = true;
        }
      });
      return foundBoldOnNormal;
    });
    expect(hasBoldOnNormalText).toBe(false);
  });

  test('explicitly bold text IS bold after paste', async ({ page }) => {
    await pasteHTML(page, GOOGLE_DOCS_HTML);
    await page.waitForTimeout(500);

    const hasBoldOnBoldWord = await page.evaluate(() => {
      const pmView = document.querySelector('.ProseMirror')?.pmViewDesc?.view;
      if (!pmView) return null;
      const doc = pmView.state.doc;
      let found = false;
      doc.descendants((node) => {
        if (node.isText && node.text === 'bold') {
          const marks = node.marks.map((m) => m.type.name);
          if (marks.includes('bold')) found = true;
        }
      });
      return found;
    });
    expect(hasBoldOnBoldWord).toBe(true);
  });

  test('heading is parsed as heading style', async ({ page }) => {
    await pasteHTML(page, GOOGLE_DOCS_HTML);
    await page.waitForTimeout(500);

    const headingStyle = await page.evaluate(() => {
      const pmView = document.querySelector('.ProseMirror')?.pmViewDesc?.view;
      if (!pmView) return null;
      const doc = pmView.state.doc;
      let styleId = null;
      doc.descendants((node) => {
        if (node.type.name === 'paragraph' && node.textContent.includes('Test Heading')) {
          styleId = node.attrs.styleId;
        }
      });
      return styleId;
    });
    expect(headingStyle).toBe('Heading1');
  });

  test('table borders are preserved after paste', async ({ page }) => {
    await pasteHTML(page, GOOGLE_DOCS_HTML);
    await page.waitForTimeout(500);

    const cellEdgeSet = await page.evaluate(() => {
      const pmView = document.querySelector('.ProseMirror')?.pmViewDesc?.view;
      if (!pmView) return null;
      const doc = pmView.state.doc;
      const cells: any[] = [];
      doc.descendants((node) => {
        if (node.type.name === 'tableCell') {
          cells.push(node.attrs.borders);
        }
      });
      return cells;
    });

    // All 4 cells should have borders
    expect(cellEdgeSet).not.toBeNull();
    expect(cellEdgeSet!.length).toBe(4);
    for (const borders of cellEdgeSet!) {
      expect(borders).not.toBeNull();
      expect(borders.top.style).toBe('single');
      expect(borders.left.style).toBe('single');
    }
  });

  test('regular <b> tag paste still applies bold', async ({ page }) => {
    // Regression test: normal <b> tags should still work
    const regularBoldHTML = '<p>Normal and <b>bold</b> text</p>';
    await pasteHTML(page, regularBoldHTML);
    await page.waitForTimeout(500);

    const hasBold = await page.evaluate(() => {
      const pmView = document.querySelector('.ProseMirror')?.pmViewDesc?.view;
      if (!pmView) return null;
      const doc = pmView.state.doc;
      let found = false;
      doc.descendants((node) => {
        if (node.isText && node.text === 'bold') {
          const marks = node.marks.map((m) => m.type.name);
          if (marks.includes('bold')) found = true;
        }
      });
      return found;
    });
    expect(hasBold).toBe(true);
  });
});
```

**Note**: The `pmViewDesc` access path may need adjustment -- check how ProseMirror exposes the view instance. The EditorPage helper may have a method to access ProseMirror state. Alternative: use the hidden ProseMirror element's DOM to check for `<strong>` tags in its output.

---

## Regression Tests

### Existing test files to verify

| Test File                       | Why                                       | Command                                                                   |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `formatting.spec.ts`            | Bold toggle, formatting persistence       | `npx playwright test tests/formatting.spec.ts --timeout=30000`            |
| `tables.spec.ts`                | Table rendering, borders, cell operations | `npx playwright test tests/tables.spec.ts --timeout=30000`                |
| `text-editing.spec.ts`          | Copy/cut/paste operations                 | `npx playwright test tests/text-editing.spec.ts --timeout=30000`          |
| `clipboard-image-paste.spec.ts` | Image paste (should be unaffected)        | `npx playwright test tests/clipboard-image-paste.spec.ts --timeout=30000` |
| `paragraph-styles.spec.ts`      | Heading styles                            | `npx playwright test tests/paragraph-styles.spec.ts --timeout=30000`      |

### Quick regression command

```bash
bun run typecheck && npx playwright test tests/formatting.spec.ts tests/tables.spec.ts tests/text-editing.spec.ts tests/paragraph-styles.spec.ts --timeout=30000 --workers=4
```

### Full suite (final validation only)

```bash
bun run typecheck && npx playwright test --timeout=60000 --workers=4
```

---

## Visual Testing Checklist

Manual visual verification in the browser (screenshots should be saved to `screenshots/`):

### Before fix (current behavior)

- [ ] Screenshot: Google Docs paste shows ALL text bold
- [ ] Screenshot: Table has no visible borders

### After fix (expected behavior)

- [ ] Screenshot: Google Docs paste -- heading has heading style, body text is NOT bold, only "bold" word is bold
- [ ] Screenshot: Table has visible borders (solid black 1pt)
- [ ] Screenshot: Cell padding matches Google Docs (~5pt)
- [ ] Screenshot: Regular bold formatting still works (apply bold via toolbar, verify it appears)
- [ ] Screenshot: Paste from a non-Google-Docs source (e.g., simple HTML) preserves `<b>` tags

---

## Edge Cases to Manually Verify

1. **Empty table cell from Google Docs**: Should not crash during border parsing
2. **Table with no borders (Google Docs "0pt border")**: Should not create border attributes
3. **Google Docs paste with images**: Images should still paste correctly (ImagePasteExtension)
4. **Google Docs paste with lists**: List items should paste correctly (future test)
5. **Google Docs paste with colored text**: Color marks should be preserved via font-weight spans
6. **Undo after paste**: Ctrl+Z should undo the entire paste in one step
7. **Copy from editor, paste back**: Internal copy/paste should still work correctly
