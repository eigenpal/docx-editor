/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The chrome side of presence colour resolution, shared by both adapters' collaboration
// compounds so they cannot drift from each other.
//
// The rule is the engine's own (`authorAccent` + the review roster): a participant's
// PUBLISHED colour wins when it is one the engine can paint; otherwise the review roster's
// resolved colour for their display name — the same derivation the review cards and the
// painted presence key on; otherwise the next author-ramp slot after the roster. The
// painted caret label stays the authority (its inline `--doc-remote-color` is the engine's
// literal answer); this module exists for chrome the engine does not paint, like avatars.

import { safeParticipantColor } from '@docx-editor.dev/core/collaboration';
import type { CollaborationParticipant } from '@docx-editor.dev/core/collaboration';
import type { ReviewAuthorInfo } from '@docx-editor.dev/core/editor';

/** How many author slots the token ramp defines; past it, colours repeat. */
const AUTHOR_SLOTS = 8;

/** One resolved presence accent: the colour, and the ramp slot it rides when it rides one. */
export interface PresenceAccent {
  /** The accent to paint with — a published colour, a declared style colour, or a ramp token. */
  readonly color: string;
  /** The wrapped author-ramp slot behind `color`, or null for a published/declared colour. */
  readonly slot: number | null;
}

/** The wrapped ramp slot a `var(--doc-review-author-N)` token names, or null for any other colour. */
function rampSlotOf(color: string): number | null {
  const match = /^var\(--doc-review-author-(\d{1,2})\)$/.exec(color);
  return match ? Number(match[1]) % AUTHOR_SLOTS : null;
}

/**
 * Resolve one accent per participant, keyed by `actorId`.
 *
 * Pass the participants in SESSION order (order of appearance), not display order: a name
 * the roster does not carry takes the next ramp slot after the roster, and appearance order
 * is what the engine's own presence fallback allocates by. Roster authors and published
 * colours are exact; only that last fallback is an approximation of the engine's stable
 * allocator, which the painted labels resolve authoritatively anyway.
 *
 * With `colorForName` — the facade's `presenceColorFor`, when an editor is in context — the
 * ENGINE answers for every colourless name: its persistent allocator hands out ramp slots in
 * first-resolution order, which the session-order arithmetic below can only approximate, so
 * avatars and painted carets take one colour from one allocator. The arithmetic remains only
 * as the no-editor fallback.
 */
export function presenceAccentsOf(
  roster: readonly ReviewAuthorInfo[],
  participants: readonly CollaborationParticipant[],
  colorForName?: (name: string) => string | undefined,
  declaredColorFor?: (name: string) => string | undefined
): ReadonlyMap<string, PresenceAccent> {
  const byAuthor = new Map(roster.map((info) => [info.author, info] as const));
  const allocated = new Map<string, number>();
  const accents = new Map<string, PresenceAccent>();
  for (const participant of participants) {
    if (accents.has(participant.actorId)) continue;
    // A colour the HOST declared outranks the one the peer published — the same order the
    // painted caret resolves in, so an avatar and a caret cannot disagree about one person.
    const declared = safeParticipantColor(declaredColorFor?.(participant.name));
    if (declared !== undefined) {
      accents.set(participant.actorId, { color: declared, slot: rampSlotOf(declared) });
      continue;
    }
    // Same sanitation as the paint sink: a colour the engine would refuse to paint must not
    // colour the avatar either, or the two disagree about who draws in what.
    const published = safeParticipantColor(participant.color);
    if (published !== undefined) {
      accents.set(participant.actorId, { color: published, slot: null });
      continue;
    }
    const known = byAuthor.get(participant.name);
    const engine = safeParticipantColor(colorForName?.(participant.name));
    if (engine !== undefined) {
      accents.set(participant.actorId, {
        color: engine,
        slot: rampSlotOf(engine) ?? (known ? known.slot % AUTHOR_SLOTS : null),
      });
      continue;
    }
    if (known !== undefined) {
      const slot = known.slot % AUTHOR_SLOTS;
      // Sanitized as the paint sink is: a declared colour the engine refuses to paint falls
      // to the author's slot token, exactly as the painted caret does.
      accents.set(participant.actorId, {
        color: safeParticipantColor(known.color) ?? `var(--doc-review-author-${slot})`,
        slot,
      });
      continue;
    }
    let slot = allocated.get(participant.name);
    if (slot === undefined) {
      slot = roster.length + allocated.size;
      allocated.set(participant.name, slot);
    }
    accents.set(participant.actorId, {
      color: `var(--doc-review-author-${slot % AUTHOR_SLOTS})`,
      slot: slot % AUTHOR_SLOTS,
    });
  }
  return accents;
}

/** The accent for one participant rendered on its own, outside a stack. */
export function presenceAccentOf(
  roster: readonly ReviewAuthorInfo[],
  participant: CollaborationParticipant,
  colorForName?: (name: string) => string | undefined,
  declaredColorFor?: (name: string) => string | undefined
): PresenceAccent {
  return presenceAccentsOf(roster, [participant], colorForName, declaredColorFor).get(
    participant.actorId
  )!;
}

/**
 * The initials an avatar shows: the first letter of up to two name words, uppercased.
 *
 * The name is remote data — it reaches the DOM as text content only, and this derivation
 * never grows with its length beyond the two leading code points it keeps.
 */
export function participantInitials(name: string): string {
  const words = name.trim().split(/\s+/, 2);
  let initials = '';
  for (const word of words) {
    const first = [...word][0];
    if (first !== undefined) initials += first.toUpperCase();
  }
  return initials;
}

/**
 * Display order for an avatar stack: the local participant first, then by name, then by
 * `actorId` so two identical names keep one stable order across publishes.
 */
export function orderedParticipants(
  participants: readonly CollaborationParticipant[]
): readonly CollaborationParticipant[] {
  return [...participants].sort((left, right) => {
    if (left.isLocal !== right.isLocal) return left.isLocal ? -1 : 1;
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
    return left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0;
  });
}

/**
 * The avatar image declared for a participant, or `undefined` for the initials disc.
 *
 * Presence never carries a picture and must not: a peer publishes its own presence, so an
 * avatar URL on the wire is a zero-click fetch to any host a room member names. The picture
 * is therefore the HOST's, declared once per author with `DocxEditor.AuthorStyle`, and looked
 * up here by display name — the same key the review card resolves, so one declaration reaches
 * a collaborator's caret, their avatar, and their comments.
 *
 * The roster answers for anyone who has written in the document. `declaredFor` — the editor's
 * per-author style — answers for everyone else, which in a room is most people: someone who
 * has joined and typed nothing is in no roster.
 *
 * Both sources are already sanitized where the style is normalized, so what comes back is a
 * URL an `<img>` may load.
 */
export function presenceAvatarUrlOf(
  roster: readonly ReviewAuthorInfo[],
  name: string,
  declaredFor?: (author: string) => { readonly avatarUrl?: string } | undefined
): string | undefined {
  for (const info of roster) {
    if (info.author === name) return info.style?.avatarUrl;
  }
  return declaredFor?.(name)?.avatarUrl;
}
