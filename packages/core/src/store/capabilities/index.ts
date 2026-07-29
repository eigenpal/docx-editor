// Base capability registration + completeness (document-engine tasks 9.1, 9.6 /
// extensions-and-runtime-ports spec). An editable content capability MUST
// contribute every pipeline role needed for safe parse, edit, save, and output,
// or be rejected as incomplete. The base bundle registers the paragraph
// capability through the section-0 registry; distribution boundaries (9.6) keep
// this base free of PM/Yjs/transport/PDF (proven by the import-graph test).

import {
  resolve,
  type FeatureBundle,
  type Contribution,
  type ResolvedRegistry,
} from '../registry/index.ts';
import {
  registeredBlockKinds,
  isTopLevelEditable,
  blockCapabilityHas,
  blockSemanticOps,
  hasAnyBlockParser,
  kindHasParser,
  blockRegistryVersion,
  type BlockKind,
  type CoreBlockCapability,
} from '../model/index.ts';
import { DOC_OP_KINDS } from '../store/contracts.ts';

const VALID_DOC_OPS: ReadonlySet<string> = new Set(DOC_OP_KINDS);

/** Pipeline roles an editable content-type capability must contribute. */
export type PipelineRole = 'parse' | 'serialize' | 'command' | 'query';
export const REQUIRED_EDITABLE_ROLES: readonly PipelineRole[] = [
  'parse',
  'serialize',
  'command',
  'query',
];

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
  editableCapabilities: readonly EditableCapability[] = [PARAGRAPH_CAPABILITY]
): ResolvedRegistry {
  for (const cap of editableCapabilities) {
    const check = checkEditableComplete(cap);
    if (!check.ok) {
      throw new Error(
        `editable capability ${check.capability} incomplete: missing ${check.missing.join(', ')}`
      );
    }
  }
  return resolve([BASE_BUNDLE, ...extra]);
}

// ---- Connect the versioned FeatureBundle registry to the ACTUAL runtime block-capability handlers
// at document open (document-engine 9.1-9.3 / comprehensive 3.9). The block-capability registry
// (model) holds the real handlers; here we (a) reject a half-registered EDITABLE kind, and (b)
// resolve() a FeatureBundle mirroring the registered kinds through the versioned registry, so a
// duplicate/cyclic/version-incompatible declaration fails before any document is published.

/** Core kind-keyed ops an EDITABLE block kind MUST register (parse is validated globally). */
const REQUIRED_EDITABLE_BLOCK_OPS: readonly (keyof CoreBlockCapability)[] = [
  'hashContent',
  'normalize',
  'serialize',
  'patchEdited',
  'editPolicy',
];

/** Reject a half-registered editable capability: an editable block kind missing a real handler,
 *  preservation, serialization, or semantic operations (comprehensive 3.9). A read-only kind needs
 *  only its preservation ops, so it is not required to be editable-complete. */
export function assertCoreBlockRegistryComplete(): void {
  if (!hasAnyBlockParser())
    throw new Error('core registry incomplete: no block element parser is registered');
  for (const kind of registeredBlockKinds()) {
    if (!isTopLevelEditable(kind)) continue;
    const missing: string[] = REQUIRED_EDITABLE_BLOCK_OPS.filter(
      (op) => !blockCapabilityHas(kind, op)
    );
    if (!kindHasParser(kind)) missing.push('parse'); // an editable kind must have its OWN parse lane
    const ops = blockSemanticOps(kind);
    // semanticOps must be non-empty AND name REAL DocOps (not arbitrary strings).
    if (ops.length === 0) missing.push('semanticOps');
    else {
      const bogus = ops.filter((op) => !VALID_DOC_OPS.has(op));
      if (bogus.length > 0) missing.push(`semanticOps(unknown: ${bogus.join(',')})`);
    }
    if (missing.length > 0)
      throw new Error(`editable block kind '${kind}' incomplete: missing ${missing.join(', ')}`);
  }
}

const CAPABILITY_ID = (kind: BlockKind): string => `${ROOT}.capability.block-${kind}`;

let cachedCoreRegistry: ResolvedRegistry | undefined;
let cachedAtVersion = -1;

/** Resolve the core registry AT DOCUMENT OPEN: verify editable completeness, then resolve a bundle
 *  that mirrors the registered block kinds through the versioned FeatureBundle registry (validating
 *  ids/versions/duplicates/cycles). Cached, but keyed on the registry's version, so a registration
 *  AFTER an open re-validates (a stale cache never masks a newly incomplete editable kind). */
export function resolveCoreRegistry(): ResolvedRegistry {
  const version = blockRegistryVersion();
  if (cachedCoreRegistry && cachedAtVersion === version) return cachedCoreRegistry;
  assertCoreBlockRegistryComplete();
  const blockContributions: Contribution[] = registeredBlockKinds().map((kind) => ({
    kind: 'capability',
    id: CAPABILITY_ID(kind),
    version: '1.0.0',
  }));
  const bundle: FeatureBundle = {
    id: `${ROOT}.bundle.core-blocks`,
    version: '1.0.0',
    contributions: [...BASE_BUNDLE.contributions, ...blockContributions],
  };
  cachedCoreRegistry = resolve([bundle]);
  cachedAtVersion = version;
  return cachedCoreRegistry;
}

/** Test seam: forget the memoized core registry so a re-registration is re-validated. */
export function resetCoreRegistryCache(): void {
  cachedCoreRegistry = undefined;
  cachedAtVersion = -1;
}
