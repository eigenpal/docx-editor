/** @spike-features fixture-comparators, one-preservation-capsule */
import { compareXmlPartRange, type XmlOwnershipEvidence } from './xml-part-range';

export interface ZipEntryMeta {
  readonly path: string;
  readonly crc32?: number;
  readonly compressedSize?: number;
  readonly uncompressedSize?: number;
  readonly offset?: number;
  readonly compressionMethod?: number;
  readonly directoryIndex?: number;
  readonly lastModifiedIso?: string;
}

export interface SemanticZipDiff {
  readonly path: string;
  readonly kind: 'metadata-only' | 'payload';
  readonly details: string;
}

export const ALLOWED_ZIP_METADATA_FIELDS = [
  'crc32',
  'compressedSize',
  'uncompressedSize',
  'offset',
  'compressionMethod',
  'directoryIndex',
] as const satisfies readonly (keyof Omit<ZipEntryMeta, 'path'>)[];
const ZIP_METADATA_SCHEMA_KEYS = [
  'path',
  'crc32',
  'compressedSize',
  'uncompressedSize',
  'offset',
  'compressionMethod',
  'directoryIndex',
  'lastModifiedIso',
] as const;

/**
 * Allows recompression metadata changes while capsule, namespace, sibling position,
 * and unowned XML bytes remain exact.
 */
export function compareSemanticZip(
  beforeEntries: ReadonlyMap<string, { meta: ZipEntryMeta; bytes: Uint8Array }>,
  afterEntries: ReadonlyMap<string, { meta: ZipEntryMeta; bytes: Uint8Array }>,
  options: {
    readonly ownedXmlParts?: Readonly<
      Record<
        string,
        {
          readonly ownedRangeStart: number;
          readonly ownedRangeEnd: number;
          readonly evidence: {
            readonly before: XmlOwnershipEvidence;
            readonly after: XmlOwnershipEvidence;
          };
        }
      >
    >;
  }
): { equal: boolean; diffs: readonly SemanticZipDiff[] } {
  const diffs: SemanticZipDiff[] = [];
  const allowedMetadata = new Set<keyof Omit<ZipEntryMeta, 'path'>>(ALLOWED_ZIP_METADATA_FIELDS);
  const paths = new Set([...beforeEntries.keys(), ...afterEntries.keys()]);
  for (const path of paths) {
    const b = beforeEntries.get(path);
    const a = afterEntries.get(path);
    if (!b || !a) {
      diffs.push({ path, kind: 'payload', details: 'missing entry' });
      continue;
    }
    if (!(b.bytes instanceof Uint8Array) || !(a.bytes instanceof Uint8Array)) {
      diffs.push({ path, kind: 'payload', details: 'payload must be Uint8Array' });
      continue;
    }
    const metadataErrors = [
      ...validateMetadata(path, b.meta, 'before'),
      ...validateMetadata(path, a.meta, 'after'),
    ];
    if (metadataErrors.length > 0) {
      diffs.push({ path, kind: 'payload', details: metadataErrors.join('; ') });
    }
    const metadataDiff = differingMetadataFields(b.meta, a.meta);
    const disallowedMetadata = metadataDiff.filter((field) => !allowedMetadata.has(field));
    if (disallowedMetadata.length > 0) {
      diffs.push({
        path,
        kind: 'payload',
        details: `disallowed metadata changed: ${disallowedMetadata.join(',')}`,
      });
    }
    if (!bytesEqual(b.bytes, a.bytes)) {
      const owned = options.ownedXmlParts?.[path];
      const payloadAllowed =
        owned !== undefined &&
        compareXmlPartRange(
          b.bytes,
          a.bytes,
          owned.ownedRangeStart,
          owned.ownedRangeEnd,
          owned.evidence
        ).equal;
      diffs.push({
        path,
        kind: payloadAllowed ? 'metadata-only' : 'payload',
        details: payloadAllowed ? 'externally validated owned payload changed' : 'payload changed',
      });
    } else if (metadataDiff.length > 0 && disallowedMetadata.length === 0) {
      diffs.push({ path, kind: 'metadata-only', details: metadataDiff.join(',') });
    }
  }
  const blocking = diffs.filter((d) => d.kind === 'payload');
  return { equal: blocking.length === 0, diffs };
}

function differingMetadataFields(
  before: ZipEntryMeta,
  after: ZipEntryMeta
): (keyof Omit<ZipEntryMeta, 'path'>)[] {
  const fields: (keyof Omit<ZipEntryMeta, 'path'>)[] = [
    'crc32',
    'compressedSize',
    'uncompressedSize',
    'offset',
    'compressionMethod',
    'directoryIndex',
    'lastModifiedIso',
  ];
  return fields.filter((field) => before[field] !== after[field]);
}

function validateMetadata(entryPath: string, meta: ZipEntryMeta, side: string): string[] {
  const errors: string[] = [];
  if (Object.getPrototypeOf(meta) !== Object.prototype) {
    errors.push(`${side} metadata prototype invalid`);
    return errors;
  }
  const keys = Reflect.ownKeys(meta);
  if (
    keys.some((key) => typeof key !== 'string' || !ZIP_METADATA_SCHEMA_KEYS.includes(key as never))
  ) {
    errors.push(`${side} metadata has unknown key`);
  }
  if (meta.path !== entryPath) errors.push(`${side} metadata path does not match entry key`);
  for (const field of ALLOWED_ZIP_METADATA_FIELDS) {
    const value = meta[field];
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      errors.push(`${side} metadata ${field} must be a nonnegative integer`);
    }
  }
  if (meta.lastModifiedIso !== undefined && typeof meta.lastModifiedIso !== 'string') {
    errors.push(`${side} metadata lastModifiedIso must be a string`);
  }
  return errors;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const SEMANTIC_ZIP_COMPARATOR_VERSION = '4.0.0';
