/** @spike-features insert-delete-split-join-operations, local-backend */
import type { DocOpSingle } from '../../contracts/doc-op';
import { createDocumentModel } from '../../model/fixture';
import type { DocumentModel } from '../../model/types';
import { fingerprintAuthoredModel } from '../../model/fingerprint';
import {
  cloneDraft,
  draftFromAuthored,
  draftToAuthoredPackage,
} from '../draft';
import {
  BatchValidationError,
  createMutationTrace,
  normalizeDraft,
  validateAndStageBatch,
} from '../mutate';
import type { OperationEnvironment } from '../operation-environment';
import type { MutableDraft } from '../draft';
import type { MutationTrace } from '../mutate';

export interface InternalStagedMutation {
  readonly baseRevision: number;
  readonly revisionAfter: number;
  readonly beforeDraft: MutableDraft;
  readonly stagedDraft: MutableDraft;
  readonly normalizedDraft: MutableDraft;
  readonly trace: MutationTrace;
  readonly stagingEnv: OperationEnvironment;
  readonly stagedModel: DocumentModel;
  readonly baseFingerprint: string;
  readonly stagedFingerprint: string;
  readonly appliedRepair: boolean;
}

export type InternalStageResult =
  | { readonly status: 'staged'; readonly data: InternalStagedMutation }
  | { readonly status: 'noOp'; readonly reason: string }
  | { readonly status: 'failed'; readonly code: string; readonly message: string };

export function stageSemanticMutation(
  model: DocumentModel,
  env: OperationEnvironment,
  ops: readonly DocOpSingle[],
  identityRestoration: readonly import('../history/types').IdentityTombstone[] = []
): InternalStageResult {
  const beforeFingerprint = fingerprintAuthoredModel(model);
  const beforeDraft = draftFromAuthored(model.authored);
  const trace = createMutationTrace();
  try {
    const stagedDraft = cloneDraft(beforeDraft);
    const stagingEnv = validateAndStageBatch(stagedDraft, ops, env, trace, identityRestoration);
    const normalized = normalizeDraft(stagedDraft, trace);
    const afterAuthored = draftToAuthoredPackage(normalized.draft);
    const unchangedModel = createDocumentModel(afterAuthored, model.revision);
    if (fingerprintAuthoredModel(unchangedModel) === beforeFingerprint) {
      return Object.freeze({
        status: 'noOp',
        reason: 'batch makes no semantic change',
      });
    }
    const stagedModel = createDocumentModel(afterAuthored, model.revision + 1);
    const stagedFingerprint = fingerprintAuthoredModel(stagedModel);
    const data: InternalStagedMutation = {
      baseRevision: model.revision,
      revisionAfter: model.revision + 1,
      beforeDraft,
      stagedDraft: cloneDraft(stagedDraft),
      normalizedDraft: normalized.draft,
      trace,
      stagingEnv,
      stagedModel,
      baseFingerprint: beforeFingerprint,
      stagedFingerprint,
      appliedRepair: normalized.appliedRepair,
    };
    return Object.freeze({ status: 'staged', data });
  } catch (error) {
    if (error instanceof BatchValidationError) {
      return Object.freeze({
        status: 'failed',
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }
}
