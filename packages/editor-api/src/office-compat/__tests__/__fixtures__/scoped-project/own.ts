/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The project's own file: one type error, and imports of files the project does not include.
import { fromDependency } from './dependency';
import { hostTyped } from './host-typed';

export const ownError: string = 1;
export const used: number = fromDependency;
export const alsoUsed = hostTyped;
