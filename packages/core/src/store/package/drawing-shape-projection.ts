// Renderable projections of `wps:wsp` graphics: solid-geometry vector shapes and textbox
// stories. Split from drawing-projection.ts, which owns the drawing walk, MC selection, and
// the assembled DrawingProjection; this module is pure direct-child reads with no walk state.

import { findDirectKind, isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';

const WPS_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPS_GRAPHIC_DATA_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const SHAPE_HEX_RE = /^[0-9A-Fa-f]{6}$/;
const MAX_VECTOR_SHAPE_SUBPATHS = 64;
const MAX_VECTOR_SHAPE_POINTS = 1024;

export const MAX_EMU = 2 ** 31 - 1;

export function parseEmu(value: string | undefined, clamp = true): number | null {
  if (value === undefined || !/^-?\d{1,15}$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (!clamp) return parsed;
  if (parsed < 0) return 0;
  if (parsed > MAX_EMU) return MAX_EMU;
  return parsed;
}

export function findDirectChild(
  nodes: readonly OoxmlNode[],
  options: {
    readonly typedKind?: string;
    readonly namespaceUri?: string;
    readonly localName?: string;
  }
): OoxmlElement | null {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (options.typedKind !== undefined && node.kind === options.typedKind) return node;
    if (
      options.namespaceUri !== undefined &&
      options.localName !== undefined &&
      node.kind === 'generic' &&
      node.namespaceUri === options.namespaceUri &&
      node.localName === options.localName
    ) {
      return node;
    }
  }
  return null;
}

/**
 * The renderable subset of a `wps:wsp` non-picture graphic: closed polygon subpaths
 * (`a:custGeom` with move/line/close verbs only, or `a:prstGeom prst="rect"`) with a
 * solid sRGB fill and/or stroke. Anything richer (curves, theme fills, text bodies,
 * rotation) projects as `null` and paints the labelled placeholder instead.
 */
export interface VectorShapeProjection {
  /** The drawing extent that frames the subpath coordinate space. */
  readonly extentEmu: Readonly<{ cx: number; cy: number }>;
  /** Closed subpath polygons in extent-EMU space; fill rule is even-odd. */
  readonly subpathsEmu: readonly (readonly Readonly<{ x: number; y: number }>[])[];
  /** Validated 6-digit sRGB hex (no `#`), or null for no fill. */
  readonly fillHex: string | null;
  /** Validated 6-digit sRGB hex (no `#`), or null for no stroke. */
  readonly strokeHex: string | null;
  /** Stroke width in EMU; 0 when absent. */
  readonly strokeWidthEmu: number;
}

/**
 * The story carried by a `wps:wsp` text box (`wps:txbx` → `w:txbxContent`).
 *
 * The projection captures only the story root and the shape chrome reads; it never walks the
 * story content, so the per-drawing element budget is not spent on paragraphs. Layout collects
 * blocks from `content` under its own caps.
 */
export interface TextboxStoryProjection {
  /** Canonical node id of the `w:txbxContent` element. */
  readonly contentNodeId: string;
  /** The `w:txbxContent` element itself; treated as an opaque story root here. */
  readonly content: OoxmlElement;
  /** `wps:bodyPr` insets with the OOXML defaults (91440 EMU l/r, 45720 EMU t/b) when absent. */
  readonly insetsEmu: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  /** `wps:bodyPr/@anchor` collapsed to the three renderable positions; default top. */
  readonly verticalAnchor: 'top' | 'center' | 'bottom';
  /** Autofit child of `wps:bodyPr`; extent stays authoritative either way (diagnostic only). */
  readonly autofit: 'none' | 'shape' | 'normal';
  /** Solid fill of the hosting shape, painted behind the story; null for no fill. */
  readonly fillHex: string | null;
  /** Solid outline of the hosting shape; null for no outline. */
  readonly strokeHex: string | null;
  /** Outline width in EMU; 0 when absent. */
  readonly strokeWidthEmu: number;
}

/** Direct `a:solidFill > a:srgbClr @val` under `parent`; only a validated 6-hex passes. */
function readSolidFillHex(parent: OoxmlElement): string | null {
  const solidFill = findDirectChild(parent.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'solidFill',
  });
  if (!solidFill) return null;
  const srgb = findDirectChild(solidFill.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'srgbClr',
  });
  if (!srgb) return null;
  const value = schemaAttributeValue(srgb.attributes, 'val');
  return value !== undefined && SHAPE_HEX_RE.test(value) ? value : null;
}

/** Polygon subpaths of one `a:path` — move/line/close verbs only; anything else refuses. */
function readShapePathPolygons(
  path: OoxmlElement,
  scaleX: number,
  scaleY: number,
  sink: { x: number; y: number }[][],
  pointBudget: { remaining: number }
): boolean {
  let current: { x: number; y: number }[] | null = null;
  for (const verb of path.children) {
    if (!isElement(verb)) continue;
    if (verb.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return false;
    if (verb.localName === 'close') {
      current = null;
      continue;
    }
    if (verb.localName !== 'moveTo' && verb.localName !== 'lnTo') return false;
    const pt = findDirectChild(verb.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'pt',
    });
    if (!pt) return false;
    const x = parseEmu(schemaAttributeValue(pt.attributes, 'x'), false);
    const y = parseEmu(schemaAttributeValue(pt.attributes, 'y'), false);
    if (x === null || y === null) return false;
    const scaled = { x: x * scaleX, y: y * scaleY };
    if (!Number.isFinite(scaled.x) || !Number.isFinite(scaled.y)) return false;
    if (pointBudget.remaining <= 0) return false;
    pointBudget.remaining -= 1;
    if (verb.localName === 'moveTo' || current === null) {
      if (sink.length >= MAX_VECTOR_SHAPE_SUBPATHS) return false;
      current = [scaled];
      sink.push(current);
    } else {
      current.push(scaled);
    }
  }
  return true;
}

/** The `wps:wsp` under the anchor's graphic data, or null when the payload is something else. */
function findWspInAnchor(anchor: OoxmlElement): OoxmlElement | null {
  // Non-picture graphic payloads demote to generic nodes even under a typed
  // `drawingGraphic`, so the generic lookup is always in play here.
  const graphic =
    findDirectKind(anchor.children, 'drawingGraphic') ??
    findDirectChild(anchor.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'graphic',
    });
  if (!graphic) return null;
  const data =
    findDirectKind(graphic.children, 'drawingGraphicData') ??
    findDirectChild(graphic.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'graphicData',
    });
  if (!data) return null;
  if (schemaAttributeValue(data.attributes, 'uri') !== WPS_GRAPHIC_DATA_URI) return null;
  return (
    findDirectChild(data.children, {
      namespaceUri: WPS_NAMESPACE_URI,
      localName: 'wsp',
    }) ?? null
  );
}

/**
 * Renderable-subset projection of a `wps:wsp` graphic. Returns null (→ placeholder) for
 * text bodies, rotated/flipped transforms, non-solid fills, curves, or over-limit paths.
 */
export function projectVectorShape(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  compatibilityMode: boolean
): VectorShapeProjection | null {
  void compatibilityMode;
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const wsp = findWspInAnchor(anchor);
  if (!wsp) return null;
  if (findDirectChild(wsp.children, { namespaceUri: WPS_NAMESPACE_URI, localName: 'txbx' })) {
    return null;
  }
  const spPr = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'spPr',
  });
  if (!spPr) return null;
  const xfrm = findDirectChild(spPr.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'xfrm',
  });
  if (xfrm) {
    const rot = schemaAttributeValue(xfrm.attributes, 'rot');
    if (rot !== undefined && rot !== '0') return null;
    if (schemaAttributeValue(xfrm.attributes, 'flipH') === '1') return null;
    if (schemaAttributeValue(xfrm.attributes, 'flipV') === '1') return null;
  }

  const fillHex = readSolidFillHex(spPr);
  const ln = findDirectChild(spPr.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'ln',
  });
  const strokeHex = ln ? readSolidFillHex(ln) : null;
  const strokeWidthEmu =
    strokeHex !== null ? (parseEmu(schemaAttributeValue(ln!.attributes, 'w')) ?? 12_700) : 0;
  if (fillHex === null && strokeHex === null) return null;

  const subpaths: { x: number; y: number }[][] = [];
  const custGeom = findDirectChild(spPr.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'custGeom',
  });
  if (custGeom) {
    const pathLst = findDirectChild(custGeom.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'pathLst',
    });
    if (!pathLst) return null;
    const pointBudget = { remaining: MAX_VECTOR_SHAPE_POINTS };
    for (const child of pathLst.children) {
      if (!isElement(child)) continue;
      if (child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI || child.localName !== 'path') {
        return null;
      }
      const pathW = parseEmu(schemaAttributeValue(child.attributes, 'w')) ?? extent.cx;
      const pathH = parseEmu(schemaAttributeValue(child.attributes, 'h')) ?? extent.cy;
      if (pathW <= 0 || pathH <= 0) return null;
      if (
        !readShapePathPolygons(child, extent.cx / pathW, extent.cy / pathH, subpaths, pointBudget)
      ) {
        return null;
      }
    }
  } else {
    const prstGeom = findDirectChild(spPr.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'prstGeom',
    });
    if (!prstGeom || schemaAttributeValue(prstGeom.attributes, 'prst') !== 'rect') return null;
    subpaths.push([
      { x: 0, y: 0 },
      { x: extent.cx, y: 0 },
      { x: extent.cx, y: extent.cy },
      { x: 0, y: extent.cy },
    ]);
  }
  const polygons = subpaths.filter((points) => points.length >= 3);
  if (polygons.length === 0) return null;
  return {
    extentEmu: { cx: extent.cx, cy: extent.cy },
    subpathsEmu: polygons,
    fillHex,
    strokeHex,
    strokeWidthEmu,
  };
}

/** OOXML `wps:bodyPr` inset defaults in EMU. */
const DEFAULT_TEXTBOX_INSET_LR_EMU = 91_440;
const DEFAULT_TEXTBOX_INSET_TB_EMU = 45_720;

/**
 * Story projection of a `wps:wsp` carrying a `wps:txbx`. Captures the `w:txbxContent` root and
 * the bodyPr/shape-chrome reads without walking the story content; returns null when the shape
 * is not a text box or the box has no usable extent.
 */
export function projectTextboxStory(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>
): TextboxStoryProjection | null {
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const wsp = findWspInAnchor(anchor);
  if (!wsp) return null;
  const txbx = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'txbx',
  });
  if (!txbx) return null;
  const content = findDirectChild(txbx.children, {
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'txbxContent',
  });
  if (!content) return null;

  const bodyPr = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'bodyPr',
  });
  const inset = (name: string, fallback: number): number => {
    const raw = bodyPr ? schemaAttributeValue(bodyPr.attributes, name) : undefined;
    if (raw === undefined) return fallback;
    const value = parseEmu(raw, false);
    return value === null || value < 0 ? fallback : value;
  };
  const anchorRaw = bodyPr ? schemaAttributeValue(bodyPr.attributes, 'anchor') : undefined;
  const verticalAnchor =
    anchorRaw === 'ctr' ? 'center' : anchorRaw === 'b' ? 'bottom' : ('top' as const);
  let autofit: TextboxStoryProjection['autofit'] = 'none';
  if (bodyPr) {
    if (
      findDirectChild(bodyPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'spAutoFit',
      })
    ) {
      autofit = 'shape';
    } else if (
      findDirectChild(bodyPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'normAutofit',
      })
    ) {
      autofit = 'normal';
    }
  }

  const spPr = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'spPr',
  });
  const fillHex = spPr ? readSolidFillHex(spPr) : null;
  const ln = spPr
    ? findDirectChild(spPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'ln',
      })
    : null;
  const strokeHex = ln ? readSolidFillHex(ln) : null;
  const strokeWidthEmu =
    strokeHex !== null ? (parseEmu(schemaAttributeValue(ln!.attributes, 'w')) ?? 12_700) : 0;

  return {
    contentNodeId: content.id,
    content,
    insetsEmu: {
      top: inset('tIns', DEFAULT_TEXTBOX_INSET_TB_EMU),
      right: inset('rIns', DEFAULT_TEXTBOX_INSET_LR_EMU),
      bottom: inset('bIns', DEFAULT_TEXTBOX_INSET_TB_EMU),
      left: inset('lIns', DEFAULT_TEXTBOX_INSET_LR_EMU),
    },
    verticalAnchor,
    autofit,
    fillHex,
    strokeHex,
    strokeWidthEmu,
  };
}
