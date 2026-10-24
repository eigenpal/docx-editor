/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * `@docx-editor.dev/pro/drawing` — charts and the SmartArt layout engine.
 *
 * The free engine paints pictures, shapes, text boxes, groups, canvases and every SmartArt
 * diagram saved with its drawing. This module adds charts, drawn from the values cached in
 * their chart parts, and lays out a SmartArt diagram saved without its drawing. Without it,
 * those drawings keep their labelled placeholders.
 *
 * The renderers serve every editor and export in the process. Install them before any
 * document opens.
 *
 * @example Enable charts and SmartArt layout in an editor
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

/**
 * Install the chart renderer and the SmartArt layout engine for every editor and export in
 * this process, without an editor module: for headless conversion. Installing again is
 * harmless.
 *
 * @public
 */
export function installDrawing(options: ProLicenseOptions = {}): void {
  rememberLicenseKey(options.licenseKey);
  installDrawingRenderers({ chart: projectChart, diagramLayout: synthesizeDiagramDrawing });
}

/**
 * The drawing module for `createDocxEditor({ modules })`. Creating it installs the chart
 * renderer and the SmartArt layout engine process-wide, as {@link installDrawing} does.
 *
 * @public
 */
export function drawingModule(options: ProLicenseOptions = {}): EditorModule {
  installDrawing(options);
  return Object.freeze({ id: 'drawing' });
}

export type { ProLicenseOptions } from '../license.ts';
