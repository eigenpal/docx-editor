/** Merge a required component class with host class aliases. */
export function mergeHostClass(required: string, hostClass?: string, className?: string): string {
  return [required, hostClass, className].filter(Boolean).join(' ');
}
