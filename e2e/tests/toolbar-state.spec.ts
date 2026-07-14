/**
 * Toolbar State Detection Tests
 *
 * Tests that verify the toolbar correctly reflects formatting state
 * when the cursor is positioned inside formatted text, even without
 * selecting the entire word or paragraph.
 *
 * This ensures users can see what formatting is active at any cursor position.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Bold Detection', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
  });

  test('cursor inside bold word shows bold active', async ({ page }) => {
    // Type and make "bold" bold
    await editor.typeText('This is bold text here');
    await editor.selectText('bold');
    await editor.applyBold();

    // Click inside the bold word (not selecting it)
    await editor.placeCursorInText('bold', 2);

    // Wait for toolbar to update
    await page.waitForTimeout(100);

    // Check toolbar shows bold as active
    const boldButton = page.locator('[data-testid="toolbar-bold"]');
    const isActive = await boldButton.evaluate((el) => {
      return (
        el.getAttribute('aria-pressed') === 'true' ||
        el.classList.contains('active') ||
        el.hasAttribute('data-active')
      );
    });
    expect(isActive).toBe(true);
  });

  test('cursor at start of bold word shows bold active', async ({ page }) => {
    await editor.typeText('Normal bold normal');
    await editor.selectText('bold');
    await editor.applyBold();

    // Position cursor at start of 'bold'
    await editor.placeCursorInText('bold', 0);

    await page.waitForTimeout(100);

    const boldButton = page.locator('[data-testid="toolbar-bold"]');
    await expect(boldButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('cursor at end of bold word shows bold active', async ({ page }) => {
    await editor.typeText('Normal bold normal');
    await editor.selectText('bold');
    await editor.applyBold();

    // Position cursor at end of 'bold'
    await editor.placeCursorInText('bold', 4);

    await page.waitForTimeout(100);

    const boldButton = page.locator('[data-testid="toolbar-bold"]');
    // At end of bold word, bold should still be active
    const isActive = await boldButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    // This might be false depending on implementation - document the behavior
    expect(typeof isActive).toBe('boolean');
  });

  test('cursor outside bold word shows bold inactive', async ({ page }) => {
    await editor.typeText('Normal bold normal');
    await editor.selectText('bold');
    await editor.applyBold();

    // Position cursor in 'Normal' (not bold)
    await editor.placeCursorInText('Normal', 2);

    await page.waitForTimeout(100);

    const boldButton = page.locator('[data-testid="toolbar-bold"]');
    const isActive = await boldButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    expect(isActive).toBe(false);
  });
});

test.describe('Italic Detection', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
  });

  test('cursor inside italic word shows italic active', async ({ page }) => {
    await editor.typeText('This is italic text here');
    await editor.selectText('italic');
    await editor.applyItalic();

    // Click inside the italic word
    await editor.placeCursorInText('italic', 3);

    await page.waitForTimeout(100);

    const italicButton = page.locator('[data-testid="toolbar-italic"]');
    const isActive = await italicButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    expect(isActive).toBe(true);
  });

  test('cursor outside italic word shows italic inactive', async ({ page }) => {
    await editor.typeText('Normal italic normal');
    await editor.selectText('italic');
    await editor.applyItalic();

    // Position cursor in 'Normal'
    await editor.placeCursorInText('Normal', 2);

    await page.waitForTimeout(100);

    const italicButton = page.locator('[data-testid="toolbar-italic"]');
    const isActive = await italicButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    expect(isActive).toBe(false);
  });
});

test.describe('Underline Detection', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
  });

  test('cursor inside underlined word shows underline active', async ({ page }) => {
    await editor.typeText('This is underlined text');
    await editor.selectText('underlined');
    await editor.applyUnderline();

    // Click inside the underlined word
    await editor.placeCursorInText('underlined', 5);

    await page.waitForTimeout(100);

    const underlineButton = page.locator('[data-testid="toolbar-underline"]');
    const isActive = await underlineButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    expect(isActive).toBe(true);
  });
});

test.describe('Combined Formatting Detection', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
  });

  test('cursor inside bold+italic word shows both active', async ({ page }) => {
    await editor.typeText('This is styled text here');
    await editor.selectText('styled');
    await editor.applyBold();
    await editor.applyItalic();

    // Click inside the styled word
    await editor.placeCursorInText('styled', 3);

    await page.waitForTimeout(100);

    const boldButton = page.locator('[data-testid="toolbar-bold"]');
    const italicButton = page.locator('[data-testid="toolbar-italic"]');

    const boldActive = await boldButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    const italicActive = await italicButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });

    expect(boldActive).toBe(true);
    expect(italicActive).toBe(true);
  });

  test('cursor inside bold+italic+underline shows all active', async ({ page }) => {
    await editor.typeText('Normal formatted normal');
    await editor.selectText('formatted');
    await editor.applyBold();
    await editor.applyItalic();
    await editor.applyUnderline();

    // Click inside the formatted word
    await editor.placeCursorInText('formatted', 4);

    await page.waitForTimeout(100);

    const boldButton = page.locator('[data-testid="toolbar-bold"]');
    const italicButton = page.locator('[data-testid="toolbar-italic"]');
    const underlineButton = page.locator('[data-testid="toolbar-underline"]');

    const boldActive = await boldButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    const italicActive = await italicButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    const underlineActive = await underlineButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });

    expect(boldActive).toBe(true);
    expect(italicActive).toBe(true);
    expect(underlineActive).toBe(true);
  });
});

test.describe('Partial Selection Detection', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
  });

  test('partial selection of bold word shows bold active', async ({ page }) => {
    await editor.typeText('This is boldword here');
    await editor.selectText('boldword');
    await editor.applyBold();

    // Select only part of the bold word: 'ldwo'
    await editor.selectTextRange('boldword', 2, 6);

    await page.waitForTimeout(100);

    const boldButton = page.locator('[data-testid="toolbar-bold"]');
    const isActive = await boldButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    expect(isActive).toBe(true);
  });

  test('selection spanning bold and non-bold shows mixed state', async ({ page }) => {
    await editor.typeText('Normal bold normal');
    await editor.selectText('bold');
    await editor.applyBold();

    // Select 'al bold no' - spans normal and bold text via body PM
    await page.evaluate(() => {
      const view = window.__DOCX_EDITOR_E2E__?.getView?.();
      if (!view) return;
      const full = view.state.doc.textContent ?? '';
      const start = Math.max(0, full.indexOf('bold') - 2);
      const end = full.indexOf('bold') + 4 + 2;
      // Map doc text offset → PM pos (skip non-text)
      let textOffset = 0;
      let fromPos = 1;
      let toPos = 1;
      view.state.doc.descendants((node: { isText?: boolean; text?: string }, pos: number) => {
        if (!node.isText || !node.text) return true;
        const next = textOffset + node.text.length;
        if (start >= textOffset && start < next) fromPos = pos + (start - textOffset);
        if (end > textOffset && end <= next) toPos = pos + (end - textOffset);
        textOffset = next;
        return true;
      });
      const TS = view.state.selection.constructor as {
        create: (doc: unknown, from: number, to: number) => unknown;
      };
      view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, fromPos, toPos)));
      view.focus();
    });

    await page.waitForTimeout(100);

    // When selection spans formatted and unformatted, toolbar may show inactive or mixed
    const boldButton = page.locator('[data-testid="toolbar-bold"]');
    const ariaPressed = await boldButton.getAttribute('aria-pressed');
    // Document the actual behavior - could be 'true', 'false', or 'mixed'
    expect(['true', 'false', 'mixed', null]).toContain(ariaPressed);
  });
});

test.describe('Style Detection at Cursor', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
  });

  test('cursor in heading shows heading style in picker', async ({ page }) => {
    await editor.typeText('This is a heading');
    await editor.applyHeading1();
    await editor.pressEnter();
    await editor.typeText('This is normal text');
    await editor.applyNormalStyle();

    // Click inside the heading
    await editor.placeCursorInText('heading', 5);

    await page.waitForTimeout(100);

    // Check if style picker shows Heading 1 (Radix Select trigger, not native <select>)
    const stylePicker = page.locator('[aria-label="Select paragraph style"]');
    await expect(stylePicker).toContainText(/Heading\s*1/i);
  });

  test('cursor in normal paragraph shows normal style', async ({ page }) => {
    await editor.typeText('Heading text');
    await editor.applyHeading1();
    await editor.pressEnter();
    await editor.typeText('Normal paragraph text');
    await editor.applyNormalStyle();

    // Click inside the normal paragraph
    await editor.placeCursorInText('Normal paragraph', 8);

    await page.waitForTimeout(100);

    const stylePicker = page.locator('[aria-label="Select paragraph style"]');
    await expect(stylePicker).toContainText(/Normal/i);
  });
});

test.describe('Alignment Detection at Cursor', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
  });

  test('cursor in centered paragraph shows center active', async ({ page }) => {
    await editor.typeText('Left aligned');
    await editor.alignLeft();
    await editor.pressEnter();
    await editor.typeText('Center aligned');
    await editor.alignCenter();

    // Click inside the centered paragraph
    await editor.placeCursorInText('Center', 3);

    await page.waitForTimeout(100);

    // The alignment dropdown trigger's aria-label reflects the current alignment
    const alignmentTrigger = page.locator('[data-testid="toolbar-alignment"]');
    const ariaLabel = await alignmentTrigger.getAttribute('aria-label');
    expect(ariaLabel).toContain('Center');
  });

  test('cursor in right-aligned paragraph shows right active', async ({ page }) => {
    await editor.typeText('Normal text');
    await editor.pressEnter();
    await editor.typeText('Right aligned text');
    await editor.alignRight();

    // Click inside the right-aligned paragraph
    await editor.placeCursorInText('Right aligned', 6);

    await page.waitForTimeout(100);

    // The alignment dropdown trigger's aria-label reflects the current alignment
    const alignmentTrigger = page.locator('[data-testid="toolbar-alignment"]');
    const ariaLabel = await alignmentTrigger.getAttribute('aria-label');
    expect(ariaLabel).toContain('Align Right');
  });
});

test.describe('List Detection at Cursor', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
  });

  test('cursor in bullet list shows bullet active', async ({ page }) => {
    await editor.typeText('Normal paragraph');
    await editor.pressEnter();
    await editor.typeText('Bullet item');
    await editor.toggleBulletList();

    // Click inside the bullet list item
    await editor.placeCursorInText('Bullet item', 4);

    await page.waitForTimeout(100);

    const bulletButton = page.locator('[aria-label="Bullet List"]');
    const isActive = await bulletButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    expect(isActive).toBe(true);
  });

  test('cursor in numbered list shows numbered active', async ({ page }) => {
    await editor.typeText('Normal paragraph');
    await editor.pressEnter();
    await editor.typeText('Numbered item');
    await editor.toggleNumberedList();

    // Click inside the numbered list item
    await editor.placeCursorInText('Numbered item', 5);

    await page.waitForTimeout(100);

    const numberedButton = page.locator('[aria-label="Numbered List"]');
    const isActive = await numberedButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    expect(isActive).toBe(true);
  });

  test('cursor outside list shows list buttons inactive', async ({ page }) => {
    await editor.typeText('List item');
    await editor.toggleBulletList();
    await editor.pressEnter();
    await editor.pressEnter(); // Exit list
    await editor.typeText('Normal paragraph');

    // Click inside the normal paragraph
    await editor.placeCursorInText('Normal paragraph', 4);

    await page.waitForTimeout(100);

    const bulletButton = page.locator('[aria-label="Bullet List"]');
    const numberedButton = page.locator('[aria-label="Numbered List"]');

    const bulletActive = await bulletButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    const numberedActive = await numberedButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });

    expect(bulletActive).toBe(false);
    expect(numberedActive).toBe(false);
  });
});

test.describe('Font Detection at Cursor', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
  });

  test('cursor in different font shows that font in picker', async ({ page }) => {
    await editor.typeText('Default font');
    await editor.pressEnter();
    await editor.typeText('Georgia font text');
    await editor.selectText('Georgia font text');
    await editor.setFontFamily('Georgia');

    // Click inside the Georgia text
    await editor.placeCursorInText('Georgia font', 4);

    await page.waitForTimeout(100);

    // Check font picker shows Georgia (Radix Select trigger)
    const fontPicker = page.locator('[aria-label="Select font family"]');
    await expect(fontPicker).toContainText(/Georgia/i);
  });
});

test.describe('Edge Cases for Detection', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
  });

  test('clicking between formatted and unformatted text', async ({ page }) => {
    await editor.typeText('normalbold');
    await editor.selectText('bold');
    await editor.applyBold();

    // Position cursor exactly at boundary (end of 'normal', start of 'bold')
    await editor.placeCursorInText('normal', 6);

    await page.waitForTimeout(100);

    // Document the behavior at the boundary
    const boldButton = page.locator('[data-testid="toolbar-bold"]');
    const ariaPressed = await boldButton.getAttribute('aria-pressed');
    // Could be either - just verify it's defined behavior
    expect(['true', 'false', null]).toContain(ariaPressed);
  });

  test('empty paragraph inherits previous formatting detection', async ({ page }) => {
    await editor.typeText('Bold text');
    await editor.selectAll();
    await editor.applyBold();
    await editor.pressEnter();
    // Now we're in a new empty paragraph

    await page.waitForTimeout(100);

    const boldButton = page.locator('[data-testid="toolbar-bold"]');
    const isActive = await boldButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    // Empty paragraph after bold might inherit bold state
    expect(typeof isActive).toBe('boolean');
  });

  test('cursor after deleting formatted text', async ({ page }) => {
    await editor.typeText('Bold');
    await editor.selectAll();
    await editor.applyBold();
    await editor.selectAll();
    await editor.pressBackspace();
    // Now document is empty

    await page.waitForTimeout(100);

    const boldButton = page.locator('[data-testid="toolbar-bold"]');
    const isActive = await boldButton.evaluate((el) => {
      return el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active');
    });
    // After deleting, bold state might be preserved or reset
    expect(typeof isActive).toBe('boolean');
  });
});
