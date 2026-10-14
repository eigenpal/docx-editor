/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

declare const process: { env: Record<string, string | undefined> };

/**
 * `NODE_ENV`, written as the literal `process.env.NODE_ENV` so bundlers replace it in browser
 * builds. Without a bundler and without `process`, it is undefined.
 */
export function nodeEnv(): string | undefined {
  try {
    return process.env.NODE_ENV;
  } catch {
    return undefined;
  }
}
