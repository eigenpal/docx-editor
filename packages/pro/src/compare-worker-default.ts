/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Starts the packaged compare worker. This file sits next to `compare-worker.ts`, so the
 * relative URL names the worker both in the sources and in `dist/`, where the build writes the
 * `.js` name. Bundlers find and emit the worker from the `new Worker(new URL(...))` pattern,
 * which must stay literal.
 *
 * Throws where workers or module URLs do not exist (a server, a CommonJS build). The editor
 * then compares on the main thread, as it does for a worker that fails to start.
 */
export function startDefaultCompareWorker(): Worker {
  if (typeof Worker === 'undefined') throw new Error('Web workers are not available here.');
  return new Worker(new URL('./compare-worker.ts', import.meta.url), { type: 'module' });
}
