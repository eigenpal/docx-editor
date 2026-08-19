/** Merge host `class` / `className` after required load-bearing classes. */
export function mergeHostClass(
  required: string,
  hostClass?: string | null,
  hostClassName?: string | null
): string {
  const extra = [hostClass, hostClassName].filter(Boolean).join(' ').trim();
  return extra ? `${required} ${extra}` : required;
}
