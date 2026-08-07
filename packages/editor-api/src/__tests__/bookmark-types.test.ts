/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expectTypeOf, test } from 'bun:test';
import type {
  Body as BrowserBody,
  BookmarkCollection as BrowserBookmarkCollection,
} from '../browser.ts';
import type {
  Body as ServerBody,
  BookmarkCollection as ServerBookmarkCollection,
  Document,
} from '../index.ts';

test('both public entries expose bookmarks on one story body, not on the document', () => {
  expectTypeOf<BrowserBody>().toEqualTypeOf<ServerBody>();
  expectTypeOf<BrowserBookmarkCollection>().toEqualTypeOf<ServerBookmarkCollection>();
  expectTypeOf<ServerBody['bookmarks']>().toEqualTypeOf<ServerBookmarkCollection>();
  expectTypeOf<'bookmarks' extends keyof Document ? true : false>().toEqualTypeOf<false>();
});
