/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Licensing, v1: honor system.
 *
 * The key is accepted and remembered so that adding offline (Ed25519)
 * verification later is not a breaking change — but nothing validates it,
 * nothing warns, nothing renders differently, and NOTHING EVER LEAVES THE
 * PROCESS: no network request is made for licensing, ever. That last property
 * is a spec requirement (`pro-licensing`), not an implementation detail.
 */

/** Accepted by every pro entry point. */
export interface ProLicenseOptions {
  /**
   * Your license key from docx-editor.dev. Optional in v1: unlicensed use in
   * development and evaluation is permitted, production use requires a
   * license (see LICENSE.md) — the package trusts you either way.
   */
  readonly licenseKey?: string;
}

let storedKey: string | undefined;

/** Remember the most recent key an entry point was constructed with. */
export function rememberLicenseKey(key: string | undefined): void {
  if (key !== undefined) storedKey = key;
}

/** The remembered key, for future verification and support diagnostics. */
export function currentLicenseKey(): string | undefined {
  return storedKey;
}
