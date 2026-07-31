/** @spike-features one-schema-backed-docx-editor-command */
import Ajv2020 from 'ajv/dist/2020.js';
import type { DocxEditor } from '../driver/editor-driver';
import {
  collectValidation,
  readClosedDataObject,
  type ValidationSnapshot,
} from '../contracts/closed-input';
import vocabulary from '../../oracles/docx-editor-vocabulary.v1.json';
import manifest from '../../oracles/manifest.v1.json';
import yjsSchema from '../../oracles/yjs-schema.v1.json';
import bindingOracle from '../../oracles/binding-oracle.v1.json';
import scopeManifest from '../../oracles/scope-manifest.v1.json';

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(vocabulary as object);

const VOCAB_ID = vocabulary.$id as string;
const commandValidator = ajv.getSchema(`${VOCAB_ID}#/$defs/DocxEditor.Command`)!;
const queryValidator = ajv.getSchema(`${VOCAB_ID}#/$defs/DocxEditor.Query`)!;
if (!commandValidator || !queryValidator) {
  throw new Error('DocxEditor vocabulary schemas not registered');
}

const COMMAND_KEYS = {
  toggleMark: { required: ['type', 'mark'], optional: ['scope'] },
} as const;

const QUERY_KEYS = {
  findText: { required: ['type', 'text'], optional: ['scope'] },
  selectedText: { required: ['type'], optional: ['scope'] },
  selectionFormatting: { required: ['type'], optional: ['scope'] },
  selection: { required: ['type'], optional: ['scope'] },
} as const;

const BODY_SCOPE_KEYS = ['kind'] as const;

let lastErrors: string[] = [];

function closedKeys(
  input: object,
  required: readonly string[],
  optional: readonly string[]
): readonly string[] {
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = [...required];
  for (const key of optional) {
    if (Object.prototype.hasOwnProperty.call(descriptors, key)) keys.push(key);
  }
  return keys;
}

function readClosedDiscriminant(input: unknown, label: string): string {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(input, 'type');
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
    throw new TypeError(`${label} type must be a data field`);
  }
  const type = descriptor.value;
  if (typeof type !== 'string') throw new TypeError(`${label} type must be a string`);
  return type;
}

function snapshotBodyScope(input: unknown): DocxEditor.BodyScope {
  const scope = readClosedDataObject(input, BODY_SCOPE_KEYS, 'body scope');
  if (scope.kind !== 'body') throw new TypeError('invalid body scope kind');
  return Object.freeze({ kind: 'body' });
}

function snapshotOptionalBodyScope(input: unknown): DocxEditor.BodyScope | undefined {
  if (input === undefined) return undefined;
  return snapshotBodyScope(input);
}

function snapshotCommand(input: unknown): DocxEditor.Command {
  const type = readClosedDiscriminant(input, 'command');
  if (type !== 'toggleMark') throw new TypeError('unsupported command type');
  const shape = COMMAND_KEYS.toggleMark;
  const keys = closedKeys(input as object, shape.required, shape.optional);
  const record = readClosedDataObject(input, keys, 'command');
  if (record.type !== 'toggleMark') throw new TypeError('invalid command type');
  const scope = snapshotOptionalBodyScope(record.scope);
  const snapshot = Object.freeze({
    type: 'toggleMark' as const,
    mark: record.mark,
    ...(scope === undefined ? {} : { scope }),
  }) as DocxEditor.Command;
  return snapshot;
}

function snapshotQuery(input: unknown): DocxEditor.Query {
  const type = readClosedDiscriminant(input, 'query');
  if (!(type in QUERY_KEYS)) throw new TypeError('unsupported query type');
  const shape = QUERY_KEYS[type as keyof typeof QUERY_KEYS];
  const keys = closedKeys(input as object, shape.required, shape.optional);
  const record = readClosedDataObject(input, keys, 'query');
  const scope = snapshotOptionalBodyScope(record.scope);
  const withScope = scope === undefined ? {} : { scope };
  switch (type) {
    case 'findText':
      return Object.freeze({
        type: 'findText',
        text: record.text,
        ...withScope,
      }) as DocxEditor.Query;
    case 'selectedText':
      return Object.freeze({ type: 'selectedText', ...withScope }) as DocxEditor.Query;
    case 'selectionFormatting':
      return Object.freeze({ type: 'selectionFormatting', ...withScope }) as DocxEditor.Query;
    case 'selection':
      return Object.freeze({ type: 'selection', ...withScope }) as DocxEditor.Query;
    default:
      throw new TypeError('unsupported query type');
  }
}

function validateCommandSnapshot(snapshot: DocxEditor.Command): readonly string[] {
  try {
    if (!commandValidator(snapshot)) {
      return formatErrors(commandValidator.errors);
    }
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : 'invalid command'];
  }
}

function validateQuerySnapshot(snapshot: DocxEditor.Query): readonly string[] {
  try {
    if (!queryValidator(snapshot)) {
      return formatErrors(queryValidator.errors);
    }
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : 'invalid query'];
  }
}

export function snapshotAndValidateCommand(input: unknown): ValidationSnapshot<DocxEditor.Command> {
  const result = collectValidation(validateCommandSnapshot, () => snapshotCommand(input));
  if (result.errors.length > 0) {
    return { snapshot: null, errors: result.errors };
  }
  return result;
}

export function snapshotAndValidateQuery(input: unknown): ValidationSnapshot<DocxEditor.Query> {
  const result = collectValidation(validateQuerySnapshot, () => snapshotQuery(input));
  if (result.errors.length > 0) {
    return { snapshot: null, errors: result.errors };
  }
  return result;
}

export function validateCommand(payload: unknown): boolean {
  const result = snapshotAndValidateCommand(payload);
  lastErrors = [...result.errors];
  return result.errors.length === 0;
}

export function validateQuery(payload: unknown): boolean {
  const result = snapshotAndValidateQuery(payload);
  lastErrors = [...result.errors];
  return result.errors.length === 0;
}

export function getValidationErrors(): string[] {
  return lastErrors;
}

function formatErrors(errors: typeof commandValidator.errors): string[] {
  return (errors ?? []).map((error) => `${error.instancePath} ${error.message ?? ''}`.trim());
}

export function loadOracleManifest() {
  return manifest;
}

export function loadYjsSchemaOracle() {
  return yjsSchema;
}

export function loadBindingOracle() {
  return bindingOracle;
}

export function loadVocabularyOracle() {
  return vocabulary;
}

export function loadScopeManifest() {
  return scopeManifest;
}

export { vocabulary, manifest, yjsSchema, bindingOracle, scopeManifest };
