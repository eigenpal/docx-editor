/** @spike-features awareness-metadata, origin-metadata */
import yjsSchema from '../../oracles/yjs-schema.v1.json';
import {
  collectValidation,
  isNonNegativeSafeInteger,
  isPlainRecord,
  isUnsafeKey,
  readClosedDataObject,
  type ValidationSnapshot,
} from './closed-input';
import { validateSpikeId } from './ids';

export const AWARENESS_STATE_VERSION = 'awareness-state/1';

export interface AwarenessPresence {
  readonly status: 'active' | 'idle';
}

export interface AwarenessSelectionEphemeral {
  readonly blockId: string;
  readonly offset: number;
}

export interface AwarenessState {
  readonly version: typeof AWARENESS_STATE_VERSION;
  readonly actorId: string;
  readonly sessionId: string;
  readonly presence: AwarenessPresence;
  readonly selectionEphemeral: AwarenessSelectionEphemeral | null;
}

export function createAwarenessState(input: {
  actorId: string;
  sessionId: string;
  presence: AwarenessPresence;
  selectionEphemeral: AwarenessSelectionEphemeral | null;
}): AwarenessState {
  const state = readClosedDataObject(
    input,
    ['actorId', 'sessionId', 'presence', 'selectionEphemeral'],
    'awareness state factory input'
  );
  const presence = readClosedDataObject(state.presence, ['status'], 'awareness presence');
  const selection =
    state.selectionEphemeral === null
      ? null
      : readClosedDataObject(
          state.selectionEphemeral,
          ['blockId', 'offset'],
          'awareness selection'
        );
  const awareness = Object.freeze({
    version: AWARENESS_STATE_VERSION,
    actorId: state.actorId as string,
    sessionId: state.sessionId as string,
    presence: Object.freeze({ status: presence.status as AwarenessPresence['status'] }),
    selectionEphemeral:
      selection === null
        ? null
        : Object.freeze({
            blockId: selection.blockId as string,
            offset: selection.offset as number,
          }),
  });
  const errors = validateTrustedAwarenessState(awareness);
  if (errors.length > 0) throw new TypeError(`invalid awareness state: ${errors.join('; ')}`);
  return awareness;
}

export function snapshotAndValidateAwarenessState(input: unknown): ValidationSnapshot<AwarenessState> {
  return collectValidation(validateTrustedAwarenessState, () => snapshotAwarenessState(input));
}

function snapshotAwarenessState(input: unknown): AwarenessState {
  const state = readClosedDataObject(
    input,
    ['version', 'actorId', 'sessionId', 'presence', 'selectionEphemeral'],
    'awareness state'
  );
  if (state.version !== AWARENESS_STATE_VERSION) throw new TypeError('invalid awareness state version');
  const presenceInput = readClosedDataObject(state.presence, ['status'], 'awareness presence');
  const selectionEphemeral =
    state.selectionEphemeral === null
      ? null
      : readClosedDataObject(state.selectionEphemeral, ['blockId', 'offset'], 'awareness selection');
  return createAwarenessState({
    actorId: state.actorId as string,
    sessionId: state.sessionId as string,
    presence: { status: presenceInput.status as AwarenessPresence['status'] },
    selectionEphemeral:
      selectionEphemeral === null
        ? null
        : {
            blockId: selectionEphemeral.blockId as string,
            offset: selectionEphemeral.offset as number,
          },
  });
}

function validateTrustedAwarenessState(state: AwarenessState): readonly string[] {
  const errors: string[] = [];
  if (state.version !== AWARENESS_STATE_VERSION) errors.push('invalid awareness state version');
  errors.push(
    validateSpikeId(state.actorId, 'awareness actorId') ?? '',
    validateSpikeId(state.sessionId, 'awareness sessionId') ?? ''
  );
  if (state.presence.status !== 'active' && state.presence.status !== 'idle') {
    errors.push('invalid awareness presence status');
  }
  if (state.selectionEphemeral) {
    errors.push(
      validateSpikeId(state.selectionEphemeral.blockId, 'selection blockId') ?? '',
      isNonNegativeSafeInteger(state.selectionEphemeral.offset)
        ? ''
        : 'invalid selection offset'
    );
  }
  return errors.filter(Boolean);
}

const EXCLUDED_AWARENESS_KEYS = [
  'awareness',
  'awarenessState',
  'selectionEphemeral',
  'presence',
] as const;
const MAX_AWARENESS_SCAN_ARRAY_LENGTH = 10_000;

export function assertAwarenessExcludedFromAuthoredPayload(payload: unknown): void {
  walkPayload(payload, new WeakSet<object>());
}

function walkPayload(value: unknown, visited: WeakSet<object>): void {
  if (value === null || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new TypeError('awareness exclusion payload must contain only arrays and plain objects');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (
      !isNonNegativeSafeInteger(length) ||
      length > MAX_AWARENESS_SCAN_ARRAY_LENGTH
    ) {
      throw new TypeError('awareness exclusion rejects invalid arrays');
    }
    const expected = new Set(Array.from({ length }, (_, index) => String(index)));
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !expected.delete(key)) {
        throw new TypeError('awareness exclusion rejects sparse or extended arrays');
      }
    }
    if (expected.size > 0) throw new TypeError('awareness exclusion rejects sparse arrays');
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string' || isUnsafeKey(key)) {
      throw new TypeError('awareness exclusion rejects unsafe fields');
    }
    if (EXCLUDED_AWARENESS_KEYS.includes(key as (typeof EXCLUDED_AWARENESS_KEYS)[number])) {
      throw new Error(`awareness metadata must not appear in authored payload key: ${key}`);
    }
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('awareness exclusion rejects hidden or accessor fields');
    }
    walkPayload(descriptor.value, visited);
  }
}

export function awarenessOriginTagsMatchOracle(): boolean {
  return (
    yjsSchema.originTags.awareness.includes('presence') &&
    yjsSchema.originTags.awareness.includes('selection-ephemeral')
  );
}
