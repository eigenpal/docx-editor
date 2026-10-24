/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The typed model of a VML text path shape (`v:shape` of type `#_x0000_t136`, plain text
// WordArt): the shape, its `v:textpath`, `v:fill`, `v:stroke` and `v:path`, and anything else
// it holds.
//
// Each field is the raw value of one attribute, undefined when absent, and every element keeps
// its canonical node id, so an editor can change one field and write it back with a tree op.
// Attributes outside the model are listed by name, so the projection can refuse what it does
// not know. The reader is pure and the model holds no paint state: `text-art-projection.ts`
// decides what paints.

import {
  vmlAttribute as a,
  vmlChildren,
  vmlNamed,
  vmlStyle,
  VML_NAMESPACE_URI as VML,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';

/** Attributes of an element that the model does not name, as `name` or `{namespace}name`. */
type OtherAttributes = readonly string[];

/** The `v:shape` itself. */
export interface TextArtShapeModel {
  readonly nodeId: string;
  readonly id?: string;
  readonly type?: string;
  readonly adj?: string;
  readonly path?: string;
  readonly filled?: string;
  readonly fillcolor?: string;
  readonly stroked?: string;
  readonly strokecolor?: string;
  readonly strokeweight?: string;
  /** The `style` declarations; null when the attribute is malformed. */
  readonly style: ReadonlyMap<string, string> | null;
}

/** `v:textpath`. */
export interface TextPathModel {
  readonly nodeId: string;
  readonly on?: string;
  readonly fitshape?: string;
  readonly fitpath?: string;
  readonly string?: string;
  readonly trim?: string;
  readonly xscale?: string;
  /** The `style` declarations; null when the attribute is malformed. */
  readonly style: ReadonlyMap<string, string> | null;
  readonly otherAttributes: OtherAttributes;
}

/** `v:fill`. */
export interface TextArtFillModel {
  readonly nodeId: string;
  readonly on?: string;
  readonly color?: string;
  readonly opacity?: string;
  readonly type?: string;
  readonly focussize?: string;
  readonly otherAttributes: OtherAttributes;
}

/** `v:stroke`. */
export interface TextArtStrokeModel {
  readonly nodeId: string;
  readonly on?: string;
  readonly color?: string;
  readonly weight?: string;
  readonly opacity?: string;
  readonly joinstyle?: string;
  readonly otherAttributes: OtherAttributes;
}

/** `v:path`. */
export interface TextArtPathModel {
  readonly nodeId: string;
  readonly textpathok?: string;
  readonly otherAttributes: OtherAttributes;
}

/** A child outside the four modelled kinds: a shadow, a lock, a wrap, or anything else. */
export interface TextArtOtherChild {
  readonly nodeId: string;
  readonly namespaceUri: string;
  readonly localName: string;
  /** `on`, for a `v:shadow`. */
  readonly on?: string;
  readonly attributeCount: number;
}

/** A VML text path shape. Lists keep every occurrence, so the projection can refuse repeats. */
export interface LegacyTextArtModel {
  readonly shape: TextArtShapeModel;
  readonly textPaths: readonly TextPathModel[];
  readonly fills: readonly TextArtFillModel[];
  readonly strokes: readonly TextArtStrokeModel[];
  readonly paths: readonly TextArtPathModel[];
  readonly others: readonly TextArtOtherChild[];
  /** True when any child holds elements of its own. */
  readonly nestedChildren: boolean;
}

function others(node: OoxmlElement, known: readonly string[]): OtherAttributes {
  return node.attributes
    .filter((attr) => attr.namespaceUri || !known.includes(attr.localName))
    .map((attr) =>
      attr.namespaceUri ? `{${attr.namespaceUri}}${attr.localName}` : attr.localName
    );
}

function pick<K extends string>(
  node: OoxmlElement,
  names: readonly K[]
): { readonly [key in K]?: string } {
  const out: { [key in K]?: string } = {};
  for (const name of names) {
    const value = a(node, name);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

const SHAPE = [
  'id',
  'type',
  'adj',
  'path',
  'filled',
  'fillcolor',
  'stroked',
  'strokecolor',
  'strokeweight',
] as const;
const TEXT_PATH = ['on', 'fitshape', 'fitpath', 'string', 'trim', 'xscale'] as const;
const FILL = ['on', 'color', 'opacity', 'type', 'focussize'] as const;
const STROKE = ['on', 'color', 'weight', 'opacity', 'joinstyle'] as const;

/** The text art model of a VML shape of type `#_x0000_t136`, or null for any other node. */
export function readLegacyTextArtModel(node: OoxmlElement): LegacyTextArtModel | null {
  if (!vmlNamed(node, VML, 'shape') || a(node, 'type') !== '#_x0000_t136') return null;
  const textPaths: TextPathModel[] = [];
  const fills: TextArtFillModel[] = [];
  const strokes: TextArtStrokeModel[] = [];
  const paths: TextArtPathModel[] = [];
  const rest: TextArtOtherChild[] = [];
  let nestedChildren = false;
  for (const child of vmlChildren(node)) {
    if (vmlChildren(child).length) nestedChildren = true;
    const base = { nodeId: child.id };
    if (vmlNamed(child, VML, 'textpath')) {
      textPaths.push({
        ...base,
        ...pick(child, TEXT_PATH),
        style: vmlStyle(child),
        otherAttributes: others(child, [...TEXT_PATH, 'style']),
      });
    } else if (vmlNamed(child, VML, 'fill')) {
      fills.push({ ...base, ...pick(child, FILL), otherAttributes: others(child, FILL) });
    } else if (vmlNamed(child, VML, 'stroke')) {
      strokes.push({ ...base, ...pick(child, STROKE), otherAttributes: others(child, STROKE) });
    } else if (vmlNamed(child, VML, 'path')) {
      // `textpathok` is read in any namespace, as writers spell it either way.
      const textpathok = child.attributes.find((attr) => attr.localName === 'textpathok');
      paths.push({
        ...base,
        ...(textpathok ? { textpathok: textpathok.value } : {}),
        otherAttributes: child.attributes
          .filter((attr) => attr.localName !== 'textpathok')
          .map((attr) => attr.localName),
      });
    } else {
      const on = a(child, 'on');
      rest.push({
        ...base,
        namespaceUri: child.namespaceUri,
        localName: child.localName,
        ...(on !== undefined ? { on } : {}),
        attributeCount: child.attributes.length,
      });
    }
  }
  return {
    shape: { nodeId: node.id, ...pick(node, SHAPE), style: vmlStyle(node) },
    textPaths,
    fills,
    strokes,
    paths,
    others: rest,
    nestedChildren,
  };
}
