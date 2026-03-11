/**
 * Text Box Renderer
 *
 * Renders text box fragments to DOM. Handles:
 * - Background fill color
 * - Border/outline
 * - Internal padding (margins)
 * - Paragraph content inside the box (using pre-measured data)
 */

import {
  DEFAULT_TEXTBOX_MARGINS,
  type TextBoxFragment,
  type TextBoxBlock,
  type TextBoxMeasure,
} from '../layout-engine/types';
import type { RenderContext } from './renderPage';
import { renderParagraphFragment } from './renderParagraph';

/**
 * CSS class names for text box elements
 */
export const TEXTBOX_CLASS_NAMES = {
  textBox: 'layout-textbox',
};

/**
 * Options for rendering a text box fragment
 */
export interface RenderTextBoxFragmentOptions {
  document?: Document;
}

/**
 * Render a text box fragment to DOM
 */
export function renderTextBoxFragment(
  fragment: TextBoxFragment,
  block: TextBoxBlock,
  measure: TextBoxMeasure,
  context: RenderContext,
  options: RenderTextBoxFragmentOptions = {}
): HTMLElement {
  const doc = options.document ?? document;

  const containerEl = doc.createElement('div');
  containerEl.className = TEXTBOX_CLASS_NAMES.textBox;

  // Basic styling
  containerEl.style.position = 'absolute';
  containerEl.style.width = `${fragment.width}px`;
  containerEl.style.height = `${fragment.height}px`;
  containerEl.style.overflow = 'hidden';
  containerEl.style.boxSizing = 'border-box';

  // Fill color
  if (block.fillColor) {
    containerEl.style.backgroundColor = block.fillColor;
  }

  // Border/outline
  if (block.outlineWidth && block.outlineWidth > 0) {
    const style = block.outlineStyle || 'solid';
    const color = block.outlineColor || '#000000';
    containerEl.style.border = `${block.outlineWidth}px ${style} ${color}`;
  }

  // Internal padding
  const margins = block.margins ?? DEFAULT_TEXTBOX_MARGINS;
  containerEl.style.padding = `${margins.top}px ${margins.right}px ${margins.bottom}px ${margins.left}px`;

  // Store metadata
  containerEl.dataset.blockId = String(fragment.blockId);
  if (fragment.pmStart !== undefined) {
    containerEl.dataset.pmStart = String(fragment.pmStart);
  }
  if (fragment.pmEnd !== undefined) {
    containerEl.dataset.pmEnd = String(fragment.pmEnd);
  }

  // Render inner paragraph content using pre-measured data
  const innerWidth = fragment.width - margins.left - margins.right;
  let yOffset = 0;

  for (let i = 0; i < block.content.length; i++) {
    const paraBlock = block.content[i];
    const paraMeasure = measure.innerMeasures[i];
    if (!paraMeasure) continue;

    const paraFragment = {
      kind: 'paragraph' as const,
      blockId: paraBlock.id,
      x: 0,
      y: yOffset,
      width: innerWidth,
      height: paraMeasure.totalHeight,
      pmStart: paraBlock.pmStart,
      pmEnd: paraBlock.pmEnd,
      fromLine: 0,
      toLine: paraMeasure.lines.length,
    };

    const paraEl = renderParagraphFragment(paraFragment, paraBlock, paraMeasure, context, {
      document: doc,
    });

    // Override absolute positioning to use relative flow within the text box
    paraEl.style.position = 'relative';
    paraEl.style.left = '0';
    paraEl.style.top = '0';

    containerEl.appendChild(paraEl);
    yOffset += paraMeasure.totalHeight;
  }

  return containerEl;
}
