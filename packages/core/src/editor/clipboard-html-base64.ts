const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Chunked base64 over raw bytes, identical in browser and test hosts. */
export function clipboardBase64Of(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let piece = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = index + 1 < bytes.length ? bytes[index + 1]! : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2]! : 0;
    piece += BASE64_ALPHABET[a >> 2]! + BASE64_ALPHABET[((a & 3) << 4) | (b >> 4)]!;
    piece += index + 1 < bytes.length ? BASE64_ALPHABET[((b & 15) << 2) | (c >> 6)]! : '=';
    piece += index + 2 < bytes.length ? BASE64_ALPHABET[c & 63]! : '=';
    if (piece.length >= 0x8000) {
      chunks.push(piece);
      piece = '';
    }
  }
  chunks.push(piece);
  return chunks.join('');
}
