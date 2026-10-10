/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Reading a host answer as the shape the action expected.
//
// A batch answer is a union — a handle, handles, text, or "applied" — and an action knows which
// one its operation produces. These four helpers are where that expectation is checked instead
// of assumed. A cast would put a `text` answer into a proxy expecting a handle and only fail
// later, somewhere that has nothing to do with the cause; `GeneralException` here fails at the
// exchange that actually disagreed.

import type {
  AutomationFontRead,
  AutomationHandle,
  AutomationPageSetupRead,
  AutomationParagraphFormatRead,
  AutomationSpan,
  AutomationValue,
} from '@docx-editor.dev/core/automation';
import { DocxEditorError } from './errors.ts';

function wrongShape(target: string): DocxEditorError {
  return new DocxEditorError({ code: 'GeneralException', target });
}

export function hydratedText(value: AutomationValue, target: string): string {
  if (value.kind !== 'text') throw wrongShape(target);
  return value.text;
}

export function hydratedHandle(value: AutomationValue, target: string): AutomationHandle {
  if (value.kind !== 'handle') throw wrongShape(target);
  return value.handle;
}

export function hydratedHandles(
  value: AutomationValue,
  target: string
): readonly AutomationHandle[] {
  if (value.kind !== 'handles') throw wrongShape(target);
  return value.handles;
}

export function hydratedSpan(value: AutomationValue, target: string): AutomationSpan {
  if (value.kind !== 'span') throw wrongShape(target);
  return value.span;
}

export function hydratedSpans(value: AutomationValue, target: string): readonly AutomationSpan[] {
  if (value.kind !== 'spans') throw wrongShape(target);
  return value.spans;
}

export function hydratedFont(value: AutomationValue, target: string): AutomationFontRead {
  if (value.kind !== 'font') throw wrongShape(target);
  return value.font;
}

export function hydratedParagraphFormat(
  value: AutomationValue,
  target: string
): AutomationParagraphFormatRead {
  if (value.kind !== 'paragraphFormat') throw wrongShape(target);
  return value.format;
}

/** A paragraph style name, or null where nothing names one. */
export function hydratedStyle(value: AutomationValue, target: string): string | null {
  if (value.kind !== 'style') throw wrongShape(target);
  return value.name;
}

/** A number the document states: a list's id, a list item's level, a page dimension. */
export function hydratedNumber(value: AutomationValue, target: string): number {
  if (value.kind !== 'number') throw wrongShape(target);
  return value.value;
}

/** A yes-or-no the document states: whether a comment thread is resolved. */
export function hydratedFlag(value: AutomationValue, target: string): boolean {
  if (value.kind !== 'flag') throw wrongShape(target);
  return value.value;
}

/** One section's page geometry, in points. */
export function hydratedPageSetup(value: AutomationValue, target: string): AutomationPageSetupRead {
  if (value.kind !== 'pageSetup') throw wrongShape(target);
  return value.setup;
}

/** A command's answer. There is nothing in it: the effect is the batch having committed. */
export function hydratedApplied(value: AutomationValue, target: string): void {
  if (value.kind !== 'applied') throw wrongShape(target);
}
