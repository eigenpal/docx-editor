// Automatic text colour, and the cell backgrounds it is chosen against.
//
// A run with no `w:color` in its style hierarchy, or `w:val="auto"`, takes a colour from the
// background behind it (17.3.2.6 color, CT_Color). Paint writes that colour on the element
// that paints the background: run, paragraph, or cell shading (17.3.5 CT_Shd), or a text box
// fill (20.1.8.54 solidFill). Nested backgrounds write their own colour, so the nearest one wins.

import type { TableCellFragmentRecord } from '@docx-editor.dev/core/layout';
import type {
  ResolvedRevisionMarkup,
  RevisionMarkupNamedColor,
} from '../contracts/revision-markup.ts';
import { automaticTextColor } from '../layout/ooxml-shading.ts';
import { reviewAuthorSlotColor, type RevisionStyleContext } from './revision-presentation.ts';

/** A CSS colour automatic text paints in. */
export type AutomaticTextCss = '#FFFFFF' | '#000000';

/** The CSS colour of automatic text on a six-digit hex `background`: white on dark, else black. */
export function automaticTextCss(background: string | null | undefined): AutomaticTextCss {
  return automaticTextColor(background) ? '#FFFFFF' : '#000000';
}

/** A paint context that knows the automatic text colour its elements inherit. */
export interface AutomaticTextContext {
  /** Inherited from the nearest painted background; absent means the page's black. */
  readonly automaticText?: AutomaticTextCss;
}

/**
 * Write `color` as the automatic text colour of `element`, unless the element inherits it
 * already. Skipping the inherited value keeps paint from restyling every shaded paragraph.
 */
export function applyAutomaticText(
  element: HTMLElement,
  color: AutomaticTextCss,
  ctx: AutomaticTextContext
): void {
  if (color !== (ctx.automaticText ?? '#000000')) element.style.color = color;
}

const contextsByColor = new WeakMap<object, Map<AutomaticTextCss, object>>();

/** `ctx` for the content of an element whose automatic text is `color`; one copy per colour. */
export function withAutomaticText<T extends AutomaticTextContext>(
  ctx: T,
  color: AutomaticTextCss
): T {
  if (color === (ctx.automaticText ?? '#000000')) return ctx;
  let byColor = contextsByColor.get(ctx);
  if (!byColor) contextsByColor.set(ctx, (byColor = new Map()));
  let derived = byColor.get(color) as T | undefined;
  if (!derived) byColor.set(color, (derived = { ...ctx, automaticText: color }));
  return derived;
}

/**
 * The value of each `--doc-revision-color-*` token in the core stylesheet. A test holds the
 * two in step. Paint needs the hex to choose the automatic text colour on a revision cell.
 */
export const REVISION_MARKUP_COLOR_HEX: Readonly<Record<RevisionMarkupNamedColor, string>> =
  Object.freeze({
    black: '000000',
    blue: '0000FF',
    turquoise: '00FFFF',
    green: '008000',
    pink: 'FFC0CB',
    red: 'FF0000',
    yellow: 'FFFF00',
    white: 'FFFFFF',
    darkBlue: '000080',
    teal: '008080',
    darkGreen: '006400',
    violet: '800080',
    darkRed: '800000',
    darkYellow: '808000',
    gray50: '808080',
    gray25: 'C0C0C0',
    lightBlue: 'E0F3FA',
    lightYellow: 'FFF8DC',
    lightOrange: 'FFE5CC',
    lightPurple: 'EADCF4',
    lightGreen: 'E2EFD9',
    gray: 'D9D9D9',
  });

const CSS_HEX = /^#?([0-9A-Fa-f]{6})$/;
const SHADING_HEX = /^[0-9A-Fa-f]{6}$/;

/** What paints a cell's revision background. */
export interface CellRevisionPaint {
  readonly markup?: ResolvedRevisionMarkup;
  readonly styles?: RevisionStyleContext;
  readonly cellStyles?: RevisionStyleContext;
}

/**
 * Paint a cell's background, `w:shd` or the revision colour over it, and the automatic text
 * colour for the background that shows. Returns that colour, or null when the cell paints no
 * background. A revision colour that paint cannot read as hex (an author's ramp token or a
 * host colour in another CSS form) takes black automatic text: the default ramp is light
 * enough for it.
 */
export function paintCellBackground(
  element: HTMLElement,
  cell: Pick<TableCellFragmentRecord, 'shading' | 'revisionShading' | 'revisionShadingAuthor'>,
  revision: CellRevisionPaint,
  ctx: AutomaticTextContext
): AutomaticTextCss | null {
  let backgroundHex: string | null = null;
  if (cell.shading && SHADING_HEX.test(cell.shading)) {
    element.style.backgroundColor = `#${cell.shading}`;
    backgroundHex = cell.shading;
  }
  if (cell.revisionShading && revision.markup) {
    const color = revision.markup.cells[cell.revisionShading];
    element.dataset.revisionCell = cell.revisionShading;
    if (color !== 'none') {
      const author = cell.revisionShadingAuthor ?? '';
      if (color === 'byAuthor') {
        const declared = revision.styles?.styles.get(author)?.color;
        element.style.backgroundColor =
          declared ?? reviewAuthorSlotColor(revision.cellStyles?.authorSlots.get(author) ?? 0);
        backgroundHex = (declared && CSS_HEX.exec(declared)?.[1]) || '';
      } else {
        element.style.backgroundColor = `var(--doc-revision-color-${color})`;
        backgroundHex = REVISION_MARKUP_COLOR_HEX[color];
      }
    }
  }
  // Text over the cell takes the colour of the background that shows, over a text box's.
  if (backgroundHex === null) return null;
  const color = automaticTextCss(backgroundHex);
  applyAutomaticText(element, color, ctx);
  return color;
}
