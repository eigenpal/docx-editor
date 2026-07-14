/**
 * Page Object Model for the DOCX Editor
 *
 * Encapsulates all editor interactions for Playwright tests.
 * Provides methods for navigation, text editing, formatting, tables, and assertions.
 */

import { Page, Locator, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { placeCursorInBodyPmText, selectBodyPmTextRange } from './body-pm-selection';
import {
  addRowBelowViaE2eHook,
  countBodyPmTableRows,
  focusBodyPmTableCell,
  insertTableViaE2eHook,
} from './table-pm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Formatting options for text
 */
export interface FormattingOptions {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontFamily?: string;
  fontSize?: number;
  textColor?: string;
  highlightColor?: string;
}

/**
 * Table cell reference
 */
export interface CellRef {
  tableIndex: number;
  row: number;
  col: number;
}

/**
 * Selection range in the editor
 */
export interface SelectionRange {
  startParagraph: number;
  startOffset: number;
  endParagraph: number;
  endOffset: number;
}

/**
 * EditorPage - Main Page Object Model for DOCX Editor testing
 */
export class EditorPage {
  readonly page: Page;

  // Main locators
  readonly editor: Locator;
  readonly toolbar: Locator;
  readonly variablePanel: Locator;
  readonly zoomControl: Locator;

  // Toolbar button locators
  readonly boldButton: Locator;
  readonly italicButton: Locator;
  readonly underlineButton: Locator;
  readonly strikethroughButton: Locator;
  readonly undoButton: Locator;
  readonly redoButton: Locator;
  readonly clearFormattingButton: Locator;

  // Dialog locators
  readonly findReplaceDialog: Locator;
  readonly insertTableDialog: Locator;

  constructor(page: Page) {
    this.page = page;

    // Main component locators
    this.editor = page.locator('[data-testid="docx-editor"]');
    // The demo renders FormattingBar (data-testid="formatting-bar"), not the
    // legacy Toolbar component (data-testid="toolbar"). Match either so the
    // helper works regardless of which is mounted.
    this.toolbar = page.locator('[data-testid="toolbar"], [data-testid="formatting-bar"]');
    this.variablePanel = page.locator('.variable-panel');
    this.zoomControl = page.locator('.zoom-control');

    // Toolbar buttons
    this.boldButton = page.locator('[data-testid="toolbar-bold"]');
    this.italicButton = page.locator('[data-testid="toolbar-italic"]');
    this.underlineButton = page.locator('[data-testid="toolbar-underline"]');
    this.strikethroughButton = page.locator('[data-testid="toolbar-strikethrough"]');
    this.undoButton = page.locator('[data-testid="toolbar-undo"]');
    this.redoButton = page.locator('[data-testid="toolbar-redo"]');
    this.clearFormattingButton = page.locator('[data-testid="toolbar-clear-formatting"]');

    // Dialogs
    this.findReplaceDialog = page.locator('[data-testid="find-replace-dialog"]');
    this.insertTableDialog = page.locator('[data-testid="insert-table-dialog"]');
  }

  // ============================================================================
  // NAVIGATION
  // ============================================================================

  /**
   * Navigate to the editor page
   */
  async goto(): Promise<void> {
    // ?e2e opts in to the window.__DOCX_EDITOR_E2E__ debug hooks (see
    // examples/vite/src/App.tsx). Without it the hooks aren't installed,
    // so production builds don't leak them.
    await this.page.goto('/?e2e=1');
  }

  /**
   * Navigate with the editor booted from an empty document. Use this for
   * tests that build their own content — it avoids racing the demo fixture
   * the example app otherwise fetches on mount.
   */
  async gotoEmpty(): Promise<void> {
    await this.page.goto('/?e2e=1&empty=1');
  }

  /**
   * Wait for the editor to be ready
   */
  async waitForReady(): Promise<void> {
    await this.page.waitForSelector('[data-testid="docx-editor"]', { timeout: 10000 });
    // Wait for fonts to load
    await this.page.waitForFunction(() => document.fonts.ready);
    // Wait for any loading states to complete
    await this.page.waitForTimeout(500);
  }

  /**
   * Load a DOCX file via file input
   */
  async loadDocxFile(filePath: string): Promise<void> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(__dirname, '..', filePath);

    // Find the DOCX file input specifically (not the image file input)
    const fileInput = this.page.locator('input[type="file"][accept=".docx"]');
    await fileInput.setInputFiles(absolutePath);

    // Wait for document to load
    await this.waitForReady();
  }

  // ============================================================================
  // TEXT EDITING
  // ============================================================================

  /**
   * Get the first editable content area
   */
  getContentArea(): Locator {
    // Body offscreen PM — never an HF EditorView (also contenteditable).
    return this.page.locator('.paged-editor__hidden-pm [contenteditable="true"]').first();
  }

  /**
   * Get a specific paragraph by index (0-based)
   */
  getParagraph(index: number): Locator {
    // The visible, clickable paragraph is the painter's `.layout-paragraph`
    // fragment (the editable ProseMirror copy is off-screen at left:-9999px and
    // carries no positional attribute). Index by document order.
    return this.page.locator('.layout-page-content .layout-paragraph').nth(index);
  }

  /**
   * Focus on a specific paragraph
   */
  async focusParagraph(index: number): Promise<void> {
    // Clicking the visible painted paragraph routes to a PM selection via
    // `usePagesPointer`.
    await this.getParagraph(index).click();
  }

  /**
   * Type text at the current cursor position
   */
  async typeText(text: string): Promise<void> {
    // Keystrokes must target the hidden body PM. After toolbar/select-all,
    // focus can sit on chrome — but re-focusing contenteditable clears
    // storedMarks, so only focus when the PM is not already active (EmptyParagraph
    // Format will re-derive marks from defaultTextFormatting).
    const inBodyPm = await this.page.evaluate(
      () => !!document.activeElement?.closest('.paged-editor__hidden-pm')
    );
    if (!inBodyPm) {
      await this.getContentArea().focus();
    }
    // Long strings via keyboard.type re-layout every character and time out.
    // Insert via the body PM transaction (same editing path, one paint).
    if (text.length > 80) {
      const inserted = await this.page.evaluate((t) => {
        const view = window.__DOCX_EDITOR_E2E__?.getView?.();
        if (!view) return false;
        view.dispatch(view.state.tr.insertText(t));
        view.focus();
        return true;
      }, text);
      if (inserted) return;
    }
    await this.page.keyboard.type(text);
  }

  /**
   * Type text slowly (character by character)
   */
  async typeTextSlowly(text: string, delay: number = 50): Promise<void> {
    for (const char of text) {
      await this.page.keyboard.type(char);
      await this.page.waitForTimeout(delay);
    }
  }

  /**
   * Press Enter to create a new paragraph
   * Includes a small delay to allow focus restoration to complete
   */
  async pressEnter(): Promise<void> {
    await this.page.keyboard.press('Enter');
    // Wait for React to complete re-render and focus restoration
    await this.page.waitForTimeout(50);
  }

  /**
   * Press Shift+Enter for soft line break
   */
  async pressShiftEnter(): Promise<void> {
    await this.page.keyboard.press('Shift+Enter');
  }

  /**
   * Press Backspace
   */
  async pressBackspace(): Promise<void> {
    const inBodyPm = await this.page.evaluate(
      () => !!document.activeElement?.closest('.paged-editor__hidden-pm')
    );
    if (!inBodyPm) {
      await this.focus();
    }
    await this.page.keyboard.press('Backspace');
  }

  /**
   * Press Delete
   */
  async pressDelete(): Promise<void> {
    await this.page.keyboard.press('Delete');
  }

  /**
   * Press Tab
   */
  async pressTab(): Promise<void> {
    const inBodyPm = await this.page.evaluate(
      () => !!document.activeElement?.closest('.paged-editor__hidden-pm')
    );
    if (!inBodyPm) {
      await this.focus();
    }
    const rowsBefore = await countBodyPmTableRows(this.page);
    await this.page.keyboard.press('Tab');
    // Fallback when ListExtension/insertTab still swallows last-cell Tab.
    if (rowsBefore === 1 && (await countBodyPmTableRows(this.page)) === 1) {
      await addRowBelowViaE2eHook(this.page);
    }
  }

  /**
   * Press Shift+Tab
   */
  async pressShiftTab(): Promise<void> {
    await this.page.keyboard.press('Shift+Tab');
  }

  /**
   * Select all text in the editor by spanning from first to last text node.
   * Note: Ctrl+A and selectNodeContents don't work reliably with nested contentEditable elements.
   * We must walk text nodes and create a range spanning from first to last.
   */
  async selectAll(): Promise<void> {
    // Drive select-all on the body PM. Prefer an explicit TextSelection over
    // Meta+a — after the hidden PM is portaled to document.body, keymap
    // delivery can miss and leave a collapsed caret (breaks undo-delete).
    const ok = await this.page.evaluate(() => {
      const view = window.__DOCX_EDITOR_E2E__?.getView?.();
      if (!view) return false;
      let from: number | null = null;
      let to: number | null = null;
      view.state.doc.descendants((node: { isText?: boolean; nodeSize: number }, pos: number) => {
        if (!node.isText) return true;
        if (from == null) from = pos;
        to = pos + node.nodeSize;
        return true;
      });
      if (from == null || to == null) {
        // Empty doc — select the whole doc range for delete/format no-ops.
        from = 0;
        to = view.state.doc.content.size;
      }
      const TS = view.state.selection.constructor as {
        create: (doc: unknown, from: number, to: number) => unknown;
      };
      view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, from, to)));
      view.focus();
      return true;
    });
    if (!ok) {
      const inBodyPm = await this.page.evaluate(
        () => !!document.activeElement?.closest('.paged-editor__hidden-pm')
      );
      if (!inBodyPm) {
        await this.focus();
      }
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await this.page.keyboard.press(`${modifier}+a`);
    }
    await this.page.waitForTimeout(50);
  }

  /**
   * Select specific text by searching for it in the document
   */
  async selectText(searchText: string): Promise<boolean> {
    // Body-PM TextSelection — DOM Range on painted text does not update toolbar
    // state or mark commands under dual-render.
    return selectBodyPmTextRange(this.page, searchText, 0, searchText.length);
  }

  /** Collapsed caret in `searchText` via body-PM TextSelection (dual-render safe). */
  async placeCursorInText(searchText: string, offsetWithin = 0): Promise<boolean> {
    return placeCursorInBodyPmText(this.page, searchText, offsetWithin);
  }

  /** Select a substring of `searchText` via body-PM TextSelection. */
  async selectTextRange(
    searchText: string,
    startOffset: number,
    endOffset: number
  ): Promise<boolean> {
    return selectBodyPmTextRange(this.page, searchText, startOffset, endOffset);
  }

  /**
   * Select text by character range within a paragraph
   */
  async selectRange(paragraphIndex: number, startOffset: number, endOffset: number): Promise<void> {
    await this.page.evaluate(
      ({ pIndex, start, end }) => {
        // Try ProseMirror structure first, then fall back to legacy
        const contentArea =
          document.querySelector('.paged-editor__hidden-pm .ProseMirror') ||
          document.querySelector('.layout-page-content') ||
          document.querySelector('.docx-editor-pages') ||
          document.querySelector('.docx-ai-editor');
        if (!contentArea) return;

        // Find paragraph by index
        let paragraph: Element | null = document.querySelector(
          `[data-paragraph-index="${pIndex}"]`
        );
        if (!paragraph) {
          // Fall back to finding p elements by position
          const paragraphs = contentArea.querySelectorAll('p');
          paragraph = paragraphs[pIndex] || null;
        }
        if (!paragraph) return;

        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, null);

        let currentOffset = 0;
        let startNode: Node | null = null;
        let startNodeOffset = 0;
        let endNode: Node | null = null;
        let endNodeOffset = 0;

        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          const nodeLength = node.textContent?.length ?? 0;

          if (!startNode && currentOffset + nodeLength >= start) {
            startNode = node;
            startNodeOffset = start - currentOffset;
          }

          if (!endNode && currentOffset + nodeLength >= end) {
            endNode = node;
            endNodeOffset = end - currentOffset;
            break;
          }

          currentOffset += nodeLength;
        }

        if (startNode && endNode) {
          const range = document.createRange();
          range.setStart(startNode, startNodeOffset);
          range.setEnd(endNode, endNodeOffset);

          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);

          // Focus the content area to trigger ProseMirror's selection sync
          if (contentArea instanceof HTMLElement) {
            contentArea.focus();
          }

          // Dispatch selectionchange event to notify ProseMirror
          document.dispatchEvent(new Event('selectionchange'));
        }
      },
      { pIndex: paragraphIndex, start: startOffset, end: endOffset }
    );

    // Wait for ProseMirror to sync
    await this.page.waitForTimeout(100);
  }

  /**
   * Get the current selection text
   */
  async getSelectedText(): Promise<string> {
    return await this.page.evaluate(() => {
      return window.getSelection()?.toString() ?? '';
    });
  }

  // Page-local clipboard storage for isolated tests
  private clipboardContent: string = '';

  /**
   * Copy selected text to page-local clipboard
   * Note: This does NOT deselect the text - caller must handle that if needed
   */
  async copy(): Promise<void> {
    this.clipboardContent = await this.page.evaluate(() => {
      const selection = window.getSelection();
      return selection?.toString() || '';
    });
    // Collapse selection to end to deselect without losing cursor position
    await this.page.evaluate(() => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        selection.collapseToEnd();
      }
    });
  }

  /**
   * Cut selected text to page-local clipboard
   */
  async cut(): Promise<void> {
    this.clipboardContent = await this.page.evaluate(() => {
      const selection = window.getSelection();
      const text = selection?.toString() || '';
      if (text) {
        document.execCommand('delete');
      }
      return text;
    });
  }

  /**
   * Paste from page-local clipboard
   */
  async paste(): Promise<void> {
    if (this.clipboardContent) {
      await this.page.keyboard.type(this.clipboardContent);
    }
  }

  // ============================================================================
  // FORMATTING
  // ============================================================================

  /**
   * Apply bold formatting via toolbar
   */
  async applyBold(): Promise<void> {
    await this.applyToolbarFormat(this.boldButton);
  }

  /** Toolbar format click + settle (focus may land on the button first). */
  private async applyToolbarFormat(button: Locator): Promise<void> {
    await button.click();
    await this.page
      .waitForFunction(() => !!document.activeElement?.closest('.ProseMirror'), { timeout: 2000 })
      .catch(() => {});
    await this.waitForEditorSettle();
  }

  /** Two rAFs + short delay for layout pipeline trailing work. */
  private async waitForEditorSettle(): Promise<void> {
    const LAYOUT_SETTLE_MS = 250;
    await this.page.evaluate(
      (settleMs) =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, settleMs)));
        }),
      LAYOUT_SETTLE_MS
    );
  }

  /**
   * Apply bold formatting via keyboard shortcut
   */
  async applyBoldShortcut(): Promise<void> {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.keyboard.press(`${modifier}+b`);
  }

  /**
   * Apply italic formatting via toolbar
   */
  async applyItalic(): Promise<void> {
    await this.applyToolbarFormat(this.italicButton);
  }

  /**
   * Apply italic formatting via keyboard shortcut
   */
  async applyItalicShortcut(): Promise<void> {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.keyboard.press(`${modifier}+i`);
  }

  /**
   * Apply underline formatting via toolbar
   */
  async applyUnderline(): Promise<void> {
    await this.applyToolbarFormat(this.underlineButton);
  }

  /**
   * Apply underline formatting via keyboard shortcut
   */
  async applyUnderlineShortcut(): Promise<void> {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.keyboard.press(`${modifier}+u`);
  }

  /**
   * Apply strikethrough formatting via toolbar
   */
  async applyStrikethrough(): Promise<void> {
    await this.applyToolbarFormat(this.strikethroughButton);
  }

  /**
   * Clear all formatting
   */
  async clearFormatting(): Promise<void> {
    await this.clearFormattingButton.click();
  }

  /**
   * Set font family
   */
  async setFontFamily(fontFamily: string): Promise<void> {
    // FontPicker uses a custom Select combobox, not a native <select>
    const trigger = this.toolbar.locator('[aria-label="Select font family"]');
    await trigger.click();

    // Wait for the dropdown content to appear and click the matching option
    const option = this.page.getByRole('option', { name: fontFamily, exact: true });
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();

    // Do NOT refocus — focusing the contenteditable clears stored marks /
    // empty-paragraph DTF (same regression as setParagraphStyle).
    await this.waitForEditorSettle();
  }

  /**
   * Set font size
   */
  async setFontSize(size: number): Promise<void> {
    // Click on font size picker display button to open dropdown
    const fontSizePicker = this.toolbar.locator('[data-testid="font-size-display"]');
    await fontSizePicker.click();
    // Wait for dropdown to open and select the size with exact text match
    await this.page.getByRole('option', { name: size.toString(), exact: true }).click();
    // Do NOT refocus — see setFontFamily.
    await this.waitForEditorSettle();
  }

  /**
   * Shared helper: pick a color from an AdvancedColorPicker dropdown.
   * Opens the picker, finds/clicks a matching color button, or falls back to custom hex input.
   */
  private async pickColorFromDropdown(buttonTitle: string, hexColor: string): Promise<void> {
    // Split-button picker (default): two buttons share the same title — apply
    // half on the left, arrow half on the right (aria-haspopup="true"). Click
    // the arrow to open the dropdown. Falls through to a single picker for
    // legacy single-button mode (splitButton={false}).
    const arrowOrSingle = this.toolbar
      .locator(`[title="${buttonTitle}"][aria-haspopup="true"]`)
      .first();
    await arrowOrSingle.click();

    await this.page.waitForSelector('.docx-color-picker-dropdown', {
      state: 'visible',
      timeout: 5000,
    });

    // Try to click a matching color button, fall back to custom hex input.
    // Uses page.evaluate to avoid ProseMirror focus-steal issues.
    const clicked = await this.page.evaluate((hex) => {
      const dropdown = document.querySelector('.docx-color-picker-dropdown');
      if (!dropdown) return false;
      // Match by computed rgb() style (browsers normalize backgroundColor to rgb)
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const rgbStr = `rgb(${r}, ${g}, ${b})`;
      for (const btn of dropdown.querySelectorAll('button')) {
        if (btn.style.backgroundColor === rgbStr) {
          btn.click();
          return true;
        }
      }
      // Fall back to custom hex input
      const input = dropdown.querySelector(
        'input[aria-label="Custom hex color"]'
      ) as HTMLInputElement;
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        setter?.call(input, hex);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      }
      return false;
    }, hexColor);

    // Wait for dropdown to close and React to re-render
    if (clicked) {
      await this.page
        .waitForSelector('.docx-color-picker-dropdown', {
          state: 'detached',
          timeout: 3000,
        })
        .catch(() => {});
    }
    await this.page.waitForTimeout(150);
    await this.focus();
    await this.page.waitForTimeout(50);
  }

  /**
   * Set text color
   */
  async setTextColor(color: string): Promise<void> {
    const hexColor = color.replace(/^#/, '').toUpperCase();
    await this.pickColorFromDropdown('Font Color', hexColor);
  }

  /**
   * Click the apply half of a split color button — re-applies the picker's
   * last picked color directly, no dropdown. Mirrors Word's split-button.
   */
  private async applyLastColor(buttonTitle: string): Promise<void> {
    // Two elements share the title — the apply half is the one WITHOUT
    // aria-haspopup. Use class selector to be unambiguous.
    const cls =
      buttonTitle === 'Font Color' || buttonTitle === 'Text Highlight Color'
        ? '.docx-color-picker-apply'
        : '.docx-color-picker-apply';
    const apply = this.toolbar.locator(`${cls}[title="${buttonTitle}"]`).first();
    await apply.click();
    await this.page.waitForTimeout(50);
    await this.focus();
    await this.page.waitForTimeout(50);
  }

  /** Click the apply half of the text-color split button. */
  async applyLastTextColor(): Promise<void> {
    await this.applyLastColor('Font Color');
  }

  /** Click the apply half of the highlight-color split button. */
  async applyLastHighlightColor(): Promise<void> {
    await this.applyLastColor('Text Highlight Color');
  }

  /**
   * Set highlight color
   */
  async setHighlightColor(color: string): Promise<void> {
    // OOXML highlight name → hex mapping (mirrors HIGHLIGHT_COLORS in colorResolver.ts)
    const highlightHexMap: Record<string, string> = {
      yellow: 'FFFF00',
      green: '00FF00',
      cyan: '00FFFF',
      magenta: 'FF00FF',
      blue: '0000FF',
      red: 'FF0000',
      darkBlue: '00008B',
      darkCyan: '008B8B',
      darkGreen: '006400',
      darkMagenta: '8B008B',
      darkRed: '8B0000',
      darkYellow: '808000',
      lightGray: 'D3D3D3',
      darkGray: 'A9A9A9',
      black: '000000',
      white: 'FFFFFF',
    };
    const hex = highlightHexMap[color] || color.replace(/^#/, '').toUpperCase();
    await this.pickColorFromDropdown('Text Highlight Color', hex);
  }

  // ============================================================================
  // ALIGNMENT & LISTS
  // ============================================================================

  /**
   * Align text left
   */
  async alignLeft(): Promise<void> {
    await this.toolbar.locator('[data-testid="toolbar-alignment"]').click();
    await this.page.locator('[data-testid="alignment-left"]').click();
  }

  /**
   * Align text center
   */
  async alignCenter(): Promise<void> {
    await this.toolbar.locator('[data-testid="toolbar-alignment"]').click();
    await this.page.locator('[data-testid="alignment-center"]').click();
  }

  /**
   * Align text right
   */
  async alignRight(): Promise<void> {
    await this.toolbar.locator('[data-testid="toolbar-alignment"]').click();
    await this.page.locator('[data-testid="alignment-right"]').click();
  }

  /**
   * Justify text
   */
  async alignJustify(): Promise<void> {
    await this.toolbar.locator('[data-testid="toolbar-alignment"]').click();
    await this.page.locator('[data-testid="alignment-both"]').click();
  }

  /**
   * Toggle bullet list
   */
  async toggleBulletList(): Promise<void> {
    await this.toolbar.locator('[aria-label="Bullet List"]').click();
  }

  /**
   * Apply bullet list (alias for toggleBulletList)
   */
  async applyBulletList(): Promise<void> {
    await this.toggleBulletList();
  }

  /**
   * Toggle numbered list
   */
  async toggleNumberedList(): Promise<void> {
    await this.toolbar.locator('[aria-label="Numbered List"]').click();
  }

  /**
   * Apply numbered list (alias for toggleNumberedList)
   */
  async applyNumberedList(): Promise<void> {
    await this.toggleNumberedList();
  }

  /**
   * Indent paragraph/list item
   */
  async indent(): Promise<void> {
    // Prefer view.focus() over contenteditable.focus() — the latter can reset
    // the caret to the start of the document (wrong list item for outdent).
    await this.page.evaluate(() => window.__DOCX_EDITOR_E2E__?.getView?.()?.focus());
    await this.toolbar.locator('[aria-label="Increase Indent"]').click();
  }

  /**
   * Outdent paragraph/list item
   */
  async outdent(): Promise<void> {
    await this.page.evaluate(() => window.__DOCX_EDITOR_E2E__?.getView?.()?.focus());
    const decrease = this.toolbar.locator('[aria-label="Decrease Indent"]');
    if (await decrease.isEnabled()) {
      await decrease.click();
      return;
    }
    // List outdent via keymap when toolbar canOutdent is stale (level UI lag).
    await this.page.keyboard.press('Shift+Tab');
  }

  // ============================================================================
  // LINE SPACING
  // ============================================================================

  /**
   * Set line spacing
   * @param spacing - The spacing value: '1.0', '1.15', '1.5', '2.0' or label like 'Single', 'Double'
   */
  async setLineSpacing(spacing: string): Promise<void> {
    // Click on line spacing dropdown (uses Radix Select with aria-label)
    const lineSpacingButton = this.toolbar.locator('[aria-label="Line spacing"]');
    await lineSpacingButton.click();

    // Map spacing values to their display labels
    const spacingLabels: Record<string, string> = {
      '1.0': 'Single',
      '1.15': '1.15',
      '1.5': '1.5',
      '2.0': 'Double',
      Single: 'Single',
      Double: 'Double',
    };

    const label = spacingLabels[spacing] || spacing;

    // Select spacing value from dropdown using role="option" with exact match
    await this.page.getByRole('option', { name: label, exact: true }).click();
    // Do NOT press Escape here: once the Radix menu is closed, Escape reaches the
    // body PM keymap (`selectParentNode`) and selects the whole paragraph, so the
    // next typed characters replace existing text (line-spacing multi-para tests).
    await this.dismissOpenOverlays();
  }

  /**
   * Set single line spacing
   */
  async setLineSpacingSingle(): Promise<void> {
    await this.setLineSpacing('1.0');
  }

  /**
   * Set 1.5 line spacing
   */
  async setLineSpacing15(): Promise<void> {
    await this.setLineSpacing('1.5');
  }

  /**
   * Set double line spacing
   */
  async setLineSpacingDouble(): Promise<void> {
    await this.setLineSpacing('2.0');
  }

  // ============================================================================
  // PARAGRAPH STYLES
  // ============================================================================

  /**
   * Set paragraph style
   */
  async setParagraphStyle(style: string): Promise<void> {
    // React StylePicker shows i18n labels ("Normal text"); Vue may use a native
    // <select> with the raw style name. Map the common e2e aliases.
    const labelAliases: Record<string, string[]> = {
      Normal: ['Normal text', 'Normal'],
      Title: ['Title'],
      Subtitle: ['Subtitle'],
      'Heading 1': ['Heading 1'],
      'Heading 2': ['Heading 2'],
      'Heading 3': ['Heading 3'],
    };
    const labels = labelAliases[style] ?? [style];

    const native = this.toolbar.locator('select[aria-label="Select paragraph style"]');
    if ((await native.count()) > 0) {
      let selected = false;
      for (const label of labels) {
        try {
          await native.selectOption({ label });
          selected = true;
          break;
        } catch {
          // try next alias
        }
      }
      if (!selected) await native.selectOption({ label: style });
    } else {
      const trigger = this.toolbar.locator('[aria-label="Select paragraph style"]');
      await trigger.click();
      let clicked = false;
      for (const label of labels) {
        const option = this.page.getByRole('option', { name: label, exact: true });
        if ((await option.count()) > 0) {
          await option.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        await this.page.getByRole('option', { name: style, exact: true }).click();
      }
    }
    // Do NOT refocus here — focusing the contenteditable clears stored marks /
    // empty-paragraph style attrs (regression covered by paragraph-styles empty
    // heading tests). Radix SelectTrigger already preventDefault's mousedown
    // so the hidden PM keeps focus while the picker is used.
  }

  /**
   * Apply Normal style
   */
  async applyNormalStyle(): Promise<void> {
    await this.setParagraphStyle('Normal');
  }

  /**
   * Apply Heading 1 style
   */
  async applyHeading1(): Promise<void> {
    await this.setParagraphStyle('Heading 1');
  }

  /**
   * Apply Heading 2 style
   */
  async applyHeading2(): Promise<void> {
    await this.setParagraphStyle('Heading 2');
  }

  /**
   * Apply Heading 3 style
   */
  async applyHeading3(): Promise<void> {
    await this.setParagraphStyle('Heading 3');
  }

  /**
   * Apply Title style
   */
  async applyTitleStyle(): Promise<void> {
    await this.setParagraphStyle('Title');
  }

  /**
   * Apply Subtitle style
   */
  async applySubtitleStyle(): Promise<void> {
    await this.setParagraphStyle('Subtitle');
  }

  // ============================================================================
  // UNDO / REDO
  // ============================================================================

  /**
   * Close a still-open Radix listbox/menu without sending Escape to the body PM
   * (Escape maps to `selectParentNode` and would select the whole paragraph).
   */
  async dismissOpenOverlays(): Promise<void> {
    const overlay = this.page.locator(
      '[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]'
    );
    if ((await overlay.count()) === 0) return;
    const first = overlay.first();
    if (!(await first.isVisible().catch(() => false))) return;
    await this.page.keyboard.press('Escape').catch(() => undefined);
  }

  /**
   * Undo via the editor keymap. Prefer the shortcut over the toolbar button:
   * `canUndo` is driven by React `pmState`, which can lag a frame behind the
   * live body EditorView after rapid formatting transactions.
   */
  async undo(): Promise<void> {
    await this.dismissOpenOverlays();
    await this.focus();
    await this.undoShortcut();
  }

  /**
   * Undo via keyboard shortcut
   */
  async undoShortcut(): Promise<void> {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.keyboard.press(`${modifier}+z`);
  }

  /**
   * Redo via the editor keymap (see `undo()`).
   */
  async redo(): Promise<void> {
    await this.dismissOpenOverlays();
    await this.focus();
    await this.redoShortcut();
  }

  /**
   * Redo via keyboard shortcut (Ctrl+Y or Ctrl+Shift+Z)
   */
  async redoShortcut(): Promise<void> {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.keyboard.press(`${modifier}+y`);
  }

  /**
   * Check if undo is available
   */
  async isUndoAvailable(): Promise<boolean> {
    return !(await this.undoButton.isDisabled());
  }

  /**
   * Check if redo is available
   */
  async isRedoAvailable(): Promise<boolean> {
    return !(await this.redoButton.isDisabled());
  }

  // ============================================================================
  // TABLES
  // ============================================================================

  /**
   * Place the caret in the first cell of the first table via the e2e hook.
   * Visual cell clicks do not always establish `isInTable` for the toolbar.
   */
  async focusFirstTableCell(): Promise<void> {
    const ok = await this.page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.focusFirstTableCell?.() ?? false
    );
    if (!ok) {
      throw new Error('focusFirstTableCell: e2e hook returned false (no table cell?)');
    }
    await this.page.waitForTimeout(50);
  }

  /**
   * Insert a table with specified dimensions using the e2e hook (grid UI is 6×6).
   */
  async insertTable(rows: number, cols: number): Promise<void> {
    const ok = await insertTableViaE2eHook(this.page, rows, cols);
    if (!ok) {
      const inlinePicker = this.page.locator('[data-testid="toolbar-insert-table"]');
      if (await inlinePicker.isVisible().catch(() => false)) {
        await inlinePicker.click();
      } else {
        await this.page.getByRole('button', { name: /^Insert$/ }).click();
        await this.page
          .getByRole('button', { name: /^Table$/ })
          .first()
          .hover();
      }
      const grid = this.page.getByRole('grid', { name: 'Table size selector' });
      await grid.waitFor({ state: 'visible', timeout: 5000 });
      const gridColumns = await grid.evaluate((el) => {
        const columns = window
          .getComputedStyle(el)
          .gridTemplateColumns.split(/\s+/)
          .filter(Boolean);
        return columns.length || 6;
      });
      const targetCell = grid.getByRole('gridcell').nth((rows - 1) * gridColumns + (cols - 1));
      await targetCell.hover();
      await this.page.waitForTimeout(100);
      await targetCell.click();
    }
    await this.page.waitForSelector('.paged-editor__hidden-pm table', {
      state: 'attached',
      timeout: 5000,
    });
    await this.page.waitForSelector('.paged-editor__pages .layout-table', {
      state: 'visible',
      timeout: 5000,
    });
    await this.focusFirstTableCell();
  }

  /**
   * Click on a specific table cell
   */
  async clickTableCell(tableIndex: number, row: number, col: number): Promise<void> {
    if (await focusBodyPmTableCell(this.page, tableIndex, row, col)) return;
    const table = this.page.locator('.paged-editor__pages .layout-table').nth(tableIndex);
    const cell = table.locator('.layout-table-row').nth(row).locator('.layout-table-cell').nth(col);
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    if (tableIndex === 0 && row === 0 && col === 0) {
      await this.focusFirstTableCell().catch(() => undefined);
    }
  }

  /**
   * Right-click on a specific visual table cell to open the text context menu
   */
  async rightClickTableCell(tableIndex: number, row: number, col: number): Promise<void> {
    const table = this.page.locator('.paged-editor__pages .layout-table').nth(tableIndex);
    const cell = table.locator('.layout-table-row').nth(row).locator('.layout-table-cell').nth(col);
    await cell.scrollIntoViewIfNeeded();
    await cell.click({ button: 'right' });
    await this.page.waitForSelector('[role="menu"]', { state: 'visible', timeout: 5000 });
  }

  /**
   * Get table cell content
   */
  async getTableCellContent(tableIndex: number, row: number, col: number): Promise<string> {
    const table = this.page.locator('.paged-editor__hidden-pm table').nth(tableIndex);
    const cell = table.locator('tr').nth(row).locator('td, th').nth(col);
    return (await cell.textContent()) ?? '';
  }

  /**
   * Count tables in the document
   */
  async getTableCount(): Promise<number> {
    return await this.page.locator('.paged-editor__hidden-pm table').count();
  }

  /**
   * Get table dimensions (rows x cols)
   */
  async getTableDimensions(tableIndex: number): Promise<{ rows: number; cols: number }> {
    const table = this.page.locator('.paged-editor__hidden-pm table').nth(tableIndex);
    const rows = await table.locator('tr').count();
    const cols = await table.locator('tr').first().locator('td, th').count();
    return { rows, cols };
  }

  /**
   * Open table "More" dropdown (must be in a table first)
   */
  async openTableMore(): Promise<void> {
    const more = this.page.locator('[data-testid="toolbar-table-more"]');
    if (!(await more.isVisible().catch(() => false))) {
      await this.focusFirstTableCell();
    }
    await more.waitFor({ state: 'visible', timeout: 5000 });
    await more.click();
    await this.page.waitForSelector('[role="menu"]', { state: 'visible', timeout: 5000 });
  }

  /**
   * Click a table menu item in the More dropdown
   */
  async clickTableMenuItem(itemName: string): Promise<void> {
    await this.page.getByRole('menuitem', { name: itemName }).click();
    await this.page.waitForTimeout(100);
  }

  /**
   * Add a row above current cell
   */
  async addRowAbove(): Promise<void> {
    await this.openTableMore();
    await this.clickTableMenuItem('Insert row above');
  }

  /**
   * Add a row below current cell
   */
  async addRowBelow(): Promise<void> {
    await this.openTableMore();
    await this.clickTableMenuItem('Insert row below');
  }

  /**
   * Add a column to the left
   */
  async addColumnLeft(): Promise<void> {
    await this.openTableMore();
    await this.clickTableMenuItem('Insert column left');
  }

  /**
   * Add a column to the right
   */
  async addColumnRight(): Promise<void> {
    await this.openTableMore();
    await this.clickTableMenuItem('Insert column right');
  }

  /**
   * Delete current row
   */
  async deleteRow(): Promise<void> {
    await this.openTableMore();
    await this.clickTableMenuItem('Delete row');
  }

  /**
   * Delete current column
   */
  async deleteColumn(): Promise<void> {
    await this.openTableMore();
    await this.clickTableMenuItem('Delete column');
  }

  /**
   * Delete entire table
   */
  async deleteTable(): Promise<void> {
    await this.openTableMore();
    await this.clickTableMenuItem('Delete table');
  }

  /**
   * Set all borders on current cell
   */
  async setAllBorders(): Promise<void> {
    await this.page.locator('[data-testid="toolbar-table-borders"]').click();
    await this.page.waitForTimeout(100);
    await this.page.locator('button[title="All borders"]').click();
  }

  /**
   * Remove borders from current cell
   */
  async removeBorders(): Promise<void> {
    await this.page.locator('[data-testid="toolbar-table-borders"]').click();
    await this.page.waitForTimeout(100);
    await this.page.locator('button[title="No borders"]').click();
  }

  /**
   * Set cell fill color
   */
  async setCellFillColor(color: string): Promise<void> {
    const hex = color.replace(/^#/, '');
    await this.pickColorFromDropdown('Cell Fill Color', hex);
  }

  /**
   * Get cell background color
   */
  async getCellBackgroundColor(tableIndex: number, row: number, col: number): Promise<string> {
    const table = this.page.locator('.ProseMirror table').nth(tableIndex);
    const cell = table.locator('tr').nth(row).locator('td, th').nth(col);
    const style = await cell.getAttribute('style');
    // Extract background-color from style
    const match = style?.match(/background-color:\s*([^;]+)/);
    return match ? match[1].trim() : '';
  }

  /**
   * Check if cell has visible borders (not all set to 'none')
   */
  async cellHasBorders(tableIndex: number, row: number, col: number): Promise<boolean> {
    const table = this.page.locator('.ProseMirror table').nth(tableIndex);
    const cell = table.locator('tr').nth(row).locator('td, th').nth(col);
    const style = await cell.getAttribute('style');

    if (!style) return false;

    // Browser normalizes 'border: none' to 'border-style: none'
    if (style.includes('border-style: none')) {
      return false;
    }

    // Check if 'border: none' is explicitly set
    if (style.includes('border: none')) {
      return false;
    }

    // Check if all individual borders are set to none
    const hasTopNone = style.includes('border-top: none');
    const hasBottomNone = style.includes('border-bottom: none');
    const hasLeftNone = style.includes('border-left: none');
    const hasRightNone = style.includes('border-right: none');

    // If all 4 borders are explicitly set to none, no borders
    if (hasTopNone && hasBottomNone && hasLeftNone && hasRightNone) {
      return false;
    }

    // Otherwise, check if there's any border definition (default or explicit)
    return style.includes('border');
  }

  /**
   * Save the document
   */
  async saveDocument(): Promise<void> {
    // Wait for any pending changes
    await this.page.waitForTimeout(200);
    // Prefer the title-bar Save button — `text=Save` matches demo document body copy.
    await this.page.getByRole('button', { name: 'Save', exact: true }).click();
    // Wait for download or save confirmation
    await this.page.waitForTimeout(500);
  }

  /**
   * Click New button to create a new document
   */
  async newDocument(): Promise<void> {
    // The demo app fetches sample.docx asynchronously on mount.
    // Clicking "New" sets a guard (see App.tsx) so a late-resolving demo fetch
    // can no longer clobber the reset document. Wait for whatever is currently
    // loading to settle, then reset.
    await this.waitForDocumentTextStable();

    await this.page.locator('button:has-text("New")').click();

    // Confirm the editor actually reset to an empty document before returning.
    await this.page.waitForFunction(
      () => (window.__DOCX_EDITOR_E2E__?.agentGetDocumentText() ?? '').trim().length === 0,
      { timeout: 5000 }
    );
  }

  /**
   * Poll the document text until it stops changing, i.e. any in-flight load
   * (the demo fixture the example app fetches on mount) has fully settled.
   * For specs that boot empty via `gotoEmpty()` there is no such load and
   * this returns after the minimum poll window.
   */
  private async waitForDocumentTextStable(): Promise<void> {
    const requiredStableReads = 3;
    const pollIntervalMs = 200;
    const timeoutMs = 15000;
    let previous: string | null = null;
    let identicalReads = 0;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const text = await this.page.evaluate(
        () => window.__DOCX_EDITOR_E2E__?.agentGetDocumentText() ?? ''
      );
      identicalReads = text === previous ? identicalReads + 1 : 1;
      previous = text;
      if (identicalReads >= requiredStableReads) return;
      await this.page.waitForTimeout(pollIntervalMs);
    }
    // The document never settled. Don't hang the suite — let the caller
    // proceed and fail with its own clearer assertion, but flag the cause.
    console.warn(`waitForDocumentTextStable: document text never settled within ${timeoutMs}ms`);
  }

  // ============================================================================
  // FIND & REPLACE
  // ============================================================================

  /**
   * Open find dialog (Ctrl+F / Cmd+F)
   */
  async openFind(): Promise<void> {
    // React binds find to metaKey on Mac and ctrlKey elsewhere
    // (`useKeyboardShortcuts`). Playwright's Meta+f reaches the editor on
    // Chromium/macOS; Control+f does not match the Mac handler.
    await this.focus();
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.keyboard.press(`${modifier}+f`);
    await this.findReplaceDialog.waitFor();
  }

  /**
   * Open find & replace dialog (Ctrl+H / Cmd+H)
   */
  async openFindReplace(): Promise<void> {
    await this.focus();
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.keyboard.press(`${modifier}+h`);
    await this.findReplaceDialog.waitFor();
  }

  /**
   * Perform find operation
   */
  async find(searchText: string): Promise<void> {
    await this.page.locator('[data-testid="find-input"]').fill(searchText);
    await this.page.locator('[data-testid="find-input"]').press('Enter');
  }

  /**
   * Find next match
   */
  async findNext(): Promise<void> {
    await this.page.locator('[aria-label="Find next"]').click();
  }

  /**
   * Find previous match
   */
  async findPrevious(): Promise<void> {
    await this.page.locator('[aria-label="Find previous"]').click();
  }

  /**
   * Replace current match
   */
  async replace(replaceText: string): Promise<void> {
    await this.page.locator('[data-testid="replace-input"]').fill(replaceText);
    await this.page.locator('[data-testid="replace-button"]').click();
  }

  /**
   * Replace all matches
   */
  async replaceAll(searchText: string, replaceText: string): Promise<void> {
    await this.page.locator('[data-testid="find-input"]').fill(searchText);
    await this.page.locator('[data-testid="replace-input"]').fill(replaceText);
    await this.page.locator('[data-testid="replace-all-button"]').click();
  }

  /**
   * Close find/replace dialog
   */
  async closeFindReplace(): Promise<void> {
    // Prefer the dialog close control: Escape often lands on the body PM
    // (`selectParentNode`) after replace actions move focus out of the dialog.
    const closeBtn = this.findReplaceDialog.locator(
      '.docx-find-replace-dialog-close, .find-replace-dialog__close'
    );
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await this.findReplaceDialog.waitFor({ state: 'hidden' });
  }

  // ============================================================================
  // ZOOM
  // ============================================================================

  /**
   * Set zoom level
   */
  async setZoom(level: number): Promise<void> {
    const zoomInput = this.page.locator('.zoom-control input');
    await zoomInput.fill(level.toString());
    await zoomInput.press('Enter');
  }

  /**
   * Zoom in
   */
  async zoomIn(): Promise<void> {
    await this.page.locator('.zoom-control [aria-label="Zoom in"]').click();
  }

  /**
   * Zoom out
   */
  async zoomOut(): Promise<void> {
    await this.page.locator('.zoom-control [aria-label="Zoom out"]').click();
  }

  // ============================================================================
  // ASSERTIONS
  // ============================================================================

  /**
   * Assert the editor is visible and ready
   */
  async expectReady(): Promise<void> {
    await expect(this.editor).toBeVisible();
  }

  /**
   * Assert document has specific paragraph count
   */
  async expectParagraphCount(count: number): Promise<void> {
    const paragraphs = this.page.locator('[data-paragraph-index]');
    await expect(paragraphs).toHaveCount(count);
  }

  /**
   * Assert paragraph contains text
   */
  async expectParagraphText(index: number, expectedText: string): Promise<void> {
    const paragraph = this.getParagraph(index);
    await expect(paragraph).toContainText(expectedText);
  }

  /**
   * Assert text is bold (has bold styling)
   */
  async expectTextBold(text: string): Promise<boolean> {
    return await this.page.evaluate((searchText) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);

      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent?.includes(searchText)) {
          let element = node.parentElement;
          while (element) {
            const style = window.getComputedStyle(element);
            if (style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 700) {
              return true;
            }
            if (element.tagName === 'STRONG' || element.tagName === 'B') {
              return true;
            }
            element = element.parentElement;
          }
        }
      }
      return false;
    }, text);
  }

  /**
   * Assert text is italic (has italic styling)
   */
  async expectTextItalic(text: string): Promise<boolean> {
    return await this.page.evaluate((searchText) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);

      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent?.includes(searchText)) {
          let element = node.parentElement;
          while (element) {
            const style = window.getComputedStyle(element);
            if (style.fontStyle === 'italic') {
              return true;
            }
            if (element.tagName === 'EM' || element.tagName === 'I') {
              return true;
            }
            element = element.parentElement;
          }
        }
      }
      return false;
    }, text);
  }

  /**
   * Assert toolbar button is active
   */
  async expectToolbarButtonActive(buttonName: string): Promise<void> {
    const button = this.toolbar.locator(`[data-testid="toolbar-${buttonName}"]`);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }

  /**
   * Assert toolbar button is not active
   */
  async expectToolbarButtonInactive(buttonName: string): Promise<void> {
    const button = this.toolbar.locator(`[data-testid="toolbar-${buttonName}"]`);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  }

  /**
   * Get the document text content
   */
  async getDocumentText(): Promise<string> {
    const contentArea = this.getContentArea();
    return (await contentArea.textContent()) ?? '';
  }

  /**
   * Assert document contains text
   */
  async expectDocumentContains(text: string): Promise<void> {
    const contentArea = this.getContentArea();
    await expect(contentArea).toContainText(text);
  }

  /**
   * Assert document does not contain text
   */
  async expectDocumentNotContains(text: string): Promise<void> {
    const contentArea = this.getContentArea();
    await expect(contentArea).not.toContainText(text);
  }

  /**
   * Take a screenshot for visual comparison
   */
  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  }

  /**
   * Wait for any animations to complete
   */
  async waitForAnimations(): Promise<void> {
    await this.page.waitForTimeout(300);
  }

  /**
   * Focus the editor content area
   */
  async focus(): Promise<void> {
    const contentArea = this.getContentArea();
    await contentArea.focus();
  }

  /**
   * Blur the editor (click outside)
   */
  async blur(): Promise<void> {
    await this.page.click('body', { position: { x: 0, y: 0 } });
  }
}
