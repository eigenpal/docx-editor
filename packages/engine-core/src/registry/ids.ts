// Stable identifier grammar for the capability/runtime registry
// (document-engine task 0.1). Every extension, capability, command, query,
// schema, dependency key, runtime port, result, and origin uses a globally
// stable ID in one of two forms:
//
//   - reverse-domain:  dev.docx-editor.core.command.insert-text
//   - package-owned:   @docx-editor.dev/engine-core#command/insert-text
//
// IDs are opaque strings once validated; the registry never selects by
// registration order, so the ID (plus version) is the sole identity.

export const ID_KINDS = [
  'extension',
  'capability',
  'command',
  'query',
  'schema',
  'dependencyKey',
  'runtimePort',
  'result',
  'origin',
] as const;

export type IdKind = (typeof ID_KINDS)[number];

// A dotted reverse-domain of two or more lowercase alphanumeric/hyphen labels.
const REVERSE_DOMAIN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
// A package-owned id: an npm scope/name (dots allowed, e.g. @docx-editor.dev)
// with an optional `#segment/segment` path.
const PACKAGE_OWNED = /^@[a-z0-9.-]+\/[a-z0-9.-]+(?:#[a-z0-9]+(?:[/._-][a-z0-9]+)*)?$/;

export function isValidId(id: string): boolean {
  return REVERSE_DOMAIN.test(id) || PACKAGE_OWNED.test(id);
}

export function assertValidId(id: string, kind?: IdKind): void {
  if (!isValidId(id)) {
    throw new Error(
      `invalid ${kind ?? 'registry'} id ${JSON.stringify(id)}: ` +
        `must be reverse-domain (dev.docx-editor.core.x) or package-owned (@scope/pkg#kind/name)`,
    );
  }
}

/** A validated (kind, id, version) triple — the registry's unit of identity. */
export interface CapabilityId {
  readonly kind: IdKind;
  readonly id: string;
  readonly version: string;
}
