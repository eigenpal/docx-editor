// Bounded clipboard/drop input policy at the untrusted trust boundary (interactive-paginated 4.5).

import type {
  InputObservation,
  InputRejectionObservation,
} from '@docx-editor.dev/core-contract/contracts/interaction';
import type { Schema } from 'prosemirror-model';
import { Slice } from 'prosemirror-model';
import { sanitizeHref } from '@docx-editor.dev/engine-core';

export const INPUT_POLICY_LIMITS = {
  maxPlainTextChars: 256_000,
  maxHtmlChars: 512_000,
  maxPastedBlocks: 256,
  /** Max decoded length while expanding HTML character references in one URL value. */
  maxDecodedUrlChars: 4_096,
} as const;

/** Slice returned from transformPasted when paste must fail closed. */
export const REJECTED_PASTE_SLICE = Slice.empty;

export type InputRejectionCode = InputRejectionObservation['code'];

export type InputRejection = InputRejectionObservation;

const REMOTE_RESOURCE_TAG_RE =
  /<(img|image|source|video|audio|picture|track|iframe|object|embed|link|meta|base|script)\b/i;
/** Active or foreign-namespace markup that must not enter the PM HTML parser. */
const ACTIVE_NAMESPACE_TAG_RE = /<(svg|math|foreignobject|canvas|iframe|object|embed|applet)\b/i;
/** Inline event-handler attributes (on*=) on any tag. */
const EVENT_HANDLER_ATTR_RE = /\s(on[a-z][\w-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
const FORGED_CAPABILITY_MARKUP_RE = /docx-block-embed|data-raw-rpr/i;
const URL_ATTR_RE = /\s(href|src|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
const DANGEROUS_SCHEME_RE = /(?:^|[\s\\])*(?:javascript|vbscript|data)\s*:/i;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function observeInput(lastRejection: InputRejection | null): InputObservation {
  return { lastRejection };
}

export function boundClipboardText(
  text: string
): { ok: true; text: string } | { ok: false; rejection: InputRejection } {
  if (text.length > INPUT_POLICY_LIMITS.maxPlainTextChars) {
    return {
      ok: false,
      rejection: {
        code: 'oversizedPayload',
        reason: `clipboard plain text exceeds ${INPUT_POLICY_LIMITS.maxPlainTextChars} characters`,
      },
    };
  }
  return { ok: true, text };
}

function unsafeResource(reason: string): InputRejection {
  return { code: 'unsafeResource', reason };
}

/** Remove C0 controls and normalize whitespace used to split dangerous schemes. */
function stripUrlControls(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const cu = value.charCodeAt(i);
    if (cu <= 0x1f || cu === 0x7f) continue;
    if (cu <= 0x20) out += ' ';
    else out += value[i]!;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Bounded decode of HTML character references in a URL attribute value. Fail closed on runaway expansion. */
export function decodeHtmlCharacterReferences(
  raw: string,
  maxOutput = INPUT_POLICY_LIMITS.maxDecodedUrlChars
): string | null {
  let out = '';
  for (let i = 0; i < raw.length; ) {
    if (out.length >= maxOutput) return null;
    if (raw[i] !== '&') {
      out += raw[i]!;
      i += 1;
      continue;
    }
    const semi = raw.indexOf(';', i + 1);
    if (semi === -1 || semi - i > 16) {
      out += raw[i]!;
      i += 1;
      continue;
    }
    const ref = raw.slice(i + 1, semi);
    let decoded: string | null = null;
    if (ref.startsWith('#x') || ref.startsWith('#X')) {
      const cp = Number.parseInt(ref.slice(2), 16);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) decoded = String.fromCodePoint(cp);
    } else if (ref.startsWith('#')) {
      const cp = Number.parseInt(ref.slice(1), 10);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) decoded = String.fromCodePoint(cp);
    } else {
      decoded = NAMED_ENTITIES[ref] ?? null;
    }
    if (decoded === null) {
      out += raw[i]!;
      i += 1;
      continue;
    }
    out += decoded;
    i = semi + 1;
  }
  return out.length <= maxOutput ? out : null;
}

/** Bounded percent-decoding for URL obfuscation (linear passes, fail closed on expansion). */
export function decodePercentEncoding(
  raw: string,
  maxOutput = INPUT_POLICY_LIMITS.maxDecodedUrlChars
): string | null {
  let current = raw;
  for (let pass = 0; pass < 3; pass += 1) {
    if (current.length > maxOutput) return null;
    let next = '';
    for (let i = 0; i < current.length; ) {
      if (next.length >= maxOutput) return null;
      if (current[i] === '%' && i + 2 < current.length) {
        const hex = current.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          next += String.fromCharCode(Number.parseInt(hex, 16));
          i += 3;
          continue;
        }
      }
      next += current[i]!;
      i += 1;
    }
    if (next === current) return next.length <= maxOutput ? next : null;
    current = next;
  }
  return current.length <= maxOutput ? current : null;
}

/** Normalize an untrusted href/src attribute value before scheme allowlisting. */
export function normalizeUntrustedUrl(raw: string): string | null {
  const decoded = decodeHtmlCharacterReferences(raw);
  if (decoded === null) return null;
  const controlsStripped = stripUrlControls(decoded.replace(/\\/g, ''));
  const pct = decodePercentEncoding(controlsStripped);
  if (pct === null) return null;
  return stripUrlControls(pct);
}

function resolvesToDangerousScheme(normalized: string): boolean {
  if (DANGEROUS_SCHEME_RE.test(normalized)) return true;
  // Space-split scheme obfuscation (e.g. `java script:`) after control/whitespace normalization.
  return DANGEROUS_SCHEME_RE.test(normalized.replace(/\s/g, ''));
}

/** Fail closed on obfuscated javascript/data/vbscript and non-allowlisted absolute schemes. */
export function scanUntrustedUrl(raw: string): InputRejection | null {
  const normalized = normalizeUntrustedUrl(raw);
  if (normalized === null) {
    return unsafeResource('clipboard URL attribute could not be bounded-decoded');
  }
  if (resolvesToDangerousScheme(normalized)) {
    return unsafeResource('clipboard URL attribute resolves to a forbidden scheme');
  }
  const href = sanitizeHref(normalized);
  if (!href.ok)
    return unsafeResource('clipboard URL attribute is not allowlisted for runtime sinks');
  return null;
}

/**
 * Bounded linear scan of untrusted clipboard HTML before ProseMirror parses it.
 * No innerHTML and no general HTML tree parser — attribute and tag patterns only.
 */
export function scanUntrustedClipboardHtml(html: string): InputRejection | null {
  if (FORGED_CAPABILITY_MARKUP_RE.test(html)) {
    return {
      code: 'capabilityBoundary',
      reason: 'clipboard HTML attempts to forge capability-owned markup',
    };
  }
  if (REMOTE_RESOURCE_TAG_RE.test(html)) {
    return unsafeResource('clipboard HTML contains remote resource-bearing tags');
  }
  if (ACTIVE_NAMESPACE_TAG_RE.test(html)) {
    return unsafeResource('clipboard HTML contains active or foreign-namespace markup');
  }
  EVENT_HANDLER_ATTR_RE.lastIndex = 0;
  if (EVENT_HANDLER_ATTR_RE.test(html)) {
    return unsafeResource('clipboard HTML contains inline event-handler attributes');
  }
  URL_ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_ATTR_RE.exec(html)) !== null) {
    const raw = match[3] ?? match[4] ?? match[5] ?? '';
    const rejection = scanUntrustedUrl(raw);
    if (rejection) return rejection;
    if (URL_ATTR_RE.lastIndex === match.index) URL_ATTR_RE.lastIndex += 1;
  }
  return null;
}

export function boundClipboardHtml(
  html: string
): { ok: true; html: string } | { ok: false; rejection: InputRejection } {
  if (html.length > INPUT_POLICY_LIMITS.maxHtmlChars) {
    return {
      ok: false,
      rejection: {
        code: 'oversizedPayload',
        reason: `clipboard HTML exceeds ${INPUT_POLICY_LIMITS.maxHtmlChars} characters`,
      },
    };
  }
  const scan = scanUntrustedClipboardHtml(html);
  if (scan) return { ok: false, rejection: scan };
  return { ok: true, html };
}

function countTopLevelBlocks(slice: Slice): number {
  let count = 0;
  slice.content.forEach((node) => {
    if (node.isBlock) count += 1;
  });
  return count;
}

function sliceCrossesCapabilityBoundary(slice: Slice): boolean {
  let blocked = false;
  slice.content.descendants((node) => {
    if (node.type.name === 'blockEmbed') blocked = true;
    if (node.type.name !== 'paragraph' && node.type.name !== 'text' && node.type.name !== 'doc') {
      if (node.isBlock) blocked = true;
    }
    return !blocked;
  });
  return blocked;
}

export function validatePastedSlice(slice: Slice, _schema: Schema): InputRejection | null {
  if (slice.size === 0) return null;
  const blocks = countTopLevelBlocks(slice);
  if (blocks > INPUT_POLICY_LIMITS.maxPastedBlocks) {
    return {
      code: 'oversizedPayload',
      reason: `paste exceeds ${INPUT_POLICY_LIMITS.maxPastedBlocks} block nodes`,
    };
  }
  if (sliceCrossesCapabilityBoundary(slice)) {
    return {
      code: 'capabilityBoundary',
      reason: 'paste contains unsupported block structure or read-only embed',
    };
  }
  return null;
}

export function rejectClipboardDataTransfer(
  dataTransfer: DataTransfer | null
): InputRejection | null {
  if (!dataTransfer)
    return { code: 'unsupportedStructure', reason: 'clipboard event missing data transfer' };
  if (dataTransfer.files.length > 0) {
    return { code: 'filePayload', reason: 'clipboard file payloads are rejected' };
  }
  return null;
}

export function rejectDropDataTransfer(dataTransfer: DataTransfer | null): InputRejection | null {
  if (!dataTransfer)
    return { code: 'unsupportedStructure', reason: 'drop event missing data transfer' };
  if (dataTransfer.files.length > 0) {
    return { code: 'filePayload', reason: 'drop file payloads are rejected without fetch' };
  }
  const html = dataTransfer.getData('text/html');
  if (html) {
    const bounded = boundClipboardHtml(html);
    if (!bounded.ok) return bounded.rejection;
  }
  const text = dataTransfer.getData('text/plain');
  if (text) {
    const bounded = boundClipboardText(text);
    if (!bounded.ok) return bounded.rejection;
  }
  return null;
}

export function isCompositionOwnedBeforeInput(inputType: string): boolean {
  return inputType === 'insertCompositionText' || inputType === 'insertFromComposition';
}
