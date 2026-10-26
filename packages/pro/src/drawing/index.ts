/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * `@docx-editor.dev/pro/drawing` — advanced drawing rendering.
 *
 * The free engine paints pictures, shapes with fills, gradients, patterns, lines and outer
 * shadows, text boxes, groups, canvases, text watermarks, and every SmartArt diagram saved
 * with its drawing. This module adds:
 *
 * - charts, drawn from the values cached in their chart parts. Treemap, sunburst and map
 *   charts, and charts that mix a pie or radar plot with other plot types, do not render;
 * - the layout of a SmartArt diagram saved without its drawing;
 * - shape and picture effects: glow, inner shadow, reflection, soft edge, and the rim of a
 *   dark-edged bevel;
 * - WordArt: VML text paths outside a watermark, fitted to the shape, between two guides, or
 *   along an arch, with gradient fills, shadows and 3-D extrusion;
 * - EMF and WMF pictures: a vector replay for PDF export, and a browser raster that honors a
 *   metafile's own drawing origin.
 *
 * Without it, or for a chart it does not render, a chart saved with a fallback picture or
 * drawing shows that fallback. In every state a chart selects as an object: picture commands
 * are refused, and deleting it removes the chart with its fallback, as one tracked deletion
 * of the whole chart when change tracking is on. Copy and cut of a selection that includes a
 * chart are refused. The editor shows a labeled placeholder for other visible charts with
 * usable bounds, including a skipped `mc:Choice` with an empty `mc:Fallback`, and a diagram
 * saved without its drawing, and inline WordArt; floating WordArt does not show. The editor still rasterizes
 * EMF and WMF pictures, and a shape paints without those effects. PDF export always includes
 * this module.
 *
 * The renderers serve every editor and export in the process. Install them before any
 * document opens; a later install logs a console warning once. `reviewModule()` installs them
 * too. The metafile replay and `emf-converter` load on first use, only when a document holds a
 * metafile picture.
 *
 * @example Enable advanced drawing rendering in an editor
 * ```ts
 * import { createDocxEditor } from '@docx-editor.dev/core/editor';
 * import { drawingModule } from '@docx-editor.dev/pro/drawing';
 *
 * // Next.js; with Vite, read import.meta.env.VITE_DOCX_LICENSE.
 * const modules = [drawingModule({ licenseKey: process.env.NEXT_PUBLIC_DOCX_LICENSE })];
 * const editor = createDocxEditor({ document: bytes, modules });
 * ```
 *
 * @packageDocumentation
 * @public
 */

import { installDrawingRenderers } from '@docx-editor.dev/core/store';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import { rememberLicenseKey, type ProLicenseOptions } from '../license.ts';
import { projectChart } from './chart-projection.ts';
import { synthesizeDiagramDrawing } from './diagram-layout-synthesis.ts';
import { drawingEffectsRenderer } from './effects-projection.ts';
import { metafileRenderer } from './metafile-renderer.ts';
import { textArtLayout } from './text-art-layout.ts';
import { legacyTextArtRenderer } from './text-art-projection.ts';

/**
 * Install the drawing renderers (charts, SmartArt layout, effects, WordArt, and metafiles) for
 * every editor and export in this process, without an editor module: for headless
 * conversion. Installing again is harmless. A host without the EigenPal Pro License leaves
 * this call out; its charts then show their fallback pictures or drawings, or placeholders.
 *
 * @public
 */
export function installDrawing(options: ProLicenseOptions = {}): void {
  rememberLicenseKey(options.licenseKey);
  installDrawingRenderers({
    chart: projectChart,
    diagramLayout: synthesizeDiagramDrawing,
    effects: drawingEffectsRenderer,
    legacyTextArt: legacyTextArtRenderer,
    textArtLayout,
    metafile: metafileRenderer,
  });
}

/**
 * The drawing module for `createDocxEditor({ modules })`. Creating it installs the drawing
 * renderers process-wide, as {@link installDrawing} does.
 *
 * @public
 */
export function drawingModule(options: ProLicenseOptions = {}): EditorModule {
  installDrawing(options);
  return Object.freeze({ id: 'drawing' });
}

export type { ProLicenseOptions } from '../license.ts';
