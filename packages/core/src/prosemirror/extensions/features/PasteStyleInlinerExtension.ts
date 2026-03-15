/**
 * Paste Style Inliner Extension
 *
 * When pasting from apps like Google Docs that use class-based CSS
 * (e.g. `<style>.c5 { margin-top: 12pt }</style>`) instead of inline styles,
 * ProseMirror's parseDOM can't read the styles because elements aren't attached
 * to the live document during parsing.
 *
 * This extension provides a `transformPastedHTML` hook that:
 * 1. Parses the pasted HTML string
 * 2. Extracts all `<style>` rules
 * 3. Inlines them onto matching elements
 * 4. Returns the modified HTML so parseDOM can read inline styles
 */

import { Plugin } from 'prosemirror-state';
import { createExtension } from '../create';
import type { ExtensionRuntime } from '../types';
import { Priority } from '../types';

/**
 * Parse a CSS rule's style declarations into a Record<property, value>.
 */
function parseStyleDeclarations(cssText: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Split on semicolons, handling edge cases
  const declarations = cssText.split(';');
  for (const decl of declarations) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const prop = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (prop && value) {
      result[prop] = value;
    }
  }
  return result;
}

/**
 * Merge style declarations onto an element's existing inline style.
 * Existing inline styles take precedence (they were explicitly set by the app).
 */
function mergeStylesOntoElement(element: HTMLElement, declarations: Record<string, string>): void {
  const existingStyle = element.getAttribute('style') || '';
  const existingDeclarations = parseStyleDeclarations(existingStyle);

  // Only add properties that aren't already inline
  for (const [prop, value] of Object.entries(declarations)) {
    if (!(prop in existingDeclarations)) {
      element.style.setProperty(prop, value);
    }
  }
}

/**
 * Extract CSS rules from `<style>` elements and inline them onto matching elements.
 *
 * Uses the browser's CSSStyleSheet API to properly parse CSS rules,
 * handling complex selectors, specificity, etc.
 */
function inlineStylesFromStyleBlocks(doc: Document): void {
  const styleElements = doc.querySelectorAll('style');
  if (styleElements.length === 0) return;

  // Collect all CSS rules from all <style> blocks
  const rulesWithSelectors: Array<{
    selector: string;
    declarations: Record<string, string>;
  }> = [];

  for (const styleEl of styleElements) {
    const cssText = styleEl.textContent || '';
    if (!cssText.trim()) continue;

    // Use a temporary style sheet to parse CSS properly
    // This handles complex selectors, media queries, etc.
    try {
      const tempStyle = doc.createElement('style');
      tempStyle.textContent = cssText;
      doc.head.appendChild(tempStyle);

      const sheet = tempStyle.sheet;
      if (sheet) {
        for (let i = 0; i < sheet.cssRules.length; i++) {
          const rule = sheet.cssRules[i];
          if (rule instanceof CSSStyleRule) {
            const declarations: Record<string, string> = {};
            const style = rule.style;
            for (let j = 0; j < style.length; j++) {
              const prop = style[j];
              declarations[prop] = style.getPropertyValue(prop);
            }
            if (Object.keys(declarations).length > 0) {
              rulesWithSelectors.push({
                selector: rule.selectorText,
                declarations,
              });
            }
          }
        }
      }

      doc.head.removeChild(tempStyle);
    } catch {
      // If CSSStyleSheet parsing fails, fall back to regex-based parsing
      const ruleRegex = /([^{]+)\{([^}]+)\}/g;
      let match;
      while ((match = ruleRegex.exec(cssText)) !== null) {
        const selector = match[1].trim();
        const declarations = parseStyleDeclarations(match[2]);
        if (Object.keys(declarations).length > 0) {
          rulesWithSelectors.push({ selector, declarations });
        }
      }
    }
  }

  if (rulesWithSelectors.length === 0) return;

  // Apply each rule to matching elements in the document
  for (const { selector, declarations } of rulesWithSelectors) {
    try {
      const matchingElements = doc.body.querySelectorAll(selector);
      for (const el of matchingElements) {
        mergeStylesOntoElement(el as HTMLElement, declarations);
      }
    } catch {
      // Invalid selector — skip silently
    }
  }
}

/**
 * Transform pasted HTML by inlining class-based CSS from <style> blocks.
 */
function transformPastedHTML(html: string): string {
  // Quick check: if there's no <style> block, no work needed
  if (!html.includes('<style')) return html;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    inlineStylesFromStyleBlocks(doc);

    // Remove the <style> elements to keep the HTML clean
    const styleElements = doc.querySelectorAll('style');
    for (const el of styleElements) {
      el.remove();
    }

    return doc.body.innerHTML;
  } catch {
    // If parsing fails, return the original HTML unchanged
    return html;
  }
}

export const PasteStyleInlinerExtension = createExtension({
  name: 'pasteStyleInliner',
  // Run before other paste handlers so styles are inlined before parseDOM
  priority: Priority.High,
  onSchemaReady(): ExtensionRuntime {
    const plugin = new Plugin({
      props: {
        transformPastedHTML(html: string): string {
          return transformPastedHTML(html);
        },
      },
    });

    return { plugins: [plugin] };
  },
});
