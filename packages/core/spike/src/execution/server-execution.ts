/** @spike-features insert-delete-split-join-operations, one-schema-backed-docx-editor-command, origin-metadata, bold-mark */
import { isDocOp, snapshotAndValidateDocOp } from '../contracts/doc-op';
import type { DocxEditor } from '../driver/editor-driver';
import {
  createMutationOrigin,
  snapshotAndValidateMutationOrigin,
  type MutationOrigin,
} from '../contracts/origins';
import type { ApplyResult } from '../store/apply-result';
import type { SemanticDocumentStore } from '../store/document-store';
import { snapshotAndValidateCommand } from '../vocabulary/validate';
import { planSemanticCommand } from './semantic-command';

export interface ServerExecutionContext {
  readonly store: SemanticDocumentStore;
  readonly actorId: string;
  readonly sessionId: string;
  readonly groupId: string;
  readonly selection: DocxEditor.DocRange | null;
  readonly originKind?: 'agent' | 'human';
  readonly storyId?: string;
  readonly nextConstituentSeq?: number;
}

export function executeDocOpOnServer(
  context: ServerExecutionContext,
  input: unknown,
  originInput: unknown
): ApplyResult {
  const originSnapshot = snapshotAndValidateMutationOrigin(originInput);
  if (originSnapshot.errors.length > 0 || !originSnapshot.snapshot) {
    return failedApply('invalid-origin', 'server DocOp requires closed mutation origin');
  }

  if (!isDocOp(input)) {
    return failedApply('untrusted-doc-op', 'DocOp batch is not trusted');
  }
  const trusted = snapshotAndValidateDocOp(input);
  if (trusted.errors.length > 0 || !trusted.snapshot) {
    return failedApply('untrusted-doc-op', 'DocOp batch is not trusted');
  }
  return context.store.apply(trusted.snapshot, originSnapshot.snapshot);
}

export function executeCommandOnServer(
  context: ServerExecutionContext,
  input: unknown
): DocxEditor.CommandResult {
  const commandValidation = snapshotAndValidateCommand(input);
  if (commandValidation.errors.length > 0 || !commandValidation.snapshot) {
    return Object.freeze({
      status: 'failed',
      code: 'invalid-command',
      reason: 'command payload failed schema validation',
    });
  }

  const command = commandValidation.snapshot;
  const constituentId = `op-server-${context.nextConstituentSeq ?? context.store.model.revision + 1}`;
  const plan = planSemanticCommand(
    command,
    {
      storyId: context.storyId ?? 'story-body-0',
      selection: context.selection,
      model: context.store.model,
    },
    {
      actorId: context.actorId,
      sessionId: context.sessionId,
      groupId: context.groupId,
      constituentId,
    }
  );

  if (plan.result.status !== 'applied' || !plan.docOp) {
    return plan.result;
  }

  const originKind = context.originKind ?? 'agent';
  const origin: MutationOrigin = createMutationOrigin(originKind, {
    actorId: context.actorId,
    sessionId: context.sessionId,
  });
  const applyResult = executeDocOpOnServer(context, plan.docOp, origin);
  if (applyResult.status === 'failed') {
    return Object.freeze({
      status: 'failed',
      code: applyResult.code,
      reason: applyResult.reason,
    });
  }
  if (applyResult.status === 'noOp') {
    return Object.freeze({
      status: 'noOp',
      changed: false,
      reason: applyResult.reason,
    });
  }

  return plan.result;
}

function failedApply(code: string, reason: string): ApplyResult {
  return Object.freeze({ status: 'failed', code, reason });
}
