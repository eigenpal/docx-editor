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
 * - charts, drawn from the values cached in their chart parts;
 * - the layout of a SmartArt diagram saved without its drawing;
 * - shape and picture effects: glow, inner shadow, reflection, soft edge, and the rim of a
 *   dark-edged bevel;
 * - WordArt: VML text paths outside a watermark, laid along arches, triangles and the other
 *   text path shapes, with gradient fills, shadows and 3-D extrusion;
 * - EMF and WMF pictures: a vector replay for PDF export and a raster in the browser editor.
 *
 * Without it, a chart, an unlaid diagram, a WordArt drawing and a metafile picture keep their
 * labelled placeholders, and a shape paints without those effects.
 *
 * The renderers serve every editor and export in the process. Install them before any
 * document opens. The metafile replay and `emf-converter` load on first use, only when a
 * document holds a metafile picture.
 *
 * Contract for the effects and text art readers: OOXML is read into a typed model
 * (`effects-model.ts`, `text-art-model.ts`), and the model is projected for paint
 * (`effects-projection.ts`, `text-art-projection.ts`). Model fields map one to one to OOXML
 * attributes and keep the canonical node id of the element they come from, so an editor can
 * change a field and write it back with a tree op. The readers are pure functions and the
 * models hold no paint state.
 *
 * @example Enable advanced drawing rendering in an editor
 * ```ts
 * import { drawingModule } from '@docx-editor.dev/pro/drawing';
 *
 * const editor = createDocxEditor({ document: bytes, modules: [drawingModule()] });
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
 * conversion. Installing again is harmless.
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
