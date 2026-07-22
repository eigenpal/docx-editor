/** @spike-features one-schema-backed-docx-editor-command, bold-mark */
import type { DocOp, DocOpSingle } from '../contracts/doc-op';
import { createDocOpBatch } from '../contracts/doc-op';
import type { DocxEditor } from '../driver/editor-driver';
import { resolveAuthoredParagraphByBlockId } from '../model/block-id-index';
import type { DocumentModel } from '../model/types';
import { isValidUtf16Range } from '../store/utf16';
import { snapshotAndValidateCommand } from '../vocabulary/validate';
import { isRangeFullyMarked } from './mark-range';

export interface SemanticCommandContext {
  readonly storyId: string;
  readonly selection: DocxEditor.DocRange | null;
  readonly model: DocumentModel;
}

export interface SemanticCommandPlan {
  readonly result: DocxEditor.CommandResult;
  readonly docOp: DocOp | null;
}

export interface SemanticCommandTransaction {
  readonly actorId: string;
  readonly sessionId: string;
  readonly groupId: string;
  readonly constituentId: string;
}

export function planSemanticCommand(
  commandInput: unknown,
  context: SemanticCommandContext,
  transaction: SemanticCommandTransaction
): SemanticCommandPlan {
  const commandValidation = snapshotAndValidateCommand(commandInput);
  if (commandValidation.errors.length > 0 || !commandValidation.snapshot) {
    return {
      result: Object.freeze({
        status: 'failed',
        code: 'invalid-command',
        reason: 'command payload failed schema validation',
      }),
      docOp: null,
    };
  }
  const command = commandValidation.snapshot;

  if (command.type !== 'toggleMark') {
    return {
      result: Object.freeze({
        status: 'failed',
        code: 'unsupported-command',
        reason: 'command type is not supported by the spike handler',
      }),
      docOp: null,
    };
  }

  const selection = context.selection;
  if (!selection || selection.start >= selection.end) {
    return {
      result: Object.freeze({
        status: 'noOp',
        changed: false,
        reason: 'empty selection',
      }),
      docOp: null,
    };
  }

  if (selection.storyId !== context.storyId) {
    return {
      result: Object.freeze({
        status: 'failed',
        code: 'invalid-selection',
        reason: 'selection story does not match execution context',
      }),
      docOp: null,
    };
  }

  const paragraph = resolveAuthoredParagraphByBlockId(
    context.model.authored.body,
    selection.blockId
  );
  if (!paragraph) {
    return {
      result: Object.freeze({
        status: 'failed',
        code: 'invalid-selection',
        reason: 'selection does not resolve to a body paragraph',
      }),
      docOp: null,
    };
  }

  if (!isValidUtf16Range(paragraph.text, selection.start, selection.end)) {
    return {
      result: Object.freeze({
        status: 'failed',
        code: 'invalid-selection',
        reason: 'selection range is out of paragraph bounds',
      }),
      docOp: null,
    };
  }

  const enabled = !isRangeFullyMarked(paragraph, command.mark, selection.start, selection.end);
  const op: DocOpSingle = {
    kind: 'setMark',
    storyId: selection.storyId,
    blockId: selection.blockId,
    mark: command.mark,
    start: selection.start,
    end: selection.end,
    enabled,
  };

  const docOp = createDocOpBatch({
    ops: [op],
    transaction: {
      actorId: transaction.actorId,
      sessionId: transaction.sessionId,
      groupId: transaction.groupId,
      constituentIds: [transaction.constituentId],
    },
  });

  return {
    result: Object.freeze({
      status: 'applied',
      changed: true,
    }),
    docOp,
  };
}
