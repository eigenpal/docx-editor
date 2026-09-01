export type ObjectUrlRevoker = (url: string) => void;

export function revokeObjectUrls(
  urls: readonly string[],
  revoke: ObjectUrlRevoker = URL.revokeObjectURL
): void {
  for (const url of new Set(urls)) revoke(url);
}

export function replaceObjectUrls(
  previous: readonly string[],
  next: readonly string[],
  revoke: ObjectUrlRevoker = URL.revokeObjectURL
): readonly string[] {
  revokeObjectUrls(previous, revoke);
  return Object.freeze([...next]);
}
