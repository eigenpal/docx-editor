// Oracles for the `shapeFormat` shapes: a shape's properties hold each once-only child at most
// once, every part passes the tree invariants, and save and reopen keep the semantic digest.

import {
  semanticDigest,
  validateOoxmlPart,
  type OoxmlNode,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { reopen } from './scenario-oracles.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

/** Whether the scenario runs the shape oracles; `configFor` turns it on for `shapeFormat*`. */
export const SHAPE_CHECKS = { enabled: false };

/** Children of `a:spPr` (or `wps:spPr`, `pic:spPr`) that may appear at most once together. */
const SHAPE_GROUPS: Readonly<Record<string, ReadonlySet<string>>> = {
  fill: new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']),
  geometry: new Set(['prstGeom', 'custGeom']),
  ln: new Set(['ln']),
  xfrm: new Set(['xfrm']),
};
/** Children of `a:ln` that may appear at most once together. */
const LINE_GROUPS: Readonly<Record<string, ReadonlySet<string>>> = {
  fill: new Set(['noFill', 'solidFill', 'gradFill', 'pattFill']),
  dash: new Set(['prstDash', 'custDash']),
  join: new Set(['round', 'bevel', 'miter']),
};
// Colour transforms may repeat (`EG_ColorTransform` is unbounded), so two `a:alpha` that
// concurrent transparency writes leave are valid XML; the runtime notes record that limit.

function repeated(
  node: OoxmlNode,
  groups: Readonly<Record<string, ReadonlySet<string>>>
): string | null {
  if (node.kind === 'textValue') return null;
  for (const [name, members] of Object.entries(groups)) {
    const count = node.children.filter(
      (child) =>
        child.kind !== 'textValue' && child.namespaceUri === A && members.has(child.localName)
    ).length;
    if (count > 1) return `${count} ${name} children`;
  }
  return null;
}

/** Every repeated once-only child under `root`, described with the node it sits in. */
export function shapePropertyProblems(root: OoxmlNode, where: string): string[] {
  const problems: string[] = [];
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 200) return;
    let found: string | null = null;
    if (node.localName === 'spPr' || node.localName === 'grpSpPr')
      found = repeated(node, SHAPE_GROUPS);
    else if (node.namespaceUri === A && node.localName === 'ln')
      found = repeated(node, LINE_GROUPS);
    if (found) problems.push(`${where}: ${node.localName} ${node.id} holds ${found}`);
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return problems;
}

/** The `shapeFormat` oracles for one package. */
export function shapePackageProblems(pkg: OoxmlPackage, where: string): string[] {
  const problems: string[] = [];
  for (const part of pkg.parts.values()) {
    if (!part.root) continue;
    problems.push(...shapePropertyProblems(part.root, `${where} ${part.name}`));
    const valid = validateOoxmlPart(part);
    if (!valid.ok)
      problems.push(`${where} ${part.name} fails validation: ${JSON.stringify(valid.issues[0])}`);
  }
  return problems;
}

/** Save and reopen keep the semantic digest, and the reopened package keeps the shape rules. */
export function shapeRoundTripProblems(pkg: OoxmlPackage): string[] {
  const once = reopen(pkg);
  const twice = reopen(once);
  const problems = shapePackageProblems(once, 'reopened');
  const digest = (value: OoxmlPackage) => JSON.stringify(semanticDigest(value.parts.values()));
  if (digest(once) !== digest(twice)) problems.push('semantic digest changes on save and reopen');
  return problems;
}
