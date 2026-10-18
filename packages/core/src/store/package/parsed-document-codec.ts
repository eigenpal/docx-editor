// The wire form of a package read on another thread.
//
// A read package is a graph of plain objects, arrays, maps, strings and byte arrays. The
// browser's structured clone can carry it, but at a price paid on the RECEIVING thread: every
// one of a long document's ~600k objects is rebuilt natively, every repeated string (a
// namespace URI on each element) arrives as its own copy, and the frozen state the reader gave
// the trees is lost. This codec writes the same graph as one integer stream, a table of
// distinct strings and a table of object shapes, so the receiver rebuilds it with one pass of
// ordinary object creation — the strings shared, the key order kept, and each object frozen
// exactly when the read froze it.
//
// It is GENERIC on purpose: it records what the reader produced rather than knowing what the
// reader produces, so a field added to a node later travels without a change here. A value it
// cannot represent (a function, a class instance, a symbol) makes the encoder throw, because
// a read that does not round-trip exactly must not be offered as one.

/** The value kinds in the stream; an object or array tag may carry the two flags below. */
const TAG_UNDEFINED = 0;
const TAG_NULL = 1;
const TAG_TRUE = 2;
const TAG_FALSE = 3;
const TAG_STRING = 4;
const TAG_NUMBER = 5;
const TAG_REFERENCE = 6;
const TAG_BYTES = 7;
const TAG_MAP = 8;
const TAG_ARRAY = 9;
const TAG_OBJECT = 10;
const TAG_MASK = 0x0f;
/** The container was frozen when it was written. */
const FLAG_FROZEN = 0x10;
/** The object had no prototype. */
const FLAG_NULL_PROTOTYPE = 0x20;

/** A value graph written by {@link encodeValueGraph}. Every member crosses `postMessage`. */
export interface EncodedValueGraph {
  /** Tags and operands, in depth-first order. */
  readonly ops: Int32Array;
  /** Each distinct string once, by first use. */
  readonly strings: readonly string[];
  /** Each distinct object key list once, by first use. */
  readonly shapes: readonly (readonly string[])[];
  readonly numbers: readonly number[];
  /** The byte arrays, by first use: the buffers a sender can transfer. */
  readonly bytes: readonly Uint8Array[];
}

/** Why a value cannot be written. A read that produces one is a defect, not a file property. */
export class UnencodableValueError extends Error {}

/** Why a stream cannot be read: it was not written by this codec, or not completely. */
class MalformedGraphError extends Error {}

interface ShapeNode {
  id: number;
  readonly next: Map<string, ShapeNode>;
}

/** Write a value graph. Shared objects stay shared; frozen containers stay frozen. */
export function encodeValueGraph(value: unknown): EncodedValueGraph {
  let ops = new Int32Array(1 << 16);
  let length = 0;
  const push = (op: number): void => {
    if (length === ops.length) {
      const grown = new Int32Array(ops.length * 2);
      grown.set(ops);
      ops = grown;
    }
    ops[length++] = op;
  };
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const shapes: string[][] = [];
  const shapeRoot: ShapeNode = { id: -1, next: new Map() };
  const numbers: number[] = [];
  const bytes: Uint8Array[] = [];
  const seen = new Map<object, number>();

  const stringId = (text: string): number => {
    let id = stringIndex.get(text);
    if (id === undefined) {
      id = strings.length;
      strings.push(text);
      stringIndex.set(text, id);
    }
    return id;
  };
  const shapeId = (keys: string[]): number => {
    let node = shapeRoot;
    for (const key of keys) {
      let next = node.next.get(key);
      if (!next) {
        next = { id: -1, next: new Map() };
        node.next.set(key, next);
      }
      node = next;
    }
    if (node.id < 0) {
      node.id = shapes.length;
      shapes.push(keys);
    }
    return node.id;
  };
  const containerFlags = (container: object): number => {
    if (Object.isFrozen(container)) return FLAG_FROZEN;
    if (!Object.isExtensible(container)) {
      throw new UnencodableValueError('a sealed or non-extensible container cannot be written');
    }
    return 0;
  };

  const write = (item: unknown): void => {
    switch (typeof item) {
      case 'undefined':
        push(TAG_UNDEFINED);
        return;
      case 'boolean':
        push(item ? TAG_TRUE : TAG_FALSE);
        return;
      case 'string':
        push(TAG_STRING);
        push(stringId(item));
        return;
      case 'number':
        push(TAG_NUMBER);
        push(numbers.length);
        numbers.push(item);
        return;
      case 'object':
        break;
      default:
        throw new UnencodableValueError(`a ${typeof item} cannot be written`);
    }
    if (item === null) {
      push(TAG_NULL);
      return;
    }
    const reference = seen.get(item);
    if (reference !== undefined) {
      push(TAG_REFERENCE);
      push(reference);
      return;
    }
    seen.set(item, seen.size);
    if (item instanceof Uint8Array) {
      if (Object.getPrototypeOf(item) !== Uint8Array.prototype) {
        throw new UnencodableValueError('a Uint8Array subclass cannot be written');
      }
      push(TAG_BYTES);
      push(bytes.length);
      bytes.push(item);
      return;
    }
    if (item instanceof Map) {
      if (Object.getPrototypeOf(item) !== Map.prototype || Object.keys(item).length > 0) {
        throw new UnencodableValueError(
          'a Map subclass or a Map with properties cannot be written'
        );
      }
      push(TAG_MAP | containerFlags(item));
      push(item.size);
      for (const [key, entry] of item) {
        write(key);
        write(entry);
      }
      return;
    }
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype) {
        throw new UnencodableValueError('an Array subclass cannot be written');
      }
      push(TAG_ARRAY | containerFlags(item));
      push(item.length);
      for (let index = 0; index < item.length; index += 1) {
        if (!(index in item)) throw new UnencodableValueError('a sparse array cannot be written');
        write(item[index]);
      }
      return;
    }
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new UnencodableValueError('only plain objects, arrays, maps and bytes can be written');
    }
    if (Object.getOwnPropertySymbols(item).length > 0) {
      throw new UnencodableValueError('an object with symbol keys cannot be written');
    }
    const keys = Object.keys(item);
    push(TAG_OBJECT | containerFlags(item) | (prototype === null ? FLAG_NULL_PROTOTYPE : 0));
    push(shapeId(keys));
    const record = item as Record<string, unknown>;
    for (const key of keys) write(record[key]);
  };

  write(value);
  return { ops: ops.slice(0, length), strings, shapes, numbers, bytes };
}

/** Whether a value has the members of an {@link EncodedValueGraph}, before any of it is read. */
export function isEncodedValueGraph(value: unknown): value is EncodedValueGraph {
  if (typeof value !== 'object' || value === null) return false;
  const graph = value as Partial<EncodedValueGraph>;
  return (
    graph.ops instanceof Int32Array &&
    Array.isArray(graph.strings) &&
    Array.isArray(graph.shapes) &&
    Array.isArray(graph.numbers) &&
    Array.isArray(graph.bytes)
  );
}

/** A rebuild in progress: run it to the end at once, or a slice at a time. */
export interface ValueGraphDecoder {
  /**
   * Rebuild until done or until `pause` answers true (asked every few hundred values).
   * Answers whether the rebuild is finished.
   */
  run(pause?: () => boolean): boolean;
  /** The rebuilt value once finished, or `null` when the stream was not one this wrote. */
  result(): { readonly value: unknown } | null;
}

/** How many values a rebuild places between two questions to its `pause`. */
const PAUSE_STRIDE = 512;

/** An open container being filled: an array, an object or a map. */
interface Frame {
  readonly tag: number;
  readonly target: unknown[] | Record<string, unknown> | Map<unknown, unknown>;
  readonly size: number;
  readonly keys: readonly string[] | null;
  readonly frozen: boolean;
  index: number;
  /** A map entry's key, read and waiting for its value. */
  key: unknown;
  hasKey: boolean;
}

/**
 * Start rebuilding a value graph written by {@link encodeValueGraph}. Nothing is read until
 * the decoder runs; a stream that is not one this wrote — out of range, of the wrong type,
 * with operands left over — finishes with a `null` result.
 *
 * The rebuild keeps its own stack rather than recursing, so it can stop between any two values
 * and resume where it stopped: a host can spread a long document's rebuild over short tasks.
 */
export function createValueGraphDecoder(graph: EncodedValueGraph): ValueGraphDecoder {
  const { ops, strings, shapes, numbers, bytes } = graph;
  const objects: unknown[] = [];
  const stack: Frame[] = [];
  let position = 0;
  let root: unknown;
  let started = false;
  let finished = false;
  let outcome: { readonly value: unknown } | null = null;

  const operand = (): number => {
    if (position >= ops.length) throw new MalformedGraphError();
    return ops[position++]!;
  };
  const indexInto = <T>(table: readonly T[]): T => {
    const index = operand();
    if (index < 0 || index >= table.length) throw new MalformedGraphError();
    return table[index]!;
  };
  const count = (): number => {
    const size = operand();
    // Every entry takes at least one op, so a count past what is left is not a real one.
    if (size < 0 || size > ops.length - position) throw new MalformedGraphError();
    return size;
  };
  const tablesAreWellFormed = (): boolean =>
    strings.every((text) => typeof text === 'string') &&
    numbers.every((number) => typeof number === 'number') &&
    bytes.every((array) => array instanceof Uint8Array) &&
    shapes.every(
      (keys) =>
        Array.isArray(keys) && keys.every((key) => typeof key === 'string' && key !== '__proto__')
    );

  const open = (
    tag: number,
    target: Frame['target'],
    size: number,
    keys: readonly string[] | null,
    frozen: boolean
  ): void => {
    objects.push(target);
    if (size === 0) {
      if (frozen) Object.freeze(target);
      return;
    }
    stack.push({ tag, target, size, keys, frozen, index: 0, key: undefined, hasKey: false });
  };

  /** The next value; a container comes back empty, with its frame pushed to be filled. */
  const next = (): unknown => {
    const op = operand();
    const tag = op & TAG_MASK;
    // Flags only where they were written: freezing on containers, the prototype on objects.
    const flags = op & ~TAG_MASK;
    const allowed =
      tag === TAG_OBJECT
        ? FLAG_FROZEN | FLAG_NULL_PROTOTYPE
        : tag === TAG_ARRAY || tag === TAG_MAP
          ? FLAG_FROZEN
          : 0;
    if ((flags & ~allowed) !== 0) throw new MalformedGraphError();
    const frozen = (op & FLAG_FROZEN) !== 0;
    switch (tag) {
      case TAG_UNDEFINED:
        return undefined;
      case TAG_NULL:
        return null;
      case TAG_TRUE:
        return true;
      case TAG_FALSE:
        return false;
      case TAG_STRING:
        return indexInto(strings);
      case TAG_NUMBER:
        return indexInto(numbers);
      case TAG_REFERENCE:
        return indexInto(objects);
      case TAG_BYTES: {
        const array = indexInto(bytes);
        objects.push(array);
        return array;
      }
      case TAG_MAP: {
        const map = new Map<unknown, unknown>();
        open(TAG_MAP, map, count(), null, frozen);
        return map;
      }
      case TAG_ARRAY: {
        const size = count();
        const array: unknown[] = new Array(size);
        open(TAG_ARRAY, array, size, null, frozen);
        return array;
      }
      case TAG_OBJECT: {
        const keys = indexInto(shapes);
        const object: Record<string, unknown> =
          (op & FLAG_NULL_PROTOTYPE) !== 0 ? Object.create(null) : {};
        open(TAG_OBJECT, object, keys.length, keys, frozen);
        return object;
      }
      default:
        throw new MalformedGraphError();
    }
  };

  const step = (pause: (() => boolean) | undefined): boolean => {
    if (!started) {
      started = true;
      if (!tablesAreWellFormed()) throw new MalformedGraphError();
      root = next();
    }
    let placed = 0;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.index === frame.size) {
        stack.pop();
        if (frame.frozen) Object.freeze(frame.target);
        continue;
      }
      const value = next();
      switch (frame.tag) {
        case TAG_ARRAY:
          (frame.target as unknown[])[frame.index++] = value;
          break;
        case TAG_OBJECT:
          (frame.target as Record<string, unknown>)[frame.keys![frame.index++]!] = value;
          break;
        default:
          if (frame.hasKey) {
            (frame.target as Map<unknown, unknown>).set(frame.key, value);
            frame.key = undefined;
            frame.hasKey = false;
            frame.index += 1;
          } else {
            frame.key = value;
            frame.hasKey = true;
          }
      }
      placed += 1;
      if (pause && placed % PAUSE_STRIDE === 0 && pause()) return false;
    }
    if (position !== ops.length) throw new MalformedGraphError();
    return true;
  };

  return {
    run(pause) {
      if (finished) return true;
      try {
        if (!step(pause)) return false;
        outcome = { value: root };
      } catch (error) {
        if (!(error instanceof MalformedGraphError)) throw error;
        outcome = null;
      }
      finished = true;
      // Nothing more to read: let the stack and the reference table go.
      stack.length = 0;
      objects.length = 0;
      return true;
    },
    result() {
      return finished ? outcome : null;
    },
  };
}

/**
 * Rebuild a value graph written by {@link encodeValueGraph} in one go, or `null` for a stream
 * that is not one.
 */
export function decodeValueGraph(graph: EncodedValueGraph): { readonly value: unknown } | null {
  const decoder = createValueGraphDecoder(graph);
  decoder.run();
  return decoder.result();
}
