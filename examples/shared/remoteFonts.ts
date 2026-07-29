// Fetching a family the machine does not have (task 7.7, link three).
//
// OFF BY DEFAULT, and that is the whole design. A font family name comes out of the
// document, so fetching it tells a third party which fonts the document uses — and by
// implication something about the document — with no user action. That is the
// "no zero-click external fetch from a file" rule, and a font request is exactly the case it
// covers. The host must opt in per session; nothing here reads a family and fetches it on
// its own.
//
// What is fetched is a STYLESHEET, not a font: the provider answers with `@font-face` rules
// pointing at its own files, so the browser fetches only the faces it actually needs.

const PROVIDER = 'https://fonts.googleapis.com/css2';

/**
 * Families that must never be requested.
 *
 * Asking a provider for a font it cannot have is a request that only leaks. These are the
 * generics, plus the Office families that are licensed rather than served.
 */
const NEVER_REMOTE = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
]);

/** A family name safe to place in a URL query without changing its meaning. */
const REQUESTABLE = /^[\p{L}\p{N}][\p{L}\p{N} ]{0,63}$/u;

export interface RemoteFontOptions {
  /**
   * REQUIRED and must be true. Not a default anyone can forget: a caller has to state that
   * this session may talk to a third party about the document's fonts.
   */
  readonly enabled: boolean;
  /** Weights to request. Kept small — each one is a file the browser may download. */
  readonly weights?: readonly number[];
  /** Families already requested, so a document naming one a hundred times asks once. */
  readonly requested?: Set<string>;
}

/**
 * The stylesheet URL for a family, or null when it must not be requested.
 *
 * Exported separately from the loader so the decision can be tested without a network or a
 * document — what is refused matters more here than what is fetched.
 */
export function remoteFontUrl(family: string, options: RemoteFontOptions): string | null {
  if (!options.enabled) return null;
  const name = family.trim();
  if (!name || NEVER_REMOTE.has(name.toLowerCase())) return null;
  // Refused rather than escaped: a name carrying a quote, a slash or a colon has no business
  // being turned into a URL at all, and encoding it would only make the request quieter.
  if (!REQUESTABLE.test(name)) return null;

  const weights = [...new Set(options.weights ?? [400, 700])]
    .filter((weight) => Number.isInteger(weight) && weight >= 100 && weight <= 900)
    .sort((a, b) => a - b);
  if (weights.length === 0) return null;

  const url = new URL(PROVIDER);
  url.searchParams.set('family', `${name}:wght@${weights.join(';')}`);
  // `swap` so text is readable in a fallback while the face arrives, rather than invisible.
  url.searchParams.set('display', 'swap');
  return url.toString();
}

/**
 * Request a family, returning whether one was actually started.
 *
 * The return value feeds the resolver's `remote` origin, so `false` means the caller should
 * report a fallback rather than claim the family.
 */
export function requestRemoteFont(family: string, options: RemoteFontOptions): boolean {
  const url = remoteFontUrl(family, options);
  if (!url || typeof document === 'undefined') return false;

  const requested = options.requested;
  const key = family.trim().toLowerCase();
  if (requested?.has(key)) return true;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  // The provider is a third party: no credentials, and no referrer naming the page the
  // document is open in.
  link.crossOrigin = 'anonymous';
  link.referrerPolicy = 'no-referrer';
  document.head.append(link);
  requested?.add(key);
  return true;
}
