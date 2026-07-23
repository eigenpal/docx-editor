// Base capability registration + completeness (document-engine tasks 9.1, 9.6 /
// extensions-and-runtime-ports spec). An editable content capability MUST
// contribute every pipeline role needed for safe parse, edit, save, and output,
// or be rejected as incomplete. The base bundle registers the paragraph
// capability through the section-0 registry; distribution boundaries (9.6) keep
// this base free of PM/Yjs/transport/PDF (proven by the import-graph test).

import { resolve, type FeatureBundle, type Contribution, type ResolvedRegistry } from '../registry/index.ts';

/** Pipeline roles an editable content-type capability must contribute. */
export type PipelineRole = 'parse' | 'serialize' | 'command' | 'query';
export const REQUIRED_EDITABLE_ROLES: readonly PipelineRole[] = ['parse', 'serialize', 'command', 'query'];

export interface EditableCapability {
  readonly id: string;
  readonly roles: readonly PipelineRole[];
}

export type CompletenessResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly capability: string; readonly missing: readonly PipelineRole[] };

/** Reject an editable capability that omits any required pipeline role (task 9.1). */
export function checkEditableComplete(cap: EditableCapability): CompletenessResult {
  const have = new Set(cap.roles);
  const missing = REQUIRED_EDITABLE_ROLES.filter((r) => !have.has(r));
  return missing.length === 0 ? { ok: true } : { ok: false, capability: cap.id, missing };
}

const ROOT = 'dev.docx-editor.core';

/** The base paragraph capability — contributes every required role. */
export const PARAGRAPH_CAPABILITY: EditableCapability = {
  id: `${ROOT}.capability.paragraph`,
  roles: ['parse', 'serialize', 'command', 'query'],
};

/** The base feature bundle registered into the section-0 registry. */
export const BASE_BUNDLE: FeatureBundle = {
  id: `${ROOT}.bundle.base`,
  version: '1.0.0',
  contributions: [
    { kind: 'capability', id: PARAGRAPH_CAPABILITY.id, version: '1.0.0' },
    { kind: 'command', id: `${ROOT}.command.insert-text`, version: '1.0.0' },
    { kind: 'command', id: `${ROOT}.command.append-paragraph`, version: '1.0.0' },
    { kind: 'query', id: `${ROOT}.query.paragraph-text`, version: '1.0.0' },
  ] satisfies Contribution[],
};

/**
 * Build the base resolved registry and verify every editable capability is
 * complete. Rejects (throws) if a declared editable capability is missing a
 * required contribution — nothing half-registered.
 */
export function buildBaseRegistry(
  extra: readonly FeatureBundle[] = [],
  editableCapabilities: readonly EditableCapability[] = [PARAGRAPH_CAPABILITY],
): ResolvedRegistry {
  for (const cap of editableCapabilities) {
    const check = checkEditableComplete(cap);
    if (!check.ok) {
      throw new Error(`editable capability ${check.capability} incomplete: missing ${check.missing.join(', ')}`);
    }
  }
  return resolve([BASE_BUNDLE, ...extra]);
}
