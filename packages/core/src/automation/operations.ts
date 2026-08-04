// The initial typed operation vocabulary.
//
// Deliberately small. This is the slice that has to prove the whole architecture end to end
// — name the document, walk its body, read a paragraph, write into one at an offset — and
// every one of those crosses the full path from the protocol down to
// `TreeDocumentStore.transact` and back. Anything that does not add a new KIND of crossing
// (a second read shape, a second command shape) is a later addition to this union rather
// than a reason to widen the protocol.
//
// Text addressing is the engine's own vocabulary and nothing else: a paragraph's stable
// identity plus a UTF-16 model offset. That is what the tree ops take, what selection uses
// and what the layout reports, so an automation write lands exactly where a typed one would.

import type { AutomationHandle } from './protocol.ts';

export type AutomationOperation =
  /** The document itself — the root every other handle is reached through. */
  | { readonly op: 'getDocument' }
  /** The main story of a document. */
  | { readonly op: 'getBody'; readonly document: AutomationHandle }
  /** The body's paragraphs, in document order. */
  | { readonly op: 'getParagraphs'; readonly body: AutomationHandle }
  /** Text of a body or a paragraph. A body reads as its paragraphs joined by newlines. */
  | { readonly op: 'getText'; readonly target: AutomationHandle }
  /**
   * Insert text into a paragraph at a UTF-16 model offset.
   *
   * Offsets in one batch are validated against the state at the start of the batch, but the
   * commands apply in order INSIDE one transaction — so two inserts into the same paragraph
   * shift each other exactly as two sequential edits would. Addressing distinct paragraphs
   * keeps a batch order-independent.
   */
  | {
      readonly op: 'insertText';
      readonly paragraph: AutomationHandle;
      readonly offset: number;
      readonly text: string;
    };

export type AutomationOperationKind = AutomationOperation['op'];

/** Operations that read. They never open a transaction. */
export const AUTOMATION_QUERY_OPERATIONS = [
  'getDocument',
  'getBody',
  'getParagraphs',
  'getText',
] as const satisfies readonly AutomationOperationKind[];

/** Operations that write. Every one of these goes through the single transaction path. */
export const AUTOMATION_COMMAND_OPERATIONS = [
  'insertText',
] as const satisfies readonly AutomationOperationKind[];

const COMMANDS: ReadonlySet<string> = new Set(AUTOMATION_COMMAND_OPERATIONS);

/** Whether an operation writes. Drives the query/command split inside one batch. */
export function isAutomationCommand(operation: AutomationOperation): boolean {
  return COMMANDS.has(operation.op);
}
