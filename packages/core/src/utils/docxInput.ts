/**
 * Flexible input types for DOCX documents.
 *
 * Accepts any common binary format so consumers don't need to manually
 * convert before passing data to the editor or parser.
 */

/**
 * Any binary representation of a DOCX file that the editor can consume.
 *
 * - `ArrayBuffer` — from `FileReader.readAsArrayBuffer()` or `fetch().arrayBuffer()`
 * - `Uint8Array` — from Node.js `fs.readFile()` or streaming APIs
 * - `Blob` — from drag-and-drop or `<input type="file">`
 * - `File` — subclass of Blob, from `<input type="file">`
 */
export type DocxInput = ArrayBuffer | Uint8Array | Blob | File;

/**
 * Normalize any {@link DocxInput} into an `ArrayBuffer` for internal use.
 */
export async function toArrayBuffer(input: DocxInput): Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) {
    return input;
  }
  if (input instanceof Uint8Array) {
    // Copy into a fresh ArrayBuffer (input may be a view over a larger or shared buffer)
    const copy = new ArrayBuffer(input.byteLength);
    new Uint8Array(copy).set(input);
    return copy;
  }
  if (input instanceof Blob) {
    // Blob and File both support arrayBuffer()
    return input.arrayBuffer();
  }
  // Exhaustive check — should never happen at runtime
  throw new TypeError(`Unsupported DocxInput type: ${typeof input}`);
}
