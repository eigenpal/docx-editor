/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review module installs the drawing renderers, so a host that registers it needs no
// separate drawing module.

import { expect, test } from 'bun:test';
import { drawingRenderers } from '../../../core/src/store/package/drawing-renderers.ts';
import { reviewModule } from '../index.ts';

test('the review module installs the drawing renderers', () => {
  reviewModule();
  const installed = drawingRenderers();
  expect(installed.chart).toBeFunction();
  expect(installed.diagramLayout).toBeFunction();
  expect(installed.effects).toBeDefined();
  expect(installed.metafile).toBeDefined();
});
