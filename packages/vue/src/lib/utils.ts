/**
 * Vue mirror of packages/react/src/lib/utils.ts — `cn()` class-name
 * merger. The React file uses `clsx` (~700 bytes), but adding clsx
 * just for this would bloat the Vue bundle. This minimal inline
 * implementation handles the cases consumer plugins actually use:
 * strings, arrays, and conditional objects ({ 'class-name': boolean }).
 */
type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | Record<string, boolean | undefined | null>;

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const v of inputs) flatten(v, out);
  return out.join(' ');
}

function flatten(value: ClassValue, out: string[]): void {
  if (!value) return;
  if (typeof value === 'string' || typeof value === 'number') {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) flatten(v, out);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, on] of Object.entries(value)) {
      if (on) out.push(k);
    }
  }
}
