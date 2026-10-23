// SmartArt layout from the diagram parts, for a diagram saved without its drawing part.
//
// The data model's presentation points name the layout nodes that make them, so the layout
// tree is matched rather than expanded. Constraints, algorithms and the rule loop size and
// place every node; the quick style and colour parts style them. The result is the same
// `dsp:drawing` element a saved drawing part holds, built in memory and never written back.
//
// Anything outside the supported subset (an algorithm not implemented, a cap reached)
// returns null, and the diagram keeps its placeholder.

import { emitDiagramDrawing } from './diagram-layout-emit.ts';
import { tableDiagramTextMeasurer, type DiagramTextMeasurer } from './diagram-layout-metrics.ts';
import { readDiagramModel } from './diagram-layout-model.ts';
import { solveWithRules } from './diagram-layout-rules.ts';
import { isSupportedAlgorithm } from './diagram-layout-algorithms.ts';
import { buildDiagramLayoutTree } from './diagram-layout-tree.ts';
import type { ShapeSchemeColorResolver } from './drawing-shape-projection.ts';
import { readOoxmlPart, type OoxmlElement } from './ooxml-tree.ts';

export interface DiagramSynthesisParts {
  readonly dataModel: OoxmlElement;
  readonly layoutDef: OoxmlElement;
  readonly styleDef: OoxmlElement | null;
  readonly colorsDef: OoxmlElement | null;
}

export interface DiagramSynthesisOptions {
  /** The theme's minor (body) Latin font, which diagram text uses by default. */
  readonly fontFamily?: string;
  readonly measurer?: DiagramTextMeasurer;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
}

/** Name the synthesized drawing reads under; it never enters the package. */
export const SYNTHESIZED_DRAWING_PART = '/word/diagrams/synthesized-drawing.xml';

/**
 * The drawing Office would save for these parts at this extent, or null when the layout is
 * outside the supported subset.
 */
export function synthesizeDiagramDrawing(
  parts: DiagramSynthesisParts,
  extent: Readonly<{ cx: number; cy: number }>,
  options: DiagramSynthesisOptions = {}
): OoxmlElement | null {
  if (!(extent.cx > 0) || !(extent.cy > 0)) return null;
  const model = readDiagramModel(parts.dataModel);
  if (!model) return null;
  const tree = buildDiagramLayoutTree(model, parts.layoutDef);
  if (!tree) return null;
  if (tree.nodes.some((node) => !isSupportedAlgorithm(node.algorithm.type))) return null;
  const solution = solveWithRules(tree, extent, {
    measurer: options.measurer ?? tableDiagramTextMeasurer,
    fontFamily: options.fontFamily ?? 'Calibri',
  });
  if (!solution) return null;
  const emitted = emitDiagramDrawing(
    solution,
    model,
    parts.styleDef,
    parts.colorsDef,
    options.resolveSchemeColor
  );
  if (!emitted || emitted.shapes.length === 0) return null;
  const read = readOoxmlPart(emitted.xml, {
    name: SYNTHESIZED_DRAWING_PART,
    contentType: 'application/vnd.ms-office.drawingml.diagramDrawing+xml',
  });
  return read.ok ? read.part.root : null;
}
