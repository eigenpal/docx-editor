/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Field.result`: the field's cached result, as a `Word.Range`.
//
// A field is one character of its paragraph, so its result has no position a range could name.
// A result range is addressed by the field's handle instead (`ObjectPath.fieldResult`), and two
// of its members work: `text` reads the result, and `insertText(text, 'Replace')` writes it.
// Every other member reaches a span or a handle at sync, and the path refuses there with
// `NotImplemented` and `edit.field-result-unsupported` (`refuseFieldResultMember`).

import {
  fail,
  refuseFieldResultMember,
  type AutomationHandle,
  type AutomationOperation,
  type ObjectPath,
} from '../runtime/model-support.ts';
import { rangeTextLocation } from './locations.ts';

/** The field a result path names, read when the batch is planned. */
function fieldOf(path: ObjectPath): AutomationHandle {
  const address = path.address();
  if (address.kind !== 'fieldResult') fail({ code: 'InvalidObjectPath', target: path.label });
  return address.field;
}

/** The read behind `result.load('text')`. */
export function fieldResultRead(
  path: ObjectPath,
  projection: 'allMarkup' | 'original'
): () => AutomationOperation {
  return () => ({ op: 'getFieldResult', field: fieldOf(path), projection });
}

/**
 * The write behind `result.insertText(text, 'Replace')`, checked at the call. Other locations
 * have no position inside the result to insert at, and refuse.
 */
export function fieldResultWrite(
  path: ObjectPath,
  text: unknown,
  insertLocation: unknown,
  target: string
): () => AutomationOperation {
  if (rangeTextLocation(insertLocation, target) !== 'Replace') refuseFieldResultMember(target);
  // A result is one line of plain text: a break of any kind refuses here, with the same rule
  // the host gives other control characters.
  if (typeof text !== 'string' || /[\r\n\f\u2028\u2029]/.test(text))
    fail({ code: 'InvalidArgument', target, diagnostic: 'edit.invalid-argument' });
  const written = text;
  return () => ({ op: 'setFieldResult', field: fieldOf(path), text: written });
}
