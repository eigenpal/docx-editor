// Reading a host answer as the shape the action expected.
//
// A batch answer is a union — a handle, handles, text, or "applied" — and an action knows which
// one its operation produces. These four helpers are where that expectation is checked instead
// of assumed. A cast would put a `text` answer into a proxy expecting a handle and only fail
// later, somewhere that has nothing to do with the cause; `GeneralException` here fails at the
// exchange that actually disagreed.

import type {
  AutomationHandle,
  AutomationSpan,
  AutomationValue,
} from '@docx-editor.dev/core-contract/automation';
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

export function hydratedSpans(
  value: AutomationValue,
  target: string
): readonly AutomationSpan[] {
  if (value.kind !== 'spans') throw wrongShape(target);
  return value.spans;
}

/** A command's answer. There is nothing in it: the effect is the batch having committed. */
export function hydratedApplied(value: AutomationValue, target: string): void {
  if (value.kind !== 'applied') throw wrongShape(target);
}
