// Reading a package on one thread and opening it on another.
//
// `openTreeSession` reads the package and builds the session in one call on the page's thread,
// and on a long document the read is most of it: the unzip and the XML of the body, notes,
// styles and numbering. This module splits the read off. `parseDocument` runs the SAME bounded
// reader (`readOoxmlPackage`, the same zip-bomb, part, relationship and XML limits) and writes
// its result — package or rejection — in the codec's wire form; `parsedDocumentRead` rebuilds
// it on the receiving thread, and the session opens from that with nothing left to read.
//
// Neither half touches a DOM, a window or a canvas: this lane compiles without the DOM lib.
// Internal: the editor's own parse worker (`src/parse/worker.ts`) is the only writer and the
// editor (`parse-off-thread.ts`) the only reader, so a read never arrives from a host.

import { readOoxmlPackage, type OoxmlPackageResult } from './ooxml-package.ts';
import {
  createValueGraphDecoder,
  encodeValueGraph,
  isEncodedValueGraph,
  UnencodableValueError,
  type EncodedValueGraph,
  type ValueGraphDecoder,
} from './parsed-document-codec.ts';

/**
 * A DOCX read ahead of its open, typically on a worker.
 *
 * Reading a package — unzipping it and turning its XML parts into trees — is most of what an
 * open costs before layout, and none of it needs the page. {@link parseDocument} does that read
 * anywhere, a worker included, and answers this: plain data that crosses `postMessage`. The
 * editor opens from it without reading the bytes again, on exactly the model a read of `bytes`
 * in place would have produced.
 */
export interface ParsedDocument {
  /** Tells a parsed document from the other kinds of document source. */
  readonly kind: 'docx-editor.parsed-document';
  /** The wire format's version. A document of another version is opened from its bytes. */
  readonly version: number;
  /** The file that was read: what the editor keeps, saves from, and reads embedded fonts from. */
  readonly bytes: Uint8Array;
  /** The read itself. Opaque: only the engine's own {@link parseDocument} writes it. */
  readonly read: unknown;
}

const KIND = 'docx-editor.parsed-document';
/** The wire format. Bumped whenever the codec or the read's shape changes incompatibly. */
const VERSION = 1;

/**
 * Read DOCX bytes into a {@link ParsedDocument}, on any thread.
 *
 * The read is the one an open runs, under the same limits, and a file it refuses is carried
 * as that refusal: the editor reports it exactly as it reports the same file opened from
 * bytes. Post the answer with {@link parsedDocumentTransferables} to move its buffers rather
 * than copy them.
 *
 */
export function parseDocument(bytes: Uint8Array): ParsedDocument {
  const read = readOoxmlPackage(bytes);
  let encoded: EncodedValueGraph | null = null;
  try {
    encoded = encodeValueGraph(read);
  } catch (error) {
    // A read the codec cannot carry exactly is not offered at all: the editor then reads the
    // bytes in place, as it would have without this module.
    if (!(error instanceof UnencodableValueError)) throw error;
  }
  return { kind: KIND, version: VERSION, bytes, read: encoded };
}

/**
 * The buffers a {@link ParsedDocument} can transfer in `postMessage` rather than copy: its
 * bytes and the read's. Transferring them detaches them on the sending side, so pass this
 * only where the sender is done with them — a worker that just parsed.
 *
 */
export function parsedDocumentTransferables(parsed: ParsedDocument): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const add = (view: ArrayBufferView): void => {
    // A shared buffer cannot be transferred; it crosses by reference anyway.
    if (view.buffer instanceof ArrayBuffer) buffers.add(view.buffer);
  };
  add(parsed.bytes);
  if (isEncodedValueGraph(parsed.read)) {
    add(parsed.read.ops);
    for (const array of parsed.read.bytes) add(array);
  }
  return [...buffers];
}

/** What the editor posts to its parse worker: the bytes to read, and a number to answer with. */
export interface ParseRequest {
  readonly id: number;
  readonly bytes: Uint8Array;
}

/** What the parse worker answers: the request's number and its read, or null when it failed. */
export interface ParseReply {
  readonly id: number;
  readonly parsed: ParsedDocument | null;
}

/**
 * The parse worker's whole job: read a {@link ParseRequest}'s bytes and answer with the reply
 * and the buffers to transfer. A message that is not a request gets no answer; a read that
 * throws answers null, and the editor then reads the bytes on the page.
 */
export function answerParseRequest(
  data: unknown
): { readonly reply: ParseReply; readonly transfer: ArrayBuffer[] } | null {
  const request = data as Partial<ParseRequest> | null;
  if (
    typeof request !== 'object' ||
    request === null ||
    typeof request.id !== 'number' ||
    !(request.bytes instanceof Uint8Array)
  ) {
    return null;
  }
  try {
    const parsed = parseDocument(request.bytes);
    return { reply: { id: request.id, parsed }, transfer: parsedDocumentTransferables(parsed) };
  } catch {
    return { reply: { id: request.id, parsed: null }, transfer: [] };
  }
}

/** Whether a value is a {@link ParsedDocument}, by its tag and its bytes. */
export function isParsedDocument(value: unknown): value is ParsedDocument {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ParsedDocument>;
  return candidate.kind === KIND && candidate.bytes instanceof Uint8Array;
}

/** A parsed document's rebuild: in progress, or done with its read (or with none usable). */
interface Rebuild {
  readonly decoder: ValueGraphDecoder | null;
  done: boolean;
  read: OoxmlPackageResult | null;
}

/** Each parsed document's rebuild: started once, by whoever asks first, and shared. */
const rebuilds = new WeakMap<ParsedDocument, Rebuild>();

function rebuildOf(parsed: ParsedDocument): Rebuild {
  let rebuild = rebuilds.get(parsed);
  if (!rebuild) {
    const usable = parsed.version === VERSION && isEncodedValueGraph(parsed.read);
    rebuild = usable
      ? {
          decoder: createValueGraphDecoder(parsed.read as EncodedValueGraph),
          done: false,
          read: null,
        }
      : { decoder: null, done: true, read: null };
    rebuilds.set(parsed, rebuild);
  }
  return rebuild;
}

/** Run a rebuild until it finishes or `pause` asks it to stop; answers whether it finished. */
function advance(parsed: ParsedDocument, rebuild: Rebuild, pause?: () => boolean): boolean {
  if (rebuild.done) return true;
  if (!rebuild.decoder!.run(pause)) return false;
  const decoded = rebuild.decoder!.result();
  rebuild.read = decoded && isPackageResult(decoded.value) ? decoded.value : null;
  rebuild.done = true;
  releaseWireForm(parsed.read as EncodedValueGraph);
  return true;
}

/**
 * The read a {@link ParsedDocument} carries, rebuilt on this thread — or `null` when it has
 * none this engine can use (another wire version, a damaged stream), and the bytes must be
 * read in place instead.
 *
 * Rebuilding is one pass of object creation, a fraction of the read it replaces, and happens
 * once per parsed document; a rebuild a host started in slices is finished here in one go.
 * After it the wire form is released, so whatever still holds the parsed document does not
 * also hold a second copy of the read.
 */
export function parsedDocumentRead(parsed: ParsedDocument): OoxmlPackageResult | null {
  const rebuild = rebuildOf(parsed);
  advance(parsed, rebuild);
  return rebuild.read;
}

/**
 * Rebuild a received {@link ParsedDocument}'s read now — in the message handler that received
 * it, say — so that the open which follows costs nothing more. Answers the document, or `null`
 * for a value that is not one.
 *
 * Optional: an editor handed a parsed document rebuilds it on open if this has not.
 *
 */
export function receiveParsedDocument(value: unknown): ParsedDocument | null {
  if (!isParsedDocument(value)) return null;
  parsedDocumentRead(value);
  return value;
}

/** How {@link receiveParsedDocumentInSlices} spreads the rebuild. */
export interface ReceiveInSlicesOptions {
  /** The longest a slice runs before it yields, in milliseconds. Default 8. */
  readonly sliceMs?: number;
  /** How a slice yields to the thread. Default: the platform's `scheduler.yield`, else a
   *  message-channel task, else `setTimeout(0)`. */
  readonly yieldToHost?: () => Promise<void>;
}

/**
 * {@link receiveParsedDocument}, a slice at a time: the rebuild runs in short tasks so the
 * page never stalls on it, and the promise settles when it is done. Opening the document
 * before then is fine — the open finishes what is left of the rebuild at once.
 *
 */
export async function receiveParsedDocumentInSlices(
  value: unknown,
  options: ReceiveInSlicesOptions = {}
): Promise<ParsedDocument | null> {
  if (!isParsedDocument(value)) return null;
  const sliceMs = options.sliceMs ?? 8;
  const yieldToHost = options.yieldToHost ?? platformYield;
  const rebuild = rebuildOf(value);
  for (;;) {
    const deadline = now() + sliceMs;
    if (advance(value, rebuild, () => now() >= deadline)) return value;
    await yieldToHost();
  }
}

/** The thread's clock. This lane has no DOM types, so the one global it reads is named here. */
const now = (): number =>
  (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();

/** Yield one task to the host, by the best means the platform has. */
function platformYield(): Promise<void> {
  const host = globalThis as {
    scheduler?: { yield?: () => Promise<void> };
    MessageChannel?: new () => {
      port1: { onmessage: (() => void) | null; close(): void };
      port2: { postMessage(message: null): void; close(): void };
    };
    setTimeout?: (callback: () => void, ms: number) => unknown;
  };
  if (typeof host.scheduler?.yield === 'function') return host.scheduler.yield();
  if (host.MessageChannel) {
    const channel = new host.MessageChannel();
    return new Promise((resolve) => {
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => host.setTimeout!(resolve, 0));
}

/** The members a read's result has, checked before it stands in for a read of the bytes. */
function isPackageResult(value: unknown): value is OoxmlPackageResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as { ok?: unknown; reason?: unknown; package?: unknown };
  if (result.ok === false) return typeof result.reason === 'string';
  if (result.ok !== true || typeof result.package !== 'object' || result.package === null) {
    return false;
  }
  const pkg = result.package as Record<string, unknown>;
  const contentTypes = pkg.contentTypes as Record<string, unknown> | undefined;
  return (
    pkg.parts instanceof Map &&
    pkg.partBytes instanceof Map &&
    pkg.relationships instanceof Map &&
    Array.isArray(pkg.externalTargets) &&
    typeof pkg.mainDocumentPart === 'string' &&
    typeof contentTypes === 'object' &&
    contentTypes !== null &&
    contentTypes.defaults instanceof Map &&
    contentTypes.overrides instanceof Map
  );
}

/** Drop the stream and tables a decoded read no longer needs; the byte arrays live on in it. */
function releaseWireForm(graph: EncodedValueGraph): void {
  try {
    const writable = graph as { -readonly [K in keyof EncodedValueGraph]: EncodedValueGraph[K] };
    writable.ops = new Int32Array(0);
    writable.strings = [];
    writable.shapes = [];
    writable.numbers = [];
    writable.bytes = [];
  } catch {
    // A frozen wire form stays as it is; the WeakMap answers for it all the same.
  }
}
