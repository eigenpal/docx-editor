export interface FontRequest {
  readonly family: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

export interface FontSubstitution {
  readonly requested: FontRequest;
  readonly resolved: FontRequest;
}

const RESOLVED_FONT_BRAND: unique symbol = Symbol('validated-resolved-font');

export interface ResolvedFont {
  readonly [RESOLVED_FONT_BRAND]: true;
  readonly id: string;
  readonly identity: string;
  readonly request: FontRequest;
  readonly family: string;
  /** Owned byte length, available without creating a defensive byte copy. */
  readonly byteLength: number;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly faceIndex: number;
  readonly substitution: FontSubstitution | null;
}

export const HARD_MAX_FONT_BYTES = 64 * 1024 * 1024;
export const HARD_MAX_FONT_SOURCES = 256;
export const HARD_MAX_AGGREGATE_FONT_BYTES = 128 * 1024 * 1024;

export type FontResolutionErrorCode =
  | 'missing'
  | 'forbidden'
  | 'overLimit'
  | 'malformed'
  | 'hashMismatch';

export class FontResolutionError extends Error {
  readonly name = 'FontResolutionError';
  readonly request: FontRequest;
  readonly code: FontResolutionErrorCode;
  readonly limit?: number;
  readonly actual?: number;
  readonly diagnostic?: string;
  readonly expectedHash?: string;
  readonly actualHash?: string;

  constructor(
    code: FontResolutionErrorCode,
    request: FontRequest,
    details: {
      readonly limit?: number;
      readonly actual?: number;
      readonly diagnostic?: string;
      readonly expectedHash?: string;
      readonly actualHash?: string;
    } = {}
  ) {
    super(`Font resolution failed (${code}) for ${fontRequestKey(request)}`);
    this.code = code;
    this.request = freezeRequest(request);
    this.limit = details.limit;
    this.actual = details.actual;
    this.diagnostic = details.diagnostic;
    this.expectedHash = details.expectedHash;
    this.actualHash = details.actualHash;
  }
}

export interface FontResourceDefinition {
  readonly request: FontRequest;
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly faceIndex: number;
  readonly availability?: 'available' | 'forbidden';
}

export interface DeclaredFontSubstitution {
  readonly from: FontRequest;
  readonly to: FontRequest;
}

export type FontValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly diagnostic: string };

export type FontByteValidator = (bytes: Uint8Array, faceIndex: number) => FontValidationResult;

export interface FontResourceSnapshot {
  readonly epoch: number;
  resolve(request: FontRequest): ResolvedFont | FontResolutionError;
}

export interface FontResourceSnapshotOptions {
  readonly epoch: number;
  readonly maxFontBytes: number;
  readonly resources: readonly FontResourceDefinition[];
  readonly substitutions?: readonly DeclaredFontSubstitution[];
  readonly validateFont: FontByteValidator;
  readonly instrumentation?: FontResourceInstrumentation;
}

export interface FontResourceInstrumentation {
  readonly onOwnedByteCopy?: () => void;
  readonly onHash?: () => void;
  readonly onTableScan?: () => void;
  readonly onAdmission?: () => void;
}

type StoredResource =
  | { readonly kind: 'resolved'; readonly font: ResolvedFont }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'overLimit'; readonly actual: number }
  | { readonly kind: 'malformed'; readonly diagnostic: string }
  | { readonly kind: 'hashMismatch'; readonly expectedHash: string; readonly actualHash: string };

const assertRequest = (request: FontRequest): void => {
  if (request.family.trim().length === 0) throw new TypeError('Font family must not be empty');
  if (!Number.isInteger(request.weight) || request.weight < 1 || request.weight > 1000) {
    throw new RangeError('Font weight must be an integer from 1 through 1000');
  }
  if (request.style !== 'normal' && request.style !== 'italic') {
    throw new TypeError('Font style must be normal or italic');
  }
};

const freezeRequest = (request: FontRequest): FontRequest => {
  assertRequest(request);
  return Object.freeze({ family: request.family, weight: request.weight, style: request.style });
};

export const fontRequestKey = (request: FontRequest): string => {
  assertRequest(request);
  return JSON.stringify([request.family, request.weight, request.style]);
};

class OwnedResolvedFont implements ResolvedFont {
  readonly [RESOLVED_FONT_BRAND] = true;
  readonly id: string;
  readonly identity: string;
  readonly request: FontRequest;
  readonly family: string;
  readonly byteLength: number;
  readonly hash: string;
  readonly faceIndex: number;
  readonly substitution: FontSubstitution | null;

  constructor(
    definition: Omit<FontResourceDefinition, 'bytes'> & { readonly byteLength: number },
    substitution?: FontSubstitution
  ) {
    if (definition.id.length === 0) throw new TypeError('Resolved font id must not be empty');
    if (!Number.isInteger(definition.faceIndex) || definition.faceIndex < 0) {
      throw new RangeError('Font face index must be a non-negative integer');
    }
    this.id = definition.id;
    this.request = freezeRequest(definition.request);
    this.family = this.request.family;
    this.hash = definition.hash;
    this.faceIndex = definition.faceIndex;
    this.identity = `${this.hash}#${this.faceIndex}`;
    this.byteLength = definition.byteLength;
    this.substitution = null;
    if (substitution) {
      this.substitution = Object.freeze({
        requested: freezeRequest(substitution.requested),
        resolved: freezeRequest(substitution.resolved),
      });
    }
    Object.freeze(this);
  }

  get bytes(): Uint8Array {
    return trustedFontBytes(this).slice();
  }
}

const validatedFonts = new WeakSet<object>();
const ownedFontBytes = new WeakMap<object, Uint8Array>();
const ownedFontTableTags = new WeakMap<object, ReadonlySet<string>>();

const createOwnedResolvedFont = (
  definition: Omit<FontResourceDefinition, 'bytes'> & { readonly byteLength: number },
  bytes: Uint8Array,
  tableTags: ReadonlySet<string>,
  substitution?: FontSubstitution
): ResolvedFont => {
  const font = new OwnedResolvedFont(definition, substitution);
  ownedFontBytes.set(font, bytes);
  ownedFontTableTags.set(font, tableTags);
  validatedFonts.add(font);
  return font;
};

/** Module-internal capability for trusted shaping and font-installation code. */
export const trustedFontBytes = (font: ResolvedFont): Uint8Array => {
  assertValidatedResolvedFont(font);
  const bytes = ownedFontBytes.get(font);
  if (!bytes) throw new TypeError('Resolved font has no owned byte capability');
  return bytes;
};

/** Module-internal admission metadata; table directories are never rescanned while shaping. */
export const trustedFontTableTags = (font: ResolvedFont): ReadonlySet<string> => {
  assertValidatedResolvedFont(font);
  const tags = ownedFontTableTags.get(font);
  if (!tags) throw new TypeError('Resolved font has no admitted table metadata');
  return tags;
};

/** Internal package assertion used by shaping contracts; not re-exported from the package entry. */
export const assertValidatedResolvedFont: (font: unknown) => asserts font is ResolvedFont = (
  font
) => {
  if (typeof font !== 'object' || font === null || !validatedFonts.has(font)) {
    throw new TypeError('Shaping requires a validated resolved font');
  }
};

const SHA256_INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotateRight = (value: number, count: number): number =>
  (value >>> count) | (value << (32 - count));

/** Synchronous platform-neutral SHA-256 used before font bytes cross into a shaping implementation. */
export const sha256FontBytes = (bytes: Uint8Array): string => {
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  const bitLength = BigInt(bytes.byteLength) * 8n;
  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  const hash = SHA256_INITIAL.slice();
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] =
        ((padded[start]! << 24) |
          (padded[start + 1]! << 16) |
          (padded[start + 2]! << 8) |
          padded[start + 3]!) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]!;
      const right = words[index - 2]!;
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0]! + a) >>> 0;
    hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0;
    hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0;
    hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0;
    hash[7] = (hash[7]! + h) >>> 0;
  }
  return `sha256:${Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('')}`;
};

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! << 8) | bytes[offset + 1]!;
const readUint32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!) >>>
  0;

const validateSfntAt = (bytes: Uint8Array, base: number): FontValidationResult => {
  if (base > bytes.byteLength - 12) return { valid: false, diagnostic: 'truncated sfnt header' };
  const signature = String.fromCharCode(
    bytes[base]!,
    bytes[base + 1]!,
    bytes[base + 2]!,
    bytes[base + 3]!
  );
  const isTrueType =
    bytes[base] === 0 && bytes[base + 1] === 1 && bytes[base + 2] === 0 && bytes[base + 3] === 0;
  if (!isTrueType && signature !== 'OTTO' && signature !== 'true' && signature !== 'typ1') {
    return { valid: false, diagnostic: 'unsupported sfnt signature' };
  }
  const tableCount = readUint16(bytes, base + 4);
  const directoryEnd = base + 12 + tableCount * 16;
  if (!Number.isSafeInteger(directoryEnd) || directoryEnd > bytes.byteLength) {
    return { valid: false, diagnostic: 'truncated sfnt table directory' };
  }
  for (let index = 0; index < tableCount; index += 1) {
    const record = base + 12 + index * 16;
    const offset = readUint32(bytes, record + 8);
    const length = readUint32(bytes, record + 12);
    if (offset > bytes.byteLength || length > bytes.byteLength - offset) {
      return { valid: false, diagnostic: 'sfnt table range exceeds font bytes' };
    }
  }
  return { valid: true };
};

const sfntTableTags = (bytes: Uint8Array, faceIndex: number): ReadonlySet<string> => {
  const signature = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  const base = signature === 'ttcf' ? readUint32(bytes, 12 + faceIndex * 4) : 0;
  const tableCount = readUint16(bytes, base + 4);
  const tags = new Set<string>();
  for (let index = 0; index < tableCount; index += 1) {
    const record = base + 12 + index * 16;
    tags.add(
      String.fromCharCode(
        bytes[record]!,
        bytes[record + 1]!,
        bytes[record + 2]!,
        bytes[record + 3]!
      )
    );
  }
  return Object.freeze(tags);
};

/** Bounded minimum sfnt/TTC check; Task 4 supplies full parser-backed validation. */
export const boundedStructuralFontValidator: FontByteValidator = (bytes, faceIndex) => {
  if (!Number.isSafeInteger(faceIndex) || faceIndex < 0) {
    return { valid: false, diagnostic: 'invalid font face index' };
  }
  if (bytes.byteLength < 12) return { valid: false, diagnostic: 'truncated sfnt header' };
  const signature = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (signature !== 'ttcf') {
    if (faceIndex !== 0) {
      return { valid: false, diagnostic: 'standalone sfnt has only face index zero' };
    }
    return validateSfntAt(bytes, 0);
  }
  const version = readUint32(bytes, 4);
  if (version !== 0x00010000 && version !== 0x00020000) {
    return { valid: false, diagnostic: 'unsupported TTC version' };
  }
  const faceCount = readUint32(bytes, 8);
  const offsetsEnd = 12 + faceCount * 4;
  if (
    faceCount === 0 ||
    !Number.isSafeInteger(offsetsEnd) ||
    offsetsEnd > bytes.byteLength ||
    faceIndex >= faceCount
  ) {
    return { valid: false, diagnostic: 'invalid TTC face directory' };
  }
  const faceOffset = readUint32(bytes, 12 + faceIndex * 4);
  if (faceOffset < offsetsEnd) return { valid: false, diagnostic: 'invalid TTC face offset' };
  return validateSfntAt(bytes, faceOffset);
};

const storeResource = (
  definition: FontResourceDefinition,
  maxFontBytes: number,
  validateFont: FontByteValidator,
  instrumentation?: FontResourceInstrumentation
): StoredResource => {
  if (definition.availability === 'forbidden') return { kind: 'forbidden' };
  if (definition.bytes.byteLength > maxFontBytes) {
    return { kind: 'overLimit', actual: definition.bytes.byteLength };
  }
  const ownedBytes = definition.bytes.slice();
  instrumentation?.onOwnedByteCopy?.();
  instrumentation?.onHash?.();
  const actualHash = sha256FontBytes(ownedBytes);
  if (definition.hash !== actualHash) {
    return { kind: 'hashMismatch', expectedHash: definition.hash, actualHash };
  }
  const structural = boundedStructuralFontValidator(ownedBytes, definition.faceIndex);
  if (!structural.valid) return { kind: 'malformed', diagnostic: structural.diagnostic };
  instrumentation?.onTableScan?.();
  const tableTags = sfntTableTags(ownedBytes, definition.faceIndex);
  try {
    const validation = validateFont(ownedBytes, definition.faceIndex);
    if (!validation.valid) return { kind: 'malformed', diagnostic: validation.diagnostic };
  } catch (error) {
    return {
      kind: 'malformed',
      diagnostic: error instanceof Error ? error.message : 'font validator threw',
    };
  }
  const stored = {
    kind: 'resolved',
    font: createOwnedResolvedFont(
      { ...definition, byteLength: ownedBytes.byteLength },
      ownedBytes,
      tableTags
    ),
  } as const;
  instrumentation?.onAdmission?.();
  return stored;
};

export const createFontResourceSnapshot = (
  options: FontResourceSnapshotOptions
): FontResourceSnapshot => {
  if (!Number.isSafeInteger(options.epoch) || options.epoch < 0) {
    throw new RangeError('Font resource epoch must be a non-negative safe integer');
  }
  if (
    !Number.isSafeInteger(options.maxFontBytes) ||
    options.maxFontBytes <= 0 ||
    options.maxFontBytes > HARD_MAX_FONT_BYTES
  ) {
    throw new RangeError(
      `Font byte ceiling must be a positive safe integer no greater than ${HARD_MAX_FONT_BYTES}`
    );
  }
  if (typeof options.validateFont !== 'function') {
    throw new TypeError('Font snapshot requires a validator');
  }
  if (options.resources.length > HARD_MAX_FONT_SOURCES) {
    throw new RangeError(`Font source count must not exceed ${HARD_MAX_FONT_SOURCES}`);
  }
  let aggregateFontBytes = 0;
  for (const definition of options.resources) {
    if (definition.bytes.byteLength > HARD_MAX_AGGREGATE_FONT_BYTES - aggregateFontBytes) {
      throw new RangeError(`Aggregate font bytes must not exceed ${HARD_MAX_AGGREGATE_FONT_BYTES}`);
    }
    aggregateFontBytes += definition.bytes.byteLength;
  }
  const epoch = options.epoch;
  const maxFontBytes = options.maxFontBytes;
  const validateFont = options.validateFont;

  const resources = new Map<string, StoredResource>();
  for (const definition of options.resources) {
    const key = fontRequestKey(definition.request);
    if (resources.has(key)) throw new TypeError(`Duplicate font resource request: ${key}`);
    resources.set(
      key,
      storeResource(definition, maxFontBytes, validateFont, options.instrumentation)
    );
  }

  const substitutions = new Map<string, FontRequest>();
  for (const substitution of options.substitutions ?? []) {
    const key = fontRequestKey(substitution.from);
    if (substitutions.has(key)) throw new TypeError(`Duplicate font substitution request: ${key}`);
    substitutions.set(key, freezeRequest(substitution.to));
  }

  const resolve = (requested: FontRequest): ResolvedFont | FontResolutionError => {
    const safeRequested = freezeRequest(requested);
    const requestedKey = fontRequestKey(safeRequested);
    const substituted = substitutions.get(requestedKey);
    const resolvedRequest = substituted ?? safeRequested;
    const stored = resources.get(fontRequestKey(resolvedRequest));
    if (!stored) return new FontResolutionError('missing', safeRequested);
    if (stored.kind === 'forbidden') {
      return new FontResolutionError('forbidden', safeRequested);
    }
    if (stored.kind === 'overLimit') {
      return new FontResolutionError('overLimit', safeRequested, {
        limit: maxFontBytes,
        actual: stored.actual,
      });
    }
    if (stored.kind === 'malformed') {
      return new FontResolutionError('malformed', safeRequested, {
        diagnostic: stored.diagnostic,
      });
    }
    if (stored.kind === 'hashMismatch') {
      return new FontResolutionError('hashMismatch', safeRequested, {
        expectedHash: stored.expectedHash,
        actualHash: stored.actualHash,
      });
    }
    if (!substituted) return stored.font;
    return createOwnedResolvedFont(
      {
        request: stored.font.request,
        id: stored.font.id,
        hash: stored.font.hash,
        faceIndex: stored.font.faceIndex,
        byteLength: stored.font.byteLength,
      },
      trustedFontBytes(stored.font),
      trustedFontTableTags(stored.font),
      { requested: safeRequested, resolved: substituted }
    );
  };

  return Object.freeze({ epoch, resolve });
};
