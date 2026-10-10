/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expectTypeOf, test } from 'bun:test';
import type { NoteItem as BrowserNoteItem } from '../browser.ts';
import type { NoteItem as ServerNoteItem } from '../index.ts';

test('both public entries expose read-only note text', () => {
  expectTypeOf<BrowserNoteItem>().toEqualTypeOf<ServerNoteItem>();
  expectTypeOf<ServerNoteItem['text']>().toEqualTypeOf<string>();
  expectTypeOf<ServerNoteItem['body']['text']>().toEqualTypeOf<string>();
});
