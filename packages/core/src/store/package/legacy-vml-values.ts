import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

export const VML = 'urn:schemas-microsoft-com:vml';
export const OFFICE = 'urn:schemas-microsoft-com:office:office';
export const WORD_VML = 'urn:schemas-microsoft-com:office:word';
export const element = (node: OoxmlNode): node is OoxmlElement => node.kind !== 'textValue';
export const named = (node: OoxmlNode, ns: string, name: string): boolean =>
  element(node) && node.namespaceUri === ns && node.localName === name;
export const attribute = (node: OoxmlElement, name: string, ns = '') =>
  node.attributes.find((a) => (a.namespaceUri ?? '') === ns && a.localName === name)?.value;
export function children(node: OoxmlElement): OoxmlElement[] {
  const values: readonly OoxmlNode[] = node.children;
  return values.filter(element);
}
export const off = (value: string | undefined) => /^(f|false|0)$/i.test(value ?? '');
export const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!
  );
export function numeric(value: string | undefined): number {
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value ?? '')) return NaN;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= 1_000_000 ? n : NaN;
}
export function points(value: string | undefined): number {
  const match = value?.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))(pt|in|cm|mm|px)?$/i);
  if (!match) return NaN;
  return (
    numeric(match[1]) *
    { pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75 }[match[2]?.toLowerCase() ?? 'pt']!
  );
}
/**
 * A VML text distance in points. Writers spell a tiny negative distance with an exponent
 * (`-1e-4mm`); a negative distance leaves no gap, so it reads as 0. NaN when malformed.
 */
export function wrapDistancePoints(value: string): number {
  const match = value.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))(?:e([+-]?\d{1,3}))?(pt|in|cm|mm|px)?$/i);
  if (!match) return NaN;
  const scaled = points(match[1]! + (match[3] ?? '')) * 10 ** Number(match[2] ?? 0);
  return Number.isFinite(scaled) ? Math.max(0, scaled) : NaN;
}
export function pair(value: string): [number, number] | null {
  const values = value
    .trim()
    .split(/[,\s]+/)
    .map(numeric);
  return values.length === 2 && values.every(Number.isFinite) ? (values as [number, number]) : null;
}
export function styleOf(node: OoxmlElement): ReadonlyMap<string, string> | null {
  const styles = new Map<string, string>();
  for (const part of (attribute(node, 'style') ?? '').split(';')) {
    if (!part.trim()) continue;
    const i = part.indexOf(':');
    if (i < 1 || styles.size >= 48) return null;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (styles.has(key) && styles.get(key) !== value) return null;
    styles.set(key, value);
  }
  return styles;
}
export function color(value: string | undefined, fallback: string): string | null {
  const input = value ?? fallback;
  // Anchor the color token so malformed suffixes cannot rescan each whitespace position.
  const indexed = input.match(/^(\S+)\s+\[\d+\]$/);
  const raw = (indexed?.[1] ?? input).toLowerCase();
  if (/^#[\da-f]{6}$/.test(raw)) return raw;
  // The three-digit form doubles each digit, as in CSS.
  if (/^#[\da-f]{3}$/.test(raw)) return '#' + Array.from(raw.slice(1), (d) => d + d).join('');
  return NAMED_COLORS.get(raw) ?? null;
}

/** The sixteen basic color names a VML color attribute can spell. */
const NAMED_COLORS: ReadonlyMap<string, string> = new Map([
  ['black', '#000000'],
  ['silver', '#c0c0c0'],
  ['gray', '#808080'],
  ['white', '#ffffff'],
  ['maroon', '#800000'],
  ['red', '#ff0000'],
  ['purple', '#800080'],
  ['fuchsia', '#ff00ff'],
  ['green', '#008000'],
  ['lime', '#00ff00'],
  ['olive', '#808000'],
  ['yellow', '#ffff00'],
  ['navy', '#000080'],
  ['blue', '#0000ff'],
  ['teal', '#008080'],
  ['aqua', '#00ffff'],
]);

/**
 * Bound the complete input before doing any splitting, recursion or SVG allocation.
 *
 * `story` is a validated text-box story root inside the shape. It is ordinary WML content that
 * the story layout bounds by its own limits, so this graphic budget counts only its element.
 */
export function boundedVml(node: OoxmlNode, story?: OoxmlNode): boolean {
  const stack = [{ node, depth: 0 }];
  let visited = 0,
    characters = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (++visited > 512 || current.depth > 16) return false;
    if (current.node === story) continue;
    if (!element(current.node)) {
      if (current.node.value.trim()) return false;
      characters += current.node.value.length;
    } else {
      if (
        visited + stack.length + current.node.children.length > 512 ||
        current.node.attributes.length > 48
      )
        return false;
      for (const attr of current.node.attributes) {
        // Equation Editor stores opaque source metadata beside its preview.
        // Never parse or emit that metadata into SVG. It still counts against
        // the complete 64 KiB input budget below.
        const equationMetadata =
          named(current.node, VML, 'shape') &&
          attr.localName === 'equationxml' &&
          (!attr.namespaceUri || attr.namespaceUri === OFFICE);
        if (attr.value.length > (equationMetadata ? 65_536 : 8192)) return false;
        characters += attr.value.length;
      }
      for (const child of current.node.children)
        stack.push({ node: child, depth: current.depth + 1 });
    }
    if (characters > 65_536) return false;
  }
  return true;
}
