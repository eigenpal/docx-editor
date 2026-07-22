/** @spike-features one-annotation-anchor */
import yjsSchema from '../../oracles/yjs-schema.v1.json';
import {
  collectValidation,
  copyBytes,
  isPlainRecord,
  readClosedDataObject,
  snapshotBytes,
  type ValidationSnapshot,
} from './closed-input';
import { validateSpikeId } from './ids';

export const INTERNAL_ANCHOR_VERSION = yjsSchema.anchorEnvelope.version;

export type AnchorAffinity = 'before' | 'after';

export interface InternalAnchorEnvelope {
  readonly version: typeof INTERNAL_ANCHOR_VERSION;
  readonly documentId: string;
  readonly backendVersion: string;
  readonly schemaVersion: string;
  readonly checkpoint: string;
  readonly affinity: AnchorAffinity;
  readonly relativeBytes: Uint8Array;
}

export function createInternalAnchorEnvelope(input: {
  documentId: string;
  backendVersion: string;
  schemaVersion: string;
  checkpoint: string;
  affinity: AnchorAffinity;
  relativeBytes: Uint8Array;
}): InternalAnchorEnvelope {
  const value = readClosedDataObject(
    input,
    ['documentId', 'backendVersion', 'schemaVersion', 'checkpoint', 'affinity', 'relativeBytes'],
    'internal anchor factory input'
  );
  return createValidatedInternalAnchor(value);
}

function createTrustedInternalAnchor(input: {
  documentId: string;
  backendVersion: string;
  schemaVersion: string;
  checkpoint: string;
  affinity: AnchorAffinity;
  relativeBytes: Uint8Array;
}): InternalAnchorEnvelope {
  const relativeBytes = copyBytes(input.relativeBytes);
  const envelope = Object.freeze({
    version: INTERNAL_ANCHOR_VERSION,
    documentId: input.documentId,
    backendVersion: input.backendVersion,
    schemaVersion: input.schemaVersion,
    checkpoint: input.checkpoint,
    affinity: input.affinity,
    get relativeBytes() {
      return copyBytes(relativeBytes);
    },
  });
  TRUSTED_INTERNAL_ANCHORS.add(envelope);
  return envelope;
}

const TRUSTED_INTERNAL_ANCHORS = new WeakSet<object>();

export function snapshotAndValidateInternalAnchorEnvelope(
  input: unknown
): ValidationSnapshot<InternalAnchorEnvelope> {
  if (isInternalAnchorEnvelope(input)) {
    return { snapshot: input, errors: validateTrustedInternalAnchorEnvelope(input) };
  }
  return collectValidation(validateTrustedInternalAnchorEnvelope, () =>
    snapshotInternalAnchorEnvelope(input)
  );
}

function snapshotInternalAnchorEnvelope(input: unknown): InternalAnchorEnvelope {
  const envelope = readClosedDataObject(
    input,
    [
      'version',
      'documentId',
      'backendVersion',
      'schemaVersion',
      'checkpoint',
      'affinity',
      'relativeBytes',
    ],
    'internal anchor envelope'
  );
  if (envelope.version !== INTERNAL_ANCHOR_VERSION) {
    throw new TypeError('invalid internal anchor envelope version');
  }
  return createValidatedInternalAnchor(envelope);
}

function createValidatedInternalAnchor(
  envelope: Record<string, unknown>
): InternalAnchorEnvelope {
  const trusted = createTrustedInternalAnchor({
    documentId: envelope.documentId as string,
    backendVersion: envelope.backendVersion as string,
    schemaVersion: envelope.schemaVersion as string,
    checkpoint: envelope.checkpoint as string,
    affinity: envelope.affinity as AnchorAffinity,
    relativeBytes: snapshotBytes(envelope.relativeBytes, 'anchor relative bytes'),
  });
  const errors = validateTrustedInternalAnchorEnvelope(trusted);
  if (errors.length > 0) throw new TypeError(`invalid internal anchor: ${errors.join('; ')}`);
  return trusted;
}

function validateTrustedInternalAnchorEnvelope(anchor: InternalAnchorEnvelope): readonly string[] {
  const errors: string[] = [];
  if (!TRUSTED_INTERNAL_ANCHORS.has(anchor)) errors.push('untrusted internal anchor envelope');
  if (anchor.version !== INTERNAL_ANCHOR_VERSION) errors.push('invalid anchor envelope version');
  errors.push(validateSpikeId(anchor.documentId, 'documentId') ?? '');
  if (typeof anchor.backendVersion !== 'string' || anchor.backendVersion.length === 0) {
    errors.push('invalid backendVersion');
  }
  if (typeof anchor.schemaVersion !== 'string' || anchor.schemaVersion.length === 0) {
    errors.push('invalid schemaVersion');
  }
  if (typeof anchor.checkpoint !== 'string' || anchor.checkpoint.length === 0) {
    errors.push('invalid checkpoint');
  }
  if (anchor.affinity !== 'before' && anchor.affinity !== 'after') errors.push('invalid affinity');
  if (!(anchor.relativeBytes instanceof Uint8Array)) errors.push('anchor relativeBytes must be Uint8Array');
  return errors.filter(Boolean);
}

export function internalAnchorTrustedFieldsMatchOracle(): readonly string[] {
  return [...yjsSchema.anchorEnvelope.trustedFields].sort();
}

function isInternalAnchorEnvelope(value: unknown): value is InternalAnchorEnvelope {
  return isPlainRecord(value) && TRUSTED_INTERNAL_ANCHORS.has(value);
}
