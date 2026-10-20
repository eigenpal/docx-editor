/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, expectTypeOf, test } from 'bun:test';
import { FieldType, InsertLocation, type Field, type InlinePicture, type Range } from '../index.ts';
import type { Field as BrowserField, InlinePicture as BrowserPicture } from '../browser.ts';

function supportedSource(range: Range): void {
  const picture = range.insertInlinePictureFromBase64('base64', InsertLocation.after);
  picture.width = 72;
  picture.height = 36;
  picture.lockAspectRatio = false;
  picture.altTextDescription = 'Logo';
  picture.delete();
  const field = range.insertField(InsertLocation.before, FieldType.page);
  field.code = 'NUMPAGES';
  field.updateResult();
  field.delete();
  range.insertField('After', 'Empty', 'PAGE', false);
  // These Office types compile but their unsupported runtime domains explicitly refuse.
  range.insertField('After', FieldType.date, '\\@ yyyy', true);
}

test('pictures and fields expose Office signatures through browser and server public entries', () => {
  expectTypeOf<BrowserField>().toEqualTypeOf<Field>();
  expectTypeOf<BrowserPicture>().toEqualTypeOf<InlinePicture>();
  expectTypeOf<Field['code']>().toEqualTypeOf<string>();
  expectTypeOf<Field['delete']>().toEqualTypeOf<() => void>();
  expectTypeOf<Field['updateResult']>().toEqualTypeOf<() => void>();
  expectTypeOf<Range['insertInlinePictureFromBase64']>().toEqualTypeOf<
    (
      base64EncodedImage: string,
      insertLocation: InsertLocation | 'Before' | 'After' | 'Start' | 'End' | 'Replace'
    ) => InlinePicture
  >();
  expect(typeof supportedSource).toBe('function');
});
