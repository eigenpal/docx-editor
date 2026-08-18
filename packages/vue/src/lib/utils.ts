type ClassValue = string | false | null | undefined | ClassValue[];

/** Join class names — clsx-style, without an extra dependency. */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (value: ClassValue): void => {
    if (!value) return;
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
  };
  inputs.forEach(walk);
  return out.join(' ');
}
