/** @spike-features one-body-story, paragraphs, text, bold-mark, italic-mark, stable-paragraph-ids, one-preservation-capsule, synthetic-128-paragraph-fixture */
import { buildBlockIdIndex, registerCanonicalBodyIndex } from './block-id-index';
import { freezeAuthoredProperties } from './authored-property';
import type { AuthoredProperty } from './authored-property';
import type {
  AuthoredBodyStory,
  AuthoredMark,
  AuthoredPackageModel,
  AuthoredPackageModelInput,
  AuthoredParagraph,
  ImmutableLookup,
  UnsupportedCapsule,
} from './types';

const TRUSTED_LOOKUPS = new WeakSet<object>();
const TRUSTED_CAPSULES = new WeakSet<object>();

export function copyBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}

export function readClosedDataObject(
  value: unknown,
  expectedKeys: readonly string[],
  label: string
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== 'string') ||
    !sameKeys(keys as string[], expectedKeys)
  ) {
    throw new TypeError(`invalid ${label} fields`);
  }
  const result: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} accessor fields are forbidden`);
    }
    Object.defineProperty(result, key, {
      value: descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

export function snapshotDenseArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor)) {
    throw new TypeError(`${label} has invalid length`);
  }
  const length = lengthDescriptor.value as number;
  const expectedKeys = Array.from({ length }, (_, index) => String(index));
  const elementKeys = Reflect.ownKeys(descriptors).filter((key) => key !== 'length');
  if (
    elementKeys.some((key) => typeof key !== 'string') ||
    !sameKeys(elementKeys as string[], expectedKeys)
  ) {
    throw new TypeError(`${label} must be dense without extra keys`);
  }
  return expectedKeys.map((key) => {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} accessor elements are forbidden`);
    }
    return descriptor.value;
  });
}

export function snapshotBytes(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) {
    throw new TypeError(`${label} must be a Uint8Array`);
  }
  return Uint8Array.prototype.slice.call(value);
}

export function createImmutableLookup<K, V>(
  entries: Iterable<readonly [K, V]>
): ImmutableLookup<K, V> {
  const backing = new Map<K, V>(entries);
  const lookup = {
    get size() {
      return backing.size;
    },
    get(key: K) {
      return backing.get(key);
    },
    has(key: K) {
      return backing.has(key);
    },
    entries() {
      return backing.entries();
    },
    keys() {
      return backing.keys();
    },
    values() {
      return backing.values();
    },
    [Symbol.iterator]() {
      return backing[Symbol.iterator]();
    },
  };
  TRUSTED_LOOKUPS.add(lookup);
  return Object.freeze(lookup);
}

export function snapshotLookupEntries<K, V>(
  value: unknown,
  label: string
): Array<readonly [K, V]> {
  let iterator: Iterator<readonly [K, V]>;
  let size: number;
  if (value instanceof Map && Object.getPrototypeOf(value) === Map.prototype) {
    iterator = Map.prototype.entries.call(value) as MapIterator<[K, V]>;
    size = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!.call(value) as number;
  } else if (value !== null && typeof value === 'object' && TRUSTED_LOOKUPS.has(value)) {
    const trusted = value as ImmutableLookup<K, V>;
    iterator = trusted[Symbol.iterator]();
    size = trusted.size;
  } else {
    throw new TypeError(`${label} must be a native Map or trusted immutable lookup`);
  }
  const entries: Array<readonly [K, V]> = [];
  const keys = new Set<K>();
  for (let next = iterator.next(); !next.done; next = iterator.next()) {
    const entry = next.value;
    if (!Array.isArray(entry) || entry.length !== 2 || keys.has(entry[0])) {
      throw new TypeError(`${label} iteration is inconsistent`);
    }
    keys.add(entry[0]);
    entries.push([entry[0], entry[1]]);
  }
  if (entries.length !== size) throw new TypeError(`${label} size is inconsistent`);
  return entries;
}

export function freezeMark(mark: AuthoredMark): AuthoredMark {
  return Object.freeze({ ...mark });
}

export function freezeParagraph(paragraph: AuthoredParagraph): AuthoredParagraph {
  return Object.freeze({
    ...paragraph,
    marks: Object.freeze(paragraph.marks.map(freezeMark)),
    authoredProperties: freezeAuthoredProperties(paragraph.authoredProperties),
  });
}

export function freezeCapsule(capsule: UnsupportedCapsule): UnsupportedCapsule {
  const bytes = copyBytes(capsule.bytes);
  const previousSiblingBytes = copyBytes(capsule.previousSiblingBytes);
  const nextSiblingBytes = copyBytes(capsule.nextSiblingBytes);
  const frozenCapsule = {
    capsuleId: capsule.capsuleId,
    ownerStoryId: capsule.ownerStoryId,
    ownerBlockId: capsule.ownerBlockId,
    childIndex: capsule.childIndex,
    byteBoundaryStart: capsule.byteBoundaryStart,
    byteBoundaryEnd: capsule.byteBoundaryEnd,
    get bytes() {
      return copyBytes(bytes);
    },
    namespaceBindings: Object.freeze({ ...capsule.namespaceBindings }),
    get previousSiblingBytes() {
      return copyBytes(previousSiblingBytes);
    },
    get nextSiblingBytes() {
      return copyBytes(nextSiblingBytes);
    },
  };
  TRUSTED_CAPSULES.add(frozenCapsule);
  return Object.freeze(frozenCapsule);
}

export function freezeAuthoredPackage(authored: AuthoredPackageModelInput): AuthoredPackageModel {
  const paragraphs: Array<readonly [string, AuthoredParagraph]> = [];
  for (const [paragraphId, paragraph] of authored.body.paragraphs) {
    paragraphs.push([paragraphId, freezeParagraph(paragraph)]);
  }
  const paragraphLookup = createImmutableLookup(paragraphs);
  const body: AuthoredBodyStory = Object.freeze({
    storyId: authored.body.storyId,
    paragraphOrder: Object.freeze([...authored.body.paragraphOrder]),
    paragraphs: paragraphLookup,
  });
  registerCanonicalBodyIndex(
    body,
    buildBlockIdIndex(authored.body.paragraphOrder, paragraphLookup)
  );
  return Object.freeze({
    body,
    capsules: Object.freeze(authored.capsules.map(freezeCapsule)),
  });
}

export function snapshotAuthoredPackage(input: unknown): AuthoredPackageModelInput {
  const authored = readClosedDataObject(input, ['body', 'capsules'], 'authored package');
  const bodyInput = readClosedBodyStory(authored.body);
  const paragraphOrder = snapshotDenseArray(bodyInput.paragraphOrder, 'paragraph order');
  const paragraphEntries = snapshotLookupEntries<string, unknown>(
    bodyInput.paragraphs,
    'paragraph lookup'
  );
  const paragraphs: Array<readonly [string, AuthoredParagraph]> = paragraphEntries.map(
    ([lookupKey, paragraphInput]) => {
      const paragraph = readClosedDataObject(
        paragraphInput,
        ['blockId', 'paragraphId', 'text', 'styleId', 'marks', 'authoredProperties'],
        'paragraph'
      );
      const marks = snapshotDenseArray(paragraph.marks, 'paragraph marks').map((markInput) => {
        const mark = readClosedDataObject(
          markInput,
          ['markId', 'kind', 'start', 'end'],
          'authored mark'
        );
        return {
          markId: mark.markId,
          kind: mark.kind,
          start: mark.start,
          end: mark.end,
        } as AuthoredMark;
      });
      const propertyInput = paragraph.authoredProperties;
      if (
        propertyInput === null ||
        typeof propertyInput !== 'object' ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(propertyInput))
      ) {
        throw new TypeError('authored properties must be a plain object');
      }
      const properties: Record<string, AuthoredProperty> = {};
      for (const key of Reflect.ownKeys(propertyInput)) {
        if (typeof key !== 'string') throw new TypeError('invalid authored property fields');
        const descriptor = Object.getOwnPropertyDescriptor(propertyInput, key)!;
        if (!descriptor.enumerable || !('value' in descriptor)) {
          throw new TypeError('authored property accessor fields are forbidden');
        }
        const property = readClosedProperty(descriptor.value);
        Object.defineProperty(properties, key, {
          value: property,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return [
        lookupKey,
        {
          blockId: paragraph.blockId,
          paragraphId: paragraph.paragraphId,
          text: paragraph.text,
          styleId: paragraph.styleId,
          marks,
          authoredProperties: properties,
        } as AuthoredParagraph,
      ];
    }
  );
  const capsules = snapshotDenseArray(authored.capsules, 'capsules').map((capsuleInput) => {
    const capsule =
      capsuleInput !== null &&
      typeof capsuleInput === 'object' &&
      TRUSTED_CAPSULES.has(capsuleInput)
        ? {
            capsuleId: (capsuleInput as UnsupportedCapsule).capsuleId,
            ownerStoryId: (capsuleInput as UnsupportedCapsule).ownerStoryId,
            ownerBlockId: (capsuleInput as UnsupportedCapsule).ownerBlockId,
            childIndex: (capsuleInput as UnsupportedCapsule).childIndex,
            byteBoundaryStart: (capsuleInput as UnsupportedCapsule).byteBoundaryStart,
            byteBoundaryEnd: (capsuleInput as UnsupportedCapsule).byteBoundaryEnd,
            bytes: (capsuleInput as UnsupportedCapsule).bytes,
            namespaceBindings: (capsuleInput as UnsupportedCapsule).namespaceBindings,
            previousSiblingBytes: (capsuleInput as UnsupportedCapsule).previousSiblingBytes,
            nextSiblingBytes: (capsuleInput as UnsupportedCapsule).nextSiblingBytes,
          }
        : readClosedDataObject(
            capsuleInput,
            [
              'capsuleId',
              'ownerStoryId',
              'ownerBlockId',
              'childIndex',
              'byteBoundaryStart',
              'byteBoundaryEnd',
              'bytes',
              'namespaceBindings',
              'previousSiblingBytes',
              'nextSiblingBytes',
            ],
            'capsule'
          );
    const namespaceInput = capsule.namespaceBindings;
    if (
      namespaceInput === null ||
      typeof namespaceInput !== 'object' ||
      Object.getPrototypeOf(namespaceInput) !== Object.prototype
    ) {
      throw new TypeError('capsule namespaces must be a plain object');
    }
    const namespaceBindings: Record<string, string> = {};
    for (const key of Reflect.ownKeys(namespaceInput)) {
      if (typeof key !== 'string') throw new TypeError('invalid capsule namespace fields');
      const descriptor = Object.getOwnPropertyDescriptor(namespaceInput, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError('capsule namespace accessor fields are forbidden');
      }
      namespaceBindings[key] = descriptor.value as string;
    }
    return {
      capsuleId: capsule.capsuleId,
      ownerStoryId: capsule.ownerStoryId,
      ownerBlockId: capsule.ownerBlockId,
      childIndex: capsule.childIndex,
      byteBoundaryStart: capsule.byteBoundaryStart,
      byteBoundaryEnd: capsule.byteBoundaryEnd,
      bytes: snapshotBytes(capsule.bytes, 'capsule bytes'),
      namespaceBindings,
      previousSiblingBytes: snapshotBytes(
        capsule.previousSiblingBytes,
        'capsule previous sibling bytes'
      ),
      nextSiblingBytes: snapshotBytes(capsule.nextSiblingBytes, 'capsule next sibling bytes'),
    } as UnsupportedCapsule;
  });
  return {
    body: {
      storyId: bodyInput.storyId as string,
      paragraphOrder: paragraphOrder as string[],
      paragraphs: createImmutableLookup(paragraphs),
    },
    capsules,
  };
}

function readClosedProperty(value: unknown): AuthoredProperty {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('authored property must be a plain object');
  }
  const stateDescriptor = Object.getOwnPropertyDescriptor(value, 'state');
  if (!stateDescriptor || !('value' in stateDescriptor)) {
    throw new TypeError('authored property accessor fields are forbidden');
  }
  const expected =
    stateDescriptor.value === 'omitted'
      ? ['state']
      : stateDescriptor.value === 'raw'
        ? ['state', 'rawLexical']
        : ['state', 'value'];
  return readClosedDataObject(value, expected, 'authored property') as AuthoredProperty;
}

function readClosedBodyStory(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Object.getPrototypeOf(body) !== Object.prototype) {
    throw new TypeError('body story must be a plain object');
  }
  const withoutIndex = ['paragraphOrder', 'paragraphs', 'storyId'];
  return readClosedDataObject(body, withoutIndex, 'body story');
}

function sameKeys(actual: readonly string[], expected: readonly string[]): boolean {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return (
    sortedActual.length === sortedExpected.length &&
    sortedActual.every((key, index) => key === sortedExpected[index])
  );
}
