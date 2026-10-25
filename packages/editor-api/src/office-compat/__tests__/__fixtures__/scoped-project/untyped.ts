/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A project with no host types anywhere: `process` resolves to nothing, or only to an ambient
// declaration, and counts either way.
import { fromDependency } from './dependency';

declare const Buffer: { from(text: string): unknown };

export const reached = fromDependency;
export const ambient = Buffer.from('x');
