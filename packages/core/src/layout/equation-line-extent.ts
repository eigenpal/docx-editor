// The vertical extent that an equation claims on its line when its runs differ in size.
import type { EquationGeometry, EquationRowGeometry } from './equation-layout.ts';
import { equationInk, isInvisibleEquationText } from './equation-ink.ts';
import { box, shifted } from './equation-scripts.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** The space kept above the ink of the math, in ems of the first atom size (`MathLeading`). */
const MATH_LEADING = 300 / 2048;

function collectAtoms(node: EquationGeometry, atoms: EquationGeometry[]): void {
  if (node.kind === 'row') for (const item of node.items) collectAtoms(item, atoms);
  else atoms.push(node);
}

/**
 * Fit the outer row of an equation to the extent that it claims on its line.
 *
 * The first atom of the equation claims its whole font box. A later text atom claims only
 * its glyph ink, plus the math leading of the first atom's size above the ink, and never
 * more than its own font box. So a larger run after a smaller one raises the line by its
 * ink, not by its font box, and a larger run without descending glyphs does not deepen it.
 * Later text that draws nothing, such as a space, claims no height. Structures keep their
 * boxes. Rows align every atom on one baseline, so the atoms of nested rows take part too.
 * A text atom without measured ink keeps its font box.
 *
 * `structureSizePt` is the leading size when the first atom is a structure. The result is
 * `root` itself when the extent does not change, which holds for every equation whose
 * text atoms share one size and face.
 */
export function fitEquationLineExtent(
  root: EquationGeometry,
  structureSizePt: number,
  measurer: TextMeasurer
): EquationGeometry {
  if (root.kind !== 'row') return root;
  const atoms: EquationGeometry[] = [];
  collectAtoms(root, atoms);
  const first = atoms[0];
  if (!first || atoms.length < 2) return root;
  const leading = MATH_LEADING * (first.kind === 'text' ? first.fontSizePt : structureSizePt);
  let ascent = first.baseline;
  let descent = first.box.height - first.baseline;
  for (let index = 1; index < atoms.length; index += 1) {
    const atom = atoms[index]!;
    // Later text that draws nothing, such as a larger space, claims no height.
    if (atom.kind === 'text' && isInvisibleEquationText(atom.text)) continue;
    let atomAscent = atom.baseline;
    let atomDescent = atom.box.height - atom.baseline;
    // Ink can only lower a claim, so read it only for a box that reaches past the extent.
    if (atom.kind === 'text' && (atomAscent > ascent || atomDescent > descent)) {
      const ink = equationInk(atom, measurer);
      if (!ink.fromFontBox) {
        atomAscent = Math.min(atomAscent, ink.ascent + leading);
        atomDescent = Math.min(atomDescent, ink.descent);
      }
    }
    ascent = Math.max(ascent, atomAscent);
    descent = Math.max(descent, atomDescent);
  }
  const rootDescent = root.box.height - root.baseline;
  if (ascent === root.baseline && descent === rootDescent) return root;
  const dy = ascent - root.baseline;
  const fitted: EquationRowGeometry = Object.freeze({
    ...root,
    items: Object.freeze(root.items.map((item) => shifted(item, item.box.x, item.box.y + dy))),
    box: box(root.box.x, root.box.y, root.box.width, ascent + descent),
    baseline: ascent,
  });
  return fitted;
}
