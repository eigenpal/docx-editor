// Drawing renderers that a capability package installs: a chart reader, and the SmartArt
// layout engine for a diagram saved without its drawing part.
//
// The engine reads a saved SmartArt drawing, shapes, groups, canvases and pictures on its own.
// A chart, or a diagram it would have to lay out, keeps its labelled placeholder until a
// renderer for it is installed. Installation is process-wide, because drawing projections are
// shared by every editor and export that reads the same parsed package; install renderers
// before any document opens.

import type { ChartPartResolver } from './chart-parts.ts';
import type {
  ShapeSchemeColorResolver,
  VectorShapeProjection,
} from './drawing-shape-projection.ts';
import type { GroupTextboxProjection } from './group-textbox-projection.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

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
