/** @spike-features one-schema-backed-docx-editor-command, insert-delete-split-join-operations */
export { isRangeFullyMarked, type MarkKind } from './mark-range';
export {
  planSemanticCommand,
  type SemanticCommandContext,
  type SemanticCommandPlan,
  type SemanticCommandTransaction,
} from './semantic-command';
export {
  executeCommandOnServer,
  executeDocOpOnServer,
  type ServerExecutionContext,
} from './server-execution';
