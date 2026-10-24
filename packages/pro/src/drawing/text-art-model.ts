/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The typed model of a VML text path shape (`v:shape` of a text path type, `#_x0000_t136`
// plain text to `#_x0000_t175`): the shape, its `v:textpath`, `v:fill`, `v:stroke`,
// `v:path`, `v:shadow` and `o:extrusion`, the `v:shapetype` it names when the drawing holds
// it, and anything else it holds.
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
  VML_OFFICE_NAMESPACE_URI as OFFICE,
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
  readonly coordsize?: string;
  readonly coordorigin?: string;
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
  readonly color2?: string;
  readonly opacity?: string;
  /** `o:opacity2`, the opacity at `color2`. */
  readonly opacity2?: string;
  readonly type?: string;
  readonly angle?: string;
  readonly focus?: string;
  readonly focussize?: string;
  readonly focusposition?: string;
  readonly colors?: string;
  readonly method?: string;
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

/** `v:shadow`. */
export interface TextArtShadowModel {
  readonly nodeId: string;
  readonly on?: string;
  readonly type?: string;
  readonly color?: string;
  readonly color2?: string;
  readonly offset?: string;
  readonly offset2?: string;
  readonly opacity?: string;
  readonly obscured?: string;
  readonly otherAttributes: OtherAttributes;
}

/** `o:extrusion`: the 3-D extrusion of the shape. */
export interface TextArtExtrusionModel {
  readonly nodeId: string;
  readonly on?: string;
  readonly type?: string;
  readonly render?: string;
  readonly backdepth?: string;
  readonly foredepth?: string;
  readonly color?: string;
  readonly colormode?: string;
  readonly viewpoint?: string;
  readonly viewpointorigin?: string;
  readonly skewangle?: string;
  readonly skewamt?: string;
  readonly brightness?: string;
  readonly lightposition?: string;
  readonly lightlevel?: string;
  readonly lightposition2?: string;
  readonly lightlevel2?: string;
  readonly lightharsh?: string;
  readonly lightharsh2?: string;
  readonly rotationangle?: string;
  readonly orientationangle?: string;
  readonly otherAttributes: OtherAttributes;
}

/** The `v:shapetype` a shape names: its geometry and its defaults. */
export interface TextArtTemplateModel {
  readonly nodeId: string;
  readonly id?: string;
  /** `o:spt`, the shape type number. */
  readonly spt?: string;
  readonly adj?: string;
  readonly path?: string;
  readonly coordsize?: string;
  readonly coordorigin?: string;
  /** Every `v:formulas/v:f/@eqn`, in order. */
  readonly formulas: readonly string[];
  readonly textPaths: readonly TextPathModel[];
  readonly paths: readonly TextArtPathModel[];
}

/** A child outside the modelled kinds: a lock, a wrap, or anything else. */
export interface TextArtOtherChild {
  readonly nodeId: string;
  readonly namespaceUri: string;
  readonly localName: string;
  readonly attributeCount: number;
}

/** A VML text path shape. Lists keep every occurrence, so the projection can refuse repeats. */
export interface LegacyTextArtModel {
  readonly shape: TextArtShapeModel;
  readonly template: TextArtTemplateModel | null;
  readonly textPaths: readonly TextPathModel[];
  readonly fills: readonly TextArtFillModel[];
  readonly strokes: readonly TextArtStrokeModel[];
  readonly paths: readonly TextArtPathModel[];
  readonly shadows: readonly TextArtShadowModel[];
  readonly extrusions: readonly TextArtExtrusionModel[];
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
  'coordsize',
  'coordorigin',
  'filled',
  'fillcolor',
  'stroked',
  'strokecolor',
  'strokeweight',
] as const;
const TEXT_PATH = ['on', 'fitshape', 'fitpath', 'string', 'trim', 'xscale'] as const;
const FILL = [
  'on',
  'color',
  'color2',
  'opacity',
  'type',
  'angle',
  'focus',
  'focussize',
  'focusposition',
  'colors',
  'method',
] as const;
const STROKE = ['on', 'color', 'weight', 'opacity', 'joinstyle'] as const;
const SHADOW = [
  'on',
  'type',
  'color',
  'color2',
  'offset',
  'offset2',
  'opacity',
  'obscured',
] as const;
const EXTRUSION = [
  'on',
  'type',
  'render',
  'backdepth',
  'foredepth',
  'color',
  'colormode',
  'viewpoint',
  'viewpointorigin',
  'skewangle',
  'skewamt',
  'brightness',
  'lightposition',
  'lightlevel',
  'lightposition2',
  'lightlevel2',
  'lightharsh',
  'lightharsh2',
  'rotationangle',
  'orientationangle',
] as const;

/** The text path shape types: plain text (`136`) through the can shapes (`175`). */
export function textPathShapeType(type: string | undefined): number | null {
  const match = /^#_x0000_t(\d{3})$/.exec(type ?? '');
  const spt = match ? Number(match[1]) : NaN;
  return spt >= 136 && spt <= 175 ? spt : null;
}

function textPath(child: OoxmlElement): TextPathModel {
  return {
    nodeId: child.id,
    ...pick(child, TEXT_PATH),
    style: vmlStyle(child),
    otherAttributes: others(child, [...TEXT_PATH, 'style']),
  };
}

function pathModel(child: OoxmlElement): TextArtPathModel {
  // `textpathok` is read in any namespace, as writers spell it either way.
  const textpathok = child.attributes.find((attr) => attr.localName === 'textpathok');
  return {
    nodeId: child.id,
    ...(textpathok ? { textpathok: textpathok.value } : {}),
    otherAttributes: child.attributes
      .filter((attr) => attr.localName !== 'textpathok')
      .map((attr) => attr.localName),
  };
}

/** The template model of a `v:shapetype`, or null for any other node. */
export function readTextArtTemplateModel(node: OoxmlElement): TextArtTemplateModel | null {
  if (!vmlNamed(node, VML, 'shapetype')) return null;
  const formulas: string[] = [];
  const textPaths: TextPathModel[] = [];
  const paths: TextArtPathModel[] = [];
  for (const child of vmlChildren(node)) {
    if (vmlNamed(child, VML, 'formulas')) {
      for (const f of vmlChildren(child))
        if (vmlNamed(f, VML, 'f')) formulas.push(a(f, 'eqn') ?? '');
    } else if (vmlNamed(child, VML, 'textpath')) textPaths.push(textPath(child));
    else if (vmlNamed(child, VML, 'path')) paths.push(pathModel(child));
  }
  const spt = node.attributes.find(
    (attr) => attr.namespaceUri === OFFICE && attr.localName === 'spt'
  );
  return {
    nodeId: node.id,
    ...pick(node, ['id', 'adj', 'path', 'coordsize', 'coordorigin'] as const),
    ...(spt ? { spt: spt.value } : {}),
    formulas,
    textPaths,
    paths,
  };
}

/**
 * The text art model of a VML shape of a text path type, or null for any other node.
 * `template` is the `v:shapetype` the shape names, when the drawing holds it.
 */
export function readLegacyTextArtModel(
  node: OoxmlElement,
  template?: OoxmlElement
): LegacyTextArtModel | null {
  if (!vmlNamed(node, VML, 'shape') || textPathShapeType(a(node, 'type')) === null) return null;
  const textPaths: TextPathModel[] = [];
  const fills: TextArtFillModel[] = [];
  const strokes: TextArtStrokeModel[] = [];
  const paths: TextArtPathModel[] = [];
  const shadows: TextArtShadowModel[] = [];
  const extrusions: TextArtExtrusionModel[] = [];
  const rest: TextArtOtherChild[] = [];
  let nestedChildren = false;
  for (const child of vmlChildren(node)) {
    if (vmlChildren(child).length) nestedChildren = true;
    const base = { nodeId: child.id };
    if (vmlNamed(child, VML, 'textpath')) {
      textPaths.push(textPath(child));
    } else if (vmlNamed(child, VML, 'fill')) {
      const opacity2 = a(child, 'opacity2', OFFICE);
      fills.push({
        ...base,
        ...pick(child, FILL),
        ...(opacity2 !== undefined ? { opacity2 } : {}),
        otherAttributes: others(child, FILL).filter((name) => name !== `{${OFFICE}}opacity2`),
      });
    } else if (vmlNamed(child, VML, 'stroke')) {
      strokes.push({ ...base, ...pick(child, STROKE), otherAttributes: others(child, STROKE) });
    } else if (vmlNamed(child, VML, 'path')) {
      paths.push(pathModel(child));
    } else if (vmlNamed(child, VML, 'shadow')) {
      shadows.push({ ...base, ...pick(child, SHADOW), otherAttributes: others(child, SHADOW) });
    } else if (vmlNamed(child, OFFICE, 'extrusion')) {
      // `v:ext` only says which editor wrote the element.
      extrusions.push({
        ...base,
        ...pick(child, EXTRUSION),
        otherAttributes: others(child, EXTRUSION).filter((name) => name !== `{${VML}}ext`),
      });
    } else {
      rest.push({
        ...base,
        namespaceUri: child.namespaceUri,
        localName: child.localName,
        attributeCount: child.attributes.length,
      });
    }
  }
  return {
    shape: { nodeId: node.id, ...pick(node, SHAPE), style: vmlStyle(node) },
    template: template ? readTextArtTemplateModel(template) : null,
    textPaths,
    fills,
    strokes,
    paths,
    shadows,
    extrusions,
    others: rest,
    nestedChildren,
  };
}
