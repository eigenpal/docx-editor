// Field-derived hyperlinks at the surface trust boundary (paginated-surface seam).
//
// A `HYPERLINK "..."` complex field or `w:fldSimple` has no `w:hyperlink` element, so the
// typed-link lane (`surface-hyperlinks.ts`) can never resolve one: its ids name canonical
// nodes and its lookups walk the tree. This module is the field twin — it turns the parsed
// instruction into the same sanitized {@link SpanLinkRecord} spans carry, minting an id per
// distinct target and remembering the record so a click on the painted anchor resolves.
//
// THE ONE HREF TRUST BOUNDARY STAYS HERE. The raw target crosses `sanitizeHref` plus the
// same absolute-URI gate a relationship target must clear (`validateExternalTarget`) —
// a relative target would resolve against the HOST page's origin, which is not somewhere a
// document gets to point. A refused target falls back to the `\l` anchor when the field
// names one, and otherwise projects NO link at all: the cached result stays plain text.
// Nothing here fetches or navigates; opening stays with `surface-navigation.ts`.

import { sanitizeHref } from '../store/package/sinks.ts';
import { validateExternalTarget } from '../store/package/opc-names.ts';
import type { HyperlinkFieldSpec } from '../layout/field-link.ts';
import type { SpanLinkRecord } from '../layout/semantic-records.ts';
import type { SurfaceHyperlink } from './surface-hyperlinks.ts';

/**
 * Distinct field links remembered per surface. Documents hold links in proportion to their
 * own size, so this only bites a hostile file; past it, a NEW target projects no link at
 * all — its text paints plain, which fails closed. Known targets keep resolving.
 */
const MAX_REGISTERED_FIELD_LINKS = 4096;

export interface FieldLinkRegistry {
  /** The projector layout calls for every parsed HYPERLINK field instruction. */
  project(spec: HyperlinkFieldSpec): SpanLinkRecord | null;
  /** Resolve a minted field-link id back to its record, for click routing. */
  linkById(linkId: string): SurfaceHyperlink | null;
}

/** The sanitized halves of a field link, before identity is assigned. */
interface ResolvedFieldLink {
  readonly kind: SurfaceHyperlink['kind'];
  readonly href: string | null;
  readonly authored: string;
  readonly anchor?: string;
  readonly tooltip?: string;
}

/**
 * Apply the trust boundary to one parsed spec, or null when nothing links.
 *
 * Mirrors `hyperlinkTargetOf` for the shapes a field can express: an admitted external
 * target wins over the anchor (Word's `r:id`-over-`w:anchor` rule), an anchor-only field is
 * an internal link whose fragment is itself sanitized, and a refused target with no anchor
 * is no link at all — never an attribute built from raw input.
 */
function resolveFieldLink(spec: HyperlinkFieldSpec): ResolvedFieldLink | null {
  const tooltip = spec.tooltip !== null ? { tooltip: spec.tooltip } : {};
  if (spec.target !== null) {
    const projection = sanitizeHref(spec.target);
    const admitted =
      projection.ok && projection.href.length > 0 && validateExternalTarget(projection.href).ok;
    if (admitted) {
      return {
        kind: 'external',
        href: projection.href,
        authored: spec.target,
        ...(spec.anchor !== null ? { anchor: spec.anchor } : {}),
        ...tooltip,
      };
    }
    if (spec.anchor === null) return null;
  }
  if (spec.anchor !== null) {
    // A fragment, not a URL — same rule as a typed `w:hyperlink w:anchor`: the name is
    // file-derived, so it clears the same allowlist before a `#` is put in front of it.
    const fragment = sanitizeHref(spec.anchor);
    return {
      kind: 'internal',
      href: fragment.ok && fragment.href.length > 0 ? `#${fragment.href}` : null,
      authored: spec.anchor,
      anchor: spec.anchor,
      ...tooltip,
    };
  }
  return null;
}

/**
 * Create the per-surface registry.
 *
 * Content-keyed: two fields naming the same target share one id, so a repainted or re-laid
 * paragraph resolves to the same registered record however many layout passes ran. Entries
 * live as long as the surface — cached layout pages may carry any id ever minted.
 */
export function createFieldLinkRegistry(): FieldLinkRegistry {
  const idByKey = new Map<string, string>();
  const byId = new Map<string, SurfaceHyperlink>();
  let minted = 0;

  return {
    project(spec) {
      const resolved = resolveFieldLink(spec);
      if (!resolved) return null;
      const key = `${spec.target ?? ''}\u0000${spec.anchor ?? ''}\u0000${spec.tooltip ?? ''}`;
      let id = idByKey.get(key);
      if (id === undefined) {
        // Full and unknown: NO link, never an id minted without its record. An unregistered
        // id would paint an anchor whose clicks resolve to nothing — and a FRESH id per call
        // would churn the fragment signature of an unchanged line on every re-break.
        if (idByKey.size >= MAX_REGISTERED_FIELD_LINKS) return null;
        minted += 1;
        id = `field-hyperlink:${minted}`;
        idByKey.set(key, id);
        // A field link names no `w:hyperlink` node, so it has no addressable range: the
        // position fields stay empty and the editing lane (retarget/unlink) never sees it.
        byId.set(
          id,
          Object.freeze({
            id,
            paragraphId: '',
            start: 0,
            end: 0,
            text: '',
            kind: resolved.kind,
            href: resolved.href,
            authored: resolved.authored,
            ...(resolved.anchor !== undefined ? { anchor: resolved.anchor } : {}),
            ...(resolved.tooltip !== undefined ? { tooltip: resolved.tooltip } : {}),
          })
        );
      }
      return {
        id,
        kind: resolved.kind,
        href: resolved.href,
        ...(resolved.anchor !== undefined ? { anchor: resolved.anchor } : {}),
        ...(resolved.tooltip !== undefined ? { tooltip: resolved.tooltip } : {}),
      };
    },
    linkById(linkId) {
      return byId.get(linkId) ?? null;
    },
  };
}
