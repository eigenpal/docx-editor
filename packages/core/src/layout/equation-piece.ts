// The style and layout inputs of one paragraph-level equation atom.

import {
  isOmmlDisplay,
  type OmmlEquationProjection,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { equationStyleForText, type EquationLayoutInput } from './equation-layout.ts';
import type { ResolvedRunStyle } from './run-style.ts';

/** An equation atom: its run style and the fields its layout piece carries. */
export interface EquationAtom {
  readonly style: ResolvedRunStyle;
  readonly extras: {
    readonly equation: OmmlEquationProjection;
    readonly equationLayout: EquationLayoutInput;
  };
}

/**
 * Describe the equation atom `node`, projected as `equation`, among text styled `text`. Runs
 * that share one default `w:sz` size the equation; otherwise it takes the text size.
 * Structures without a control size take the text size either way. The inputs that do not
 * live on the shared projection travel as data on the piece, so a piece whose style is
 * rebuilt keeps them.
 */
export function equationAtom(
  node: OoxmlNode,
  equation: OmmlEquationProjection,
  text: ResolvedRunStyle
): EquationAtom {
  return {
    style: equationStyleForText(text, equation.fontSizePt),
    extras: { equation, equationLayout: Object.freeze({ display: isOmmlDisplay(node) }) },
  };
}
