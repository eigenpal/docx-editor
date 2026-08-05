/**
 * `@docx-editor.dev/core/headless` — legacy document model seam for headless consumers
 * (notably `@docx-editor.dev/agents`). Projects the greenfield OOXML tree into the
 * structured body model agents mutate, and repacks against the original buffer.
 *
 * @packageDocumentation
 * @public
 */

export type * from './types.ts';
export {
  getRunText,
  getHyperlinkText,
  isHeadingStyle,
  parseHeadingLevel,
  mapHexToHighlightName,
  pointsToHalfPoints,
  halfPointsToPoints,
  makeRun,
} from './helpers.ts';
export {
  parseDocx,
  repackDocx,
  packageToLegacyDoc,
  createEmptyDocumentBody,
  HeadlessRepackRefusal,
  cloneDocumentPreservingContext,
} from './parse.ts';
export { headlessContextOf } from './context.ts';
export type { HeadlessCanonicalContext } from './context.ts';
export type { RevisionStory, RevisionIndex, RevisionIndexEntry } from './revision-bridge.ts';
export {
  recordResolution,
  peekResolutions,
  acknowledgeResolutions,
  drainResolutions,
  cloneResolutionLog,
} from './resolution-log.ts';
