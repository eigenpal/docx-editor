// Fragment ↔ HTML attribute codec (rich-clipboard-fidelity task 3.1).
//
// The fragment package rides base64-encoded on ONE wrapper element inside the `text/html`
// clipboard flavour (design D1), so it survives cross-tab and cross-window paste while
// every external receiver just reads the visible markup. Reading back is a BOUNDED string
// scan — no DOM, no regex over attacker-sized input — and the decoded bytes then face
// `readOoxmlPackage`'s own zip/XML caps.

/** Decoded fragment payloads above this cap never reach the package reader. */
export const MAX_FRAGMENT_ATTRIBUTE_DECODED_BYTES = 16 * 1024 * 1024;
/** The attribute scan gives up beyond this many characters of HTML. */
const MAX_ATTRIBUTE_SCAN_CHARS = 64 * 1024 * 1024;

const FRAGMENT_ATTRIBUTE = 'data-docx-fragment';
const END_ATTRIBUTE = 'data-docx-fragment-end';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_INDEX: ReadonlyMap<string, number> = new Map(
  [...BASE64_ALPHABET].map((char, index) => [char, index])
);

function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = index + 1 < bytes.length ? bytes[index + 1]! : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2]! : 0;
    out += BASE64_ALPHABET[a >> 2]!;
    out += BASE64_ALPHABET[((a & 0x03) << 4) | (b >> 4)]!;
    out += index + 1 < bytes.length ? BASE64_ALPHABET[((b & 0x0f) << 2) | (c >> 6)]! : '=';
    out += index + 2 < bytes.length ? BASE64_ALPHABET[c & 0x3f]! : '=';
  }
  return out;
}

/** Strict bounded base64 decode; null on any malformed character or an oversized result. */
function decodeBase64(value: string, maxBytes: number): Uint8Array | null {
  const trimmed = value.replace(/=+$/, '');
  if ((trimmed.length * 3) / 4 > maxBytes) return null;
  const out = new Uint8Array(Math.floor((trimmed.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let written = 0;
  for (const char of trimmed) {
    const index = BASE64_INDEX.get(char);
    if (index === undefined) return null;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, written);
}

/** The clipboard-facing wrapper: interop HTML plus the embedded fragment. */
export function wrapInteropHtml(
  innerHtml: string,
  fragment: { readonly bytes: Uint8Array; readonly lastMarkCovered: boolean } | null
): string {
  if (!fragment) return `<div>${innerHtml}</div>`;
  const end = fragment.lastMarkCovered ? 'covered' : 'open';
  return (
    `<div ${FRAGMENT_ATTRIBUTE}="${encodeBase64(fragment.bytes)}" ` +
    `${END_ATTRIBUTE}="${end}">${innerHtml}</div>`
  );
}

export interface DecodedFragmentPayload {
  readonly bytes: Uint8Array;
  readonly lastMarkCovered: boolean;
}

/** One attribute's value from raw HTML, found by bounded string scan. */
function attributeValueIn(html: string, attribute: string): string | null {
  const needle = `${attribute}="`;
  const at = html.indexOf(needle);
  if (at === -1 || at > MAX_ATTRIBUTE_SCAN_CHARS) return null;
  const start = at + needle.length;
  const end = html.indexOf('"', start);
  if (end === -1) return null;
  return html.slice(start, end);
}

/**
 * The embedded fragment payload, when the pasted HTML carries one. Malformed or oversized
 * payloads answer null and the caller degrades to the next flavour.
 */
export function fragmentFromHtml(
  html: string,
  maxDecodedBytes: number = MAX_FRAGMENT_ATTRIBUTE_DECODED_BYTES
): DecodedFragmentPayload | null {
  if (html.length > MAX_ATTRIBUTE_SCAN_CHARS) return null;
  const encoded = attributeValueIn(html, FRAGMENT_ATTRIBUTE);
  if (encoded === null || encoded.length === 0) return null;
  const bytes = decodeBase64(encoded, maxDecodedBytes);
  if (bytes === null || bytes.byteLength === 0) return null;
  const end = attributeValueIn(html, END_ATTRIBUTE);
  return { bytes, lastMarkCovered: end === 'covered' };
}
