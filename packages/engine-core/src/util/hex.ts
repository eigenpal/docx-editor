// UTF-8 <-> hex without TextEncoder (document-engine; engine-core stays DOM-free,
// so its tsconfig omits the DOM/WebWorker libs that declare TextEncoder). Used to
// carry opaque snapshot/update bytes as hex strings.

export function utf8ToHex(s: string): string {
  const bin = unescape(encodeURIComponent(s)); // str -> UTF-8 byte string
  let out = '';
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return out;
}

export function hexToUtf8(hex: string): string {
  let bin = '';
  for (let i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return decodeURIComponent(escape(bin));
}
