// Oracles for the `shapeFormat` shapes: a shape's properties hold each once-only child at most
// once, every part passes the tree invariants, and save and reopen keep the semantic digest. A
// saved file also holds exactly one fill in each hidden fill (at most one in a hidden line), and
// its VML fallback says the fill and outline the DrawingML copy writes.

import {
  semanticDigest,
  validateOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { reopen } from './scenario-oracles.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const VML = 'urn:schemas-microsoft-com:vml';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const FILLS = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']);
/** VML elements that draw one shape, in the order a fallback lists them. */
const VML_SHAPES = new Set([
  'rect',
  'roundrect',
  'oval',
  'shape',
  'line',
  'polyline',
  'arc',
  'curve',
]);

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

type Element = OoxmlElement;
const elements = (node: Element): Element[] => {
  const children: readonly OoxmlNode[] = node.children;
  return children.filter((child): child is Element => child.kind !== 'textValue');
};
const attribute = (node: Element, name: string) =>
  node.attributes.find((a) => !a.namespaceUri && a.localName === name)?.value;
const off = (value: string | undefined) =>
  value !== undefined && ['f', 'false', '0'].includes(value.trim().toLowerCase());

function collect(node: Element, keep: (node: Element) => boolean, into: Element[]): Element[] {
  if (keep(node)) into.push(node);
  for (const child of elements(node)) collect(child, keep, into);
  return into;
}

/** Whether a fill paints, and its plain sRGB colour; null when the element cannot say. */
function paintOf(fill: Element | undefined): { paints: boolean; color: string | null } | null {
  if (!fill || fill.localName === 'grpFill') return null;
  const color = elements(fill)[0];
  const plain =
    fill.localName === 'solidFill' &&
    color?.localName === 'srgbClr' &&
    elements(color).every((c) => c.localName === 'alpha');
  const value = plain ? attribute(color!, 'val') : undefined;
  return { paints: fill.localName !== 'noFill', color: value ? `#${value.toLowerCase()}` : null };
}

/** How one VML copy contradicts the fill and line its DrawingML shape writes. */
function vmlProblems(wsp: Element, vml: Element, where: string): string[] {
  const spPr = elements(wsp).find((c) => c.localName === 'spPr');
  if (!spPr) return [];
  const problems: string[] = [];
  const check = (what: string, fill: Element | undefined, flag: string, colour: string) => {
    const paint = paintOf(fill);
    if (!paint) return;
    const named = attribute(vml, colour);
    if (paint.paints && off(attribute(vml, flag)))
      problems.push(`${where}: VML ${vml.id} says ${flag}="f" over a ${what} that shows`);
    if (!paint.paints && named !== undefined && !off(attribute(vml, flag)))
      problems.push(`${where}: VML ${vml.id} paints ${colour} ${named} over a hidden ${what}`);
    const plain = named && /^#[0-9a-f]{6}$/i.test(named.trim()) ? named.trim().toLowerCase() : null;
    if (paint.paints && paint.color && plain && plain !== paint.color)
      problems.push(`${where}: VML ${vml.id} ${colour} ${plain} against ${what} ${paint.color}`);
  };
  const fills = elements(spPr).filter((c) => c.namespaceUri === A && FILLS.has(c.localName));
  if (vml.localName !== 'line') check('fill', fills[0], 'filled', 'fillcolor');
  const ln = elements(spPr).find((c) => c.namespaceUri === A && c.localName === 'ln');
  const lineFill = ln && elements(ln).find((c) => c.namespaceUri === A && FILLS.has(c.localName));
  check('line', lineFill, 'stroked', 'strokecolor');
  return problems;
}

/**
 * The saved-file rules: each `a14:hiddenFill` holds exactly one fill, each `a14:hiddenLine` at
 * most one, and each VML fallback agrees with the fill and line its DrawingML copy writes.
 */
export function shapeSavedProblems(pkg: OoxmlPackage, where: string): string[] {
  const problems: string[] = [];
  for (const part of pkg.parts.values()) {
    if (!part.root) continue;
    const at = `${where} ${part.name}`;
    const hidden = collect(
      part.root,
      (n) =>
        n.namespaceUri === A14 && (n.localName === 'hiddenFill' || n.localName === 'hiddenLine'),
      []
    );
    for (const node of hidden) {
      const count = elements(node).filter(
        (c) => c.namespaceUri === A && FILLS.has(c.localName)
      ).length;
      if (count > 1 || (node.localName === 'hiddenFill' && count === 0))
        problems.push(`${at}: ${node.localName} ${node.id} holds ${count} fills`);
    }
    const alternates = collect(
      part.root,
      (n) => n.namespaceUri === MC && n.localName === 'AlternateContent',
      []
    );
    for (const alternate of alternates) {
      const choice = elements(alternate).find((c) => c.localName === 'Choice');
      const fallback = elements(alternate).find((c) => c.localName === 'Fallback');
      if (!choice || !fallback) continue;
      const shapes = collect(choice, (n) => n.namespaceUri === WPS && n.localName === 'wsp', []);
      const copies = collect(
        fallback,
        (n) => n.namespaceUri === VML && VML_SHAPES.has(n.localName),
        []
      );
      // Pair by order only where both copies list the same number of shapes.
      if (shapes.length !== copies.length) continue;
      shapes.forEach((wsp, index) => problems.push(...vmlProblems(wsp, copies[index]!, at)));
    }
  }
  return problems;
}

/** Save and reopen keep the semantic digest, and the reopened package keeps the shape rules. */
export function shapeRoundTripProblems(pkg: OoxmlPackage): string[] {
  const once = reopen(pkg);
  const twice = reopen(once);
  const problems = [
    ...shapePackageProblems(once, 'reopened'),
    ...shapeSavedProblems(once, 'saved'),
  ];
  const digest = (value: OoxmlPackage) => JSON.stringify(semanticDigest(value.parts.values()));
  if (digest(once) !== digest(twice)) problems.push('semantic digest changes on save and reopen');
  return problems;
}
