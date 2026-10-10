/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expectTypeOf, test } from 'bun:test';
import type { ContentControl as BrowserContentControl } from '../browser.ts';
import type { ContentControl as ServerContentControl } from '../index.ts';

test('both public entries expose binding presence as a read-only boolean', () => {
  expectTypeOf<BrowserContentControl>().toEqualTypeOf<ServerContentControl>();
  expectTypeOf<ServerContentControl['isBound']>().toEqualTypeOf<boolean>();
  expectTypeOf<Pick<ServerContentControl, 'isBound'>>().toEqualTypeOf<{
    readonly isBound: boolean;
  }>();
});
