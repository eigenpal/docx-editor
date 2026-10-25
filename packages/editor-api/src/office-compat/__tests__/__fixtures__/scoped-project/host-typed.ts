/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/// <reference types="bun" />
// Server-runtime types in the program, as a dependency's own types can bring them: `process`
// now resolves, to a host type package, and still counts as a host global.

export const hostTyped = process.env;
