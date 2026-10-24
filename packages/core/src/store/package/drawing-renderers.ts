// Drawing renderers that a capability package installs: a chart reader, the SmartArt layout
// engine for a diagram saved without its drawing part, shape effects beyond the outer shadow,
// VML text art outside a watermark, and the EMF/WMF metafile replay and rasterizer.
//
// The engine reads a saved SmartArt drawing, shapes, groups, canvases and pictures on its own.
// A chart, or a diagram it would have to lay out, keeps its labelled placeholder until a
// renderer for it is installed. A shape paints without the effects no renderer projects, a
// text path outside a watermark keeps the placeholder of a refused legacy drawing, and a
// metafile picture keeps the placeholder of an image format the engine cannot decode.
//
// The boundary is the projection: the engine paints whatever a projection carries, and a
// renderer decides whether the projection carries it. Installation is process-wide, because
// drawing projections are shared by every editor and export that reads the same parsed
// package; install renderers before any document opens. Looking up a renderer is one property
// read, so documents without these drawings pay nothing for the hooks.

import type { ChartPartResolver } from './chart-parts.ts';
import type {
  ShapeSchemeColorResolver,
  VectorShapeProjection,
} from './drawing-shape-projection.ts';
import type { GroupTextboxProjection } from './group-textbox-projection.ts';
import type { OoxmlElement } from './ooxml-tree.ts';
import type { ShapeEffectList } from './drawing-shape-effects.ts';
import type { PictureFrameEffects } from './drawing-picture-frame.ts';
import type { VectorShapeComponent } from './drawing-shape-projection.ts';
import type { LegacyTextArtProjection } from './legacy-vml-text-art.ts';
import type { MetafileImageMime } from './image-resources.ts';
import type { MetafileReplay, MetafileReplayOptions } from './metafile-drawing.ts';

/**
 * What a shape effects renderer reads for one shape: its properties, the effect list the
 * engine resolved for the outer shadow, and the components the engine painted.
 *
 * @public
 */
export interface ShapeEffectsInput {
  /** The shape (`wps:wsp`) or picture (`pic:pic`) element. */
  readonly shape: OoxmlElement;
  /** Its shape properties (`wps:spPr` or `pic:spPr`). */
  readonly spPr: OoxmlElement;
  /** Its own effect list or the theme one it references; null when it has neither. */
  readonly effectList: ShapeEffectList | null;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
}

/**
 * What a picture effects renderer returns: effects that change how the picture paints, and
 * components that paint under it.
 *
 * @public
 */
export interface PictureEffectsProjection {
  readonly effects?: PictureFrameEffects;
  /** Painted first, under the picture's shadow, fill and image. */
  readonly underComponents?: readonly VectorShapeComponent[];
}

/**
 * Shape and picture effects beyond the outer shadow: glow, inner shadow, reflection, soft
 * edge, and the rim of a dark-edged bevel.
 *
 * @public
 */
export interface DrawingEffectsRenderer {
  /**
   * The components of a shape with its effects added, in paint order. Return `components`
   * itself when the shape has no effect the renderer paints.
   */
  readonly shape: (
    input: ShapeEffectsInput & {
      readonly components: readonly VectorShapeComponent[];
      readonly extent: Readonly<{ cx: number; cy: number }>;
    }
  ) => readonly VectorShapeComponent[];
  /**
   * The effects of a picture. `outlineEmu` holds the closed outlines of the picture's frame in
   * its extent, or null when the frame paints nothing (a turned picture, or one past the point
   * budget). Null when the picture has no effect the renderer paints.
   */
  readonly picture: (
    input: ShapeEffectsInput & {
      readonly outlineEmu: readonly (readonly Readonly<{ x: number; y: number }>[])[] | null;
    }
  ) => PictureEffectsProjection | null;
}

/** A metafile raster for the editor: PNG bytes the image pipeline validates again. @public */
export interface MetafileRasterImage {
  readonly bytes: Uint8Array;
  readonly mime: 'image/png';
}

/**
 * EMF and WMF pictures: a vector replay for exporters, and a raster for the browser editor.
 * Both run on attacker-controlled bytes and must bound their own work.
 *
 * @public
 */
export interface MetafileRenderer {
  /** Vector drawing commands in canvas pixels, or null when the bytes do not replay. */
  readonly replay: (
    bytes: Uint8Array,
    mime: MetafileImageMime,
    options: MetafileReplayOptions
  ) => Promise<MetafileReplay | null>;
  /**
   * A PNG of the metafile no larger than `maxEdge` pixels on a side, drawn in the current
   * browser, or null when it does not draw.
   */
  readonly rasterize?: (
    bytes: Uint8Array,
    mime: MetafileImageMime,
    options: Readonly<{ maxEdge: number }>
  ) => Promise<MetafileRasterImage | null>;
}

/**
 * What a drawing renderer paints: vector components over the drawing extent, and read-only
 * stories for its text.
 *
 * @public
 */
export interface DrawingGraphicProjection {
  readonly vectorShape: VectorShapeProjection | null;
  readonly groupTextboxes: readonly GroupTextboxProjection[] | null;
}

/**
 * What a chart renderer reads beside the drawing.
 *
 * @public
 */
export interface ChartRenderContext {
  readonly resolveChartPart?: ChartPartResolver;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
}

/**
 * The parts a SmartArt layout engine lays a diagram out from.
 *
 * @public
 */
export interface DiagramLayoutParts {
  readonly dataModel: OoxmlElement;
  readonly layoutDef: OoxmlElement;
  readonly styleDef: OoxmlElement | null;
  readonly colorsDef: OoxmlElement | null;
}

/**
 * What a SmartArt layout engine reads beside the diagram parts.
 *
 * @public
 */
export interface DiagramLayoutOptions {
  /** The theme's minor (body) Latin font, which diagram text uses by default. */
  readonly fontFamily?: string;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
}

/**
 * Renderers a capability package installs.
 *
 * @public
 */
export interface DrawingRenderers {
  /**
   * The shapes and labels of a chart drawing, or null when the drawing is not a chart or the
   * chart is outside what the renderer paints.
   */
  readonly chart?: (
    anchor: OoxmlElement,
    extent: Readonly<{ cx: number; cy: number }>,
    context: ChartRenderContext
  ) => DrawingGraphicProjection | null;
  /**
   * The drawing part (`dsp:drawing`) Office would save for a diagram at this extent, or null
   * when its layout is outside what the engine places.
   */
  readonly diagramLayout?: (
    parts: DiagramLayoutParts,
    extent: Readonly<{ cx: number; cy: number }>,
    options: DiagramLayoutOptions
  ) => OoxmlElement | null;
  /** Glow, inner shadow, reflection, soft edge and bevel rim. The outer shadow is the engine's. */
  readonly effects?: DrawingEffectsRenderer;
  /**
   * The text art of a VML text path (`v:shape` of type `#_x0000_t136`) outside a watermark,
   * or null when the shape is outside what the renderer projects. A watermark's text art is
   * the engine's.
   */
  readonly legacyTextArt?: (shape: OoxmlElement) => LegacyTextArtProjection | null;
  /** EMF and WMF pictures. */
  readonly metafile?: MetafileRenderer;
}

let installed: DrawingRenderers = Object.freeze({});

/**
 * Install drawing renderers for every editor and export in this process. A later install
 * replaces the renderers it names and keeps the others. Install before any document opens:
 * a drawing already read keeps what it read.
 *
 * @public
 */
export function installDrawingRenderers(renderers: DrawingRenderers): void {
  installed = Object.freeze({ ...installed, ...renderers });
}

/** The installed renderers. */
export function drawingRenderers(): DrawingRenderers {
  return installed;
}
