/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The typed model of a shape's effects beyond the outer shadow: glow (`a:glow`), inner shadow
// (`a:innerShdw`), reflection (`a:reflection`), soft edge (`a:softEdge`) and the bevel of
// `a:sp3d`.
//
// Each field maps to one OOXML attribute and keeps its schema default when the attribute is
// absent; a malformed value reads as null. Every element keeps its canonical node id, so an
// editor can change one field and write it back with a tree op. The readers are pure and the
// model holds no paint state: `effects-projection.ts` turns it into paint.

import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  findDirectChild,
  isElement,
  resolveColorNode,
  schemaAttributeValue,
  type OoxmlElement,
  type ShapeColor,
  type ShapeEffectList,
  type ShapeSchemeColorResolver,
} from '@docx-editor.dev/core/store';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
/** Larger distances and radii are clamped: they would only add empty paint area. */
export const MAX_EFFECT_EMU = 1_270_000;

/** A colour child of an effect, resolved, with the node it was read from. */
export interface EffectColorModel {
  readonly nodeId: string;
  /** Null when the colour does not resolve. */
  readonly color: ShapeColor | null;
}

/** `a:glow`. */
export interface GlowModel {
  readonly nodeId: string;
  /** `rad`, in EMU. */
  readonly rad: number;
  /** The colour child; null when the glow has none. */
  readonly color: EffectColorModel | null;
}

/** `a:innerShdw`. */
export interface InnerShadowModel {
  readonly nodeId: string;
  /** `blurRad`, in EMU. */
  readonly blurRad: number;
  /** `dist`, in EMU. */
  readonly dist: number;
  /** `dir`, in 60,000ths of a degree. */
  readonly dir: number;
  /** The colour child; null when the shadow has none (black at full strength). */
  readonly color: EffectColorModel | null;
}

/** `a:reflection`. Shares are fractions (100000 is 1); angles are 60,000ths of a degree. */
export interface ReflectionModel {
  readonly nodeId: string;
  readonly blurRad: number;
  readonly stA: number | null;
  readonly stPos: number | null;
  readonly endA: number | null;
  readonly endPos: number | null;
  readonly dist: number;
  readonly dir: number | null;
  readonly fadeDir: number | null;
  readonly sx: number | null;
  readonly sy: number | null;
  readonly kx: number | null;
  readonly ky: number | null;
  readonly algn: string;
}

/** `a:softEdge`. */
export interface SoftEdgeModel {
  readonly nodeId: string;
  /** `rad`, in EMU. */
  readonly rad: number;
}

/** `a:sp3d` with its top or bottom bevel. */
export interface BevelModel {
  readonly nodeId: string;
  /** `prstMaterial`; null when absent. */
  readonly prstMaterial: string | null;
  /** `a:bevelT`, or `a:bevelB` when there is no top bevel; null when there is neither. */
  readonly bevel: {
    readonly nodeId: string;
    readonly edge: 'bevelT' | 'bevelB';
    /** `w`, in EMU; 0 when absent. */
    readonly w: number;
  } | null;
}

/** The effects of one shape that the effects projection reads. */
export interface DrawingEffectsModel {
  /** The effect list read from, or null when the shape has none. */
  readonly effectList: {
    readonly nodeId: string;
    /** True when the list is the theme one the shape's `effectRef` names. */
    readonly fromTheme: boolean;
  } | null;
  readonly glow: GlowModel | null;
  readonly innerShadow: InnerShadowModel | null;
  readonly reflection: ReflectionModel | null;
  readonly softEdge: SoftEdgeModel | null;
  readonly bevel: BevelModel | null;
}

function collapsed(element: OoxmlElement, name: string): string | undefined {
  const raw = schemaAttributeValue(element.attributes, name);
  return raw === undefined ? undefined : raw.replace(/[ \t\n\r]+/g, ' ').trim();
}

/** A non-negative length in EMU, clamped; 0 when absent or malformed. */
function length(element: OoxmlElement, name: string): number {
  const text = collapsed(element, name);
  if (text === undefined || !/^\d{1,10}$/.test(text)) return 0;
  return Math.min(MAX_EFFECT_EMU, Number(text));
}

/** An angle in 60,000ths of a degree; `fallback` when absent, null when malformed. */
function angle(element: OoxmlElement, name: string, fallback: number): number | null {
  const text = collapsed(element, name) ?? '';
  return text === '' ? fallback : /^-?\d{1,9}$/.test(text) ? Number(text) : null;
}

/** A fixed percentage as a fraction: thousandths of a percent, or a `%` value. */
function share(element: OoxmlElement, name: string, fallback: number): number | null {
  const text = collapsed(element, name);
  if (text === undefined) return fallback;
  if (/^-?\d{1,7}$/.test(text)) return Number(text) / 100_000;
  if (/^-?\d{1,4}(\.\d{1,3})?%$/.test(text)) return Number(text.slice(0, -1)) / 100;
  return null;
}

function colorChild(
  element: OoxmlElement,
  resolveSchemeColor: ShapeSchemeColorResolver | undefined,
  placeholder: ShapeColor | undefined
): EffectColorModel | null {
  const node = element.children.find(isElement);
  return node
    ? { nodeId: node.id, color: resolveColorNode(node, resolveSchemeColor, placeholder) }
    : null;
}

function child(parent: OoxmlElement, localName: string): OoxmlElement | null {
  return findDirectChild(parent.children, { namespaceUri: A, localName });
}

function readBevel(spPr: OoxmlElement): BevelModel | null {
  const sp3d = child(spPr, 'sp3d');
  if (!sp3d) return null;
  const top = child(sp3d, 'bevelT');
  const bevel = top ?? child(sp3d, 'bevelB');
  return {
    nodeId: sp3d.id,
    prstMaterial: schemaAttributeValue(sp3d.attributes, 'prstMaterial') ?? null,
    bevel: bevel
      ? { nodeId: bevel.id, edge: top ? 'bevelT' : 'bevelB', w: length(bevel, 'w') }
      : null,
  };
}

/**
 * The effects model of a shape or picture. `list` is the effect list the engine resolved for
 * it; the bevel comes from `spPr` itself.
 */
export function readDrawingEffects(
  spPr: OoxmlElement,
  list: ShapeEffectList | null,
  resolveSchemeColor?: ShapeSchemeColorResolver
): DrawingEffectsModel {
  const bevel = readBevel(spPr);
  if (!list) {
    return {
      effectList: null,
      glow: null,
      innerShadow: null,
      reflection: null,
      softEdge: null,
      bevel,
    };
  }
  const lst = list.effectLst;
  const glow = child(lst, 'glow');
  const inner = child(lst, 'innerShdw');
  const reflection = child(lst, 'reflection');
  const softEdge = child(lst, 'softEdge');
  return {
    effectList: { nodeId: lst.id, fromTheme: list.fromTheme },
    glow: glow
      ? {
          nodeId: glow.id,
          rad: length(glow, 'rad'),
          color: colorChild(glow, resolveSchemeColor, list.placeholder),
        }
      : null,
    innerShadow: inner
      ? {
          nodeId: inner.id,
          blurRad: length(inner, 'blurRad'),
          dist: length(inner, 'dist'),
          dir: /^\d{1,9}$/.test(collapsed(inner, 'dir') ?? '0')
            ? Number(collapsed(inner, 'dir') ?? '0')
            : 0,
          color: colorChild(inner, resolveSchemeColor, list.placeholder),
        }
      : null,
    reflection: reflection
      ? {
          nodeId: reflection.id,
          blurRad: length(reflection, 'blurRad'),
          stA: share(reflection, 'stA', 1),
          stPos: share(reflection, 'stPos', 0),
          endA: share(reflection, 'endA', 0),
          endPos: share(reflection, 'endPos', 1),
          dist: length(reflection, 'dist'),
          dir: angle(reflection, 'dir', 0),
          fadeDir: angle(reflection, 'fadeDir', 5_400_000),
          sx: share(reflection, 'sx', 1),
          sy: share(reflection, 'sy', 1),
          kx: angle(reflection, 'kx', 0),
          ky: angle(reflection, 'ky', 0),
          algn: schemaAttributeValue(reflection.attributes, 'algn') ?? 'b',
        }
      : null,
    softEdge: softEdge ? { nodeId: softEdge.id, rad: length(softEdge, 'rad') } : null,
    bevel,
  };
}

/** Whether the model holds anything the projection could paint. */
export function hasDrawingEffects(model: DrawingEffectsModel): boolean {
  return !!(model.glow || model.innerShadow || model.reflection || model.softEdge || model.bevel);
}
