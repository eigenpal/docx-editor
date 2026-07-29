// Is a font family actually available to the browser? (task 7.7, link two)
//
// There is no API that answers this. `document.fonts.check()` reports on faces the page has
// REGISTERED, not on faces the operating system has installed, so it says no to Arial on a
// machine that has Arial. The only reliable test is to measure: render a string in the family
// with a known fallback behind it, and see whether the width differs from the fallback's.
//
// Why it matters for the chain: without this, the resolver cannot tell "the machine has
// Georgia" from "the machine substituted something for Georgia", so it either fetches fonts
// the user already has or paints in a face nobody measured. It is the step between "embedded
// in the document" and "fetch it".
//
// Two fallbacks, not one. A family that happens to collide with the default sans width would
// look unavailable against `sans-serif` alone; a family only counts as missing when it
// matches BOTH reference stacks, which is what the collision case is for.

const PROBE_TEXT = 'mmmmmmmmmmlliWWWWWWWWWW';
const PROBE_SIZE = '72px';
const REFERENCES = ['sans-serif', 'serif', 'monospace'] as const;

/** A family name that can be embedded in a CSS font shorthand without escaping it. */
const SAFE_FAMILY = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

let context: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

function measure(family: string): number | null {
  if (context === undefined) {
    context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!context) return null;
  const cached = widths.get(family);
  if (cached !== undefined) return cached;
  context.font = `${PROBE_SIZE} ${family}`;
  const width = context.measureText(PROBE_TEXT).width;
  widths.set(family, width);
  return width;
}

/**
 * Whether the browser can render text in this family.
 *
 * False means the browser would silently substitute, which is the case the resolver has to
 * act on. Returns true when it cannot measure at all — refusing to claim a font is missing
 * is safer than fetching one that is present.
 */
export function canRenderFont(family: string): boolean {
  const name = family.trim();
  if (!name || !SAFE_FAMILY.test(name)) return false;
  // A generic family is always renderable and would compare equal to itself.
  if ((REFERENCES as readonly string[]).includes(name.toLowerCase())) return true;

  for (const reference of REFERENCES) {
    const target = measure(`"${name}", ${reference}`);
    const baseline = measure(reference);
    if (target === null || baseline === null) return true;
    // Differing from ANY reference means the browser found a real face: if it had
    // substituted, the width would match the fallback it substituted with.
    if (Math.abs(target - baseline) > 0.5) return true;
  }
  return false;
}

export type FontOrigin = 'embedded' | 'installed' | 'remote' | 'fallback';

export interface FontResolution {
  readonly family: string;
  readonly origin: FontOrigin;
}

export interface ResolveFontOptions {
  /** Families the document itself carries, already deobfuscated and registered. */
  readonly embedded: ReadonlySet<string>;
  /** Fetch a family the machine lacks. Omitted means the remote step is skipped. */
  readonly fetchRemote?: (family: string) => boolean;
  /**
   * Whether the machine already has the family. Injected so the ORDER can be tested without
   * a canvas — headless, `canRenderFont` cannot measure and correctly refuses to claim
   * anything is missing, which would make every case look installed.
   */
  readonly isAvailable?: (family: string) => boolean;
}

/**
 * Where a family should come from, in the order that costs least and matches best.
 *
 * EMBEDDED first: a document that carries its own fonts needs neither the machine's
 * cooperation nor the network, and those bytes are exactly what the author saw. INSTALLED
 * next, because fetching a font the user already has is pure waste and a privacy leak.
 * REMOTE only then. FALLBACK last, and honestly labelled — a caller that cannot tell a
 * fallback from a match will report fidelity it does not have.
 */
export function resolveFontFamily(family: string, options: ResolveFontOptions): FontResolution {
  const name = family.trim();
  if (options.embedded.has(name)) return { family: name, origin: 'embedded' };
  const available = options.isAvailable ?? canRenderFont;
  if (available(name)) return { family: name, origin: 'installed' };
  if (options.fetchRemote?.(name)) return { family: name, origin: 'remote' };
  return { family: name, origin: 'fallback' };
}
