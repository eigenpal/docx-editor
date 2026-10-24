/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Quick style and colours for a laid-out diagram shape.
//
// The quick style part (`dgm:styleDef`) maps a style label to theme style references
// (`lnRef`, `fillRef`, `effectRef`, `fontRef`). The colours part (`dgm:colorsDef`) maps the
// same label to colour lists; a shape's index among the shapes sharing its label picks the
// colour: `repeat` holds the last one, `cycle` wraps, `span` blends from the first colour to
// the last, written as the first colour with hue, saturation, luminance and alpha offsets.

import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  escapeXml,
  escapeXmlAttribute,
  isElement,
  resolveColorNode,
  type OoxmlElement,
  type ShapeSchemeColorResolver,
} from '@docx-editor.dev/core/store';
import { attr, dgmChild, dgmChildren } from './diagram-layout-model.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
/** Elements a serialized colour or paragraph subtree may hold. */
const MAX_SERIALIZED_ELEMENTS = 4096;

export interface StyleReferences {
  readonly line: { readonly idx: string; readonly color: OoxmlElement | null };
  readonly fill: { readonly idx: string; readonly color: OoxmlElement | null };
  readonly effect: { readonly idx: string; readonly color: OoxmlElement | null };
  readonly font: { readonly idx: string; readonly color: OoxmlElement | null };
}

function firstElement(element: OoxmlElement | null): OoxmlElement | null {
  if (!element) return null;
  for (const node of element.children) if (isElement(node)) return node;
  return null;
}

function drawingChild(element: OoxmlElement | null, localName: string): OoxmlElement | null {
  if (!element) return null;
  for (const node of element.children) {
    if (isElement(node) && node.namespaceUri === A && node.localName === localName) return node;
  }
  return null;
}

function labelElement(def: OoxmlElement | null, label: string | null): OoxmlElement | null {
  if (!def) return null;
  let fallback: OoxmlElement | null = null;
  for (const element of dgmChildren(def, 'styleLbl')) {
    const name = attr(element, 'name');
    if (name === label) return element;
    fallback ??= name === 'node0' ? element : null;
  }
  return fallback;
}

/** The theme style references a label names in the quick style part. */
export function styleReferences(
  styleDef: OoxmlElement | null,
  label: string | null
): StyleReferences {
  const style = dgmChild(labelElement(styleDef, label), 'style');
  const read = (name: string, fallbackIdx: string) => {
    const element = drawingChild(style, name);
    return { idx: attr(element, 'idx') ?? fallbackIdx, color: firstElement(element) };
  };
  return {
    line: read('lnRef', '0'),
    fill: read('fillRef', '0'),
    effect: read('effectRef', '0'),
    font: read('fontRef', 'minor'),
  };
}

export interface PickedColor {
  readonly element: OoxmlElement;
  /** Offsets to append: hue in 60000ths of a degree, the rest in 1000ths of a percent. */
  readonly offsets: readonly [number, number, number, number] | null;
}

function hsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/**
 * The colour of list `listName` for a shape at `index` of `count` sharing its label, or
 * null when the colours part has no colour there.
 */
export function pickColor(
  colorsDef: OoxmlElement | null,
  label: string | null,
  listName: string,
  index: number,
  count: number,
  resolveSchemeColor?: ShapeSchemeColorResolver
): PickedColor | null {
  const list = dgmChild(labelElement(colorsDef, label), listName);
  if (!list) return null;
  const colors: OoxmlElement[] = [];
  for (const node of list.children) {
    if (isElement(node) && node.namespaceUri === A) colors.push(node);
    if (colors.length >= 64) break;
  }
  if (colors.length === 0) return null;
  const method = attr(list, 'meth') ?? 'span';
  const i = Math.max(0, Math.trunc(index));
  if (method === 'repeat')
    return { element: colors[Math.min(i, colors.length - 1)]!, offsets: null };
  if (method === 'cycle') return { element: colors[i % colors.length]!, offsets: null };
  const first = colors[0]!;
  const last = colors[colors.length - 1]!;
  if (colors.length === 1 || count <= 1) return { element: first, offsets: null };
  const t = Math.min(1, i / (count - 1));
  const from = resolveColorNode(first, resolveSchemeColor);
  const to = resolveColorNode(last, resolveSchemeColor);
  if (!from || !to) return { element: first, offsets: null };
  const [h1, s1, l1] = hsl(from.hex);
  const [h2, s2, l2] = hsl(to.hex);
  return {
    element: first,
    offsets: [
      Math.round((h2 - h1) * t * 60_000),
      Math.round((s2 - s1) * t * 100_000),
      Math.round((l2 - l1) * t * 100_000),
      Math.round((to.alpha - from.alpha) * t * 100_000),
    ],
  };
}

const PREFIXES: Record<string, string> = {
  [A]: 'a',
};

/**
 * DrawingML markup for an element subtree from a diagram part. Only DrawingML elements and
 * unqualified attributes are written; everything is escaped. Null past the element cap or
 * when an element is outside DrawingML.
 */
export function serializeDrawingElement(
  element: OoxmlElement,
  extraChildren = '',
  budget = { remaining: MAX_SERIALIZED_ELEMENTS }
): string | null {
  const prefix = PREFIXES[element.namespaceUri];
  if (!prefix || --budget.remaining < 0) return null;
  const name = `${prefix}:${element.localName}`;
  let out = `<${name}`;
  for (const attribute of element.attributes) {
    if (attribute.namespaceUri !== '' || !/^[A-Za-z][\w.-]*$/.test(attribute.localName)) continue;
    out += ` ${attribute.localName}="${escapeXmlAttribute(attribute.value)}"`;
  }
  let body = '';
  for (const child of element.children) {
    if (child.kind === 'textValue') {
      body += escapeXml(child.value);
      continue;
    }
    if (!isElement(child)) continue;
    // Extensions outside DrawingML carry nothing a diagram shape draws.
    if (!PREFIXES[child.namespaceUri]) continue;
    const inner = serializeDrawingElement(child, '', budget);
    if (inner === null) return null;
    body += inner;
  }
  body += extraChildren;
  return body === '' ? `${out}/>` : `${out}>${body}</${name}>`;
}

/** A picked colour as markup, with its offsets appended after its own transforms. */
export function colorMarkup(picked: PickedColor | null): string | null {
  if (!picked) return null;
  const offsets = picked.offsets
    ? ['hueOff', 'satOff', 'lumOff', 'alphaOff']
        .map((name, i) => `<a:${name} val="${picked.offsets![i]}"/>`)
        .join('')
    : '';
  return serializeDrawingElement(picked.element, offsets);
}
