/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expectTypeOf, test } from 'bun:test';
import type { Font as BrowserFont } from '../browser.ts';
import type { Font as ServerFont } from '../index.ts';

test('both public entries expose nullable font reads and non-nullable writes', () => {
  expectTypeOf<BrowserFont>().toEqualTypeOf<ServerFont>();
  expectTypeOf<ServerFont['bold']>().toEqualTypeOf<boolean | null>();
  expectTypeOf<ServerFont['italic']>().toEqualTypeOf<boolean | null>();
  expectTypeOf<ServerFont['color']>().toEqualTypeOf<string | null>();
  expectTypeOf<ServerFont['name']>().toEqualTypeOf<string | null>();
  expectTypeOf<ServerFont['size']>().toEqualTypeOf<number | null>();

  const font = {} as ServerFont;
  font.bold = true;
  font.italic = false;
  font.color = '#112233';
  font.name = 'Georgia';
  font.size = 12;

  // @ts-expect-error Null describes a read with no agreed authored value; it is not writable.
  font.bold = null;
  // @ts-expect-error Null describes a read with no agreed authored value; it is not writable.
  font.italic = null;
  // @ts-expect-error Null describes a read with no agreed authored value; it is not writable.
  font.color = null;
  // @ts-expect-error Null describes a read with no agreed authored value; it is not writable.
  font.name = null;
  // @ts-expect-error Null describes a read with no agreed authored value; it is not writable.
  font.size = null;
});
