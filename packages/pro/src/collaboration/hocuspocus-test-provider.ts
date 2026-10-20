/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * Test-only provider factory key for `createHocuspocusCollaboration`. No package entry
 * exports this module.
 *
 * @internal
 */
export const HOCUSPOCUS_PROVIDER_FOR_TESTS: unique symbol = Symbol(
  'createHocuspocusCollaboration.provider'
);
