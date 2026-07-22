/** @spike-features insert-delete-split-join-operations */

export function isValidUtf16String(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function isValidUtf16Boundary(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return false;
  if (offset === 0 || offset === text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const at = text.charCodeAt(offset);
  if (before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff) return false;
  return true;
}

export function isValidUtf16Range(text: string, start: number, end: number): boolean {
  return isValidUtf16Boundary(text, start) && isValidUtf16Boundary(text, end) && end >= start;
}
