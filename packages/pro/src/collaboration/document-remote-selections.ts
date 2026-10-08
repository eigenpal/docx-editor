/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Remote cursors that move with the text.
 *
 * A peer publishes each endpoint as a paragraph offset, and with the shared character beside
 * it. Where this replica shows that character, the endpoint stands beside it, wherever the
 * character moved. Otherwise (an older peer, or a character this replica has not received)
 * each replica keeps the paragraph text it first resolved the offset against, and carries the
 * offset across every later change to that text until the peer publishes again. Without it,
 * typing before a peer's caret drew that caret inside the new words for a whole round trip.
 */
import type { Awareness } from 'y-protocols/awareness';
import type { CollaborationRemoteSelection } from '@docx-editor.dev/core/collaboration';
import {
  mapOffsetAcrossText,
  type CollaborationDocumentPort,
} from '@docx-editor.dev/core/collaboration/replication';
import {
  AWARENESS_FIELD,
  MAX_AWARENESS_STATES,
  awarenessPayload,
  textDigest,
  type EncodedCharacter,
  type EncodedSelectionAddress,
} from './document-awareness.ts';

interface Baseline {
  readonly key: string;
  readonly texts: Map<string, string>;
  /**
   * Each endpoint as last resolved, with the text it was resolved in. Every presence change and
   * every paint resolves all peers, so a peer whose paragraph did not change reuses its answer
   * instead of aligning the paragraph again.
   */
  readonly resolved: Map<
    string,
    {
      readonly text: string;
      readonly address: ResolvedAddress;
      /** The text of the paragraph a published character was found in. */
      readonly target?: string;
    }
  >;
  /**
   * Each endpoint whose paragraph is gone, as last looked up, with the document revision of
   * the lookup. Finding its character reads paragraphs, so the answer holds until the
   * document changes.
   */
  readonly missing: Map<
    string,
    { readonly revision: number; readonly address: ResolvedAddress | null }
  >;
}

/**
 * Text pairs one resolve aligns at most. Peers publish presence for up to
 * `MAX_AWARENESS_STATES` clients, each with its own baseline, so without a bound one change
 * to a paragraph could align it hundreds of times. Past it, an offset holds its place.
 */
const MAX_ALIGNED_PAIRS = 16;

type ResolvedAddress = CollaborationRemoteSelection['anchor'];

/** Where a published character shows here, in this editor's node ids, or null. */
export type FindCharacter = (
  paragraphId: string,
  character: EncodedCharacter
) => { readonly nodeId: string; readonly offset: number } | null;

export class RemoteSelectionResolver {
  private readonly baselines = new Map<number, Baseline>();

  resolve(
    awareness: Awareness,
    port: CollaborationDocumentPort,
    findCharacter?: FindCharacter
  ): readonly CollaborationRemoteSelection[] {
    const states = [...awareness.getStates().entries()].slice(0, MAX_AWARENESS_STATES);
    const selections: CollaborationRemoteSelection[] = [];
    const present = new Set<number>();
    const aligned = new Set<string>();
    let revision: number | undefined;
    for (const [clientId, state] of states) {
      if (clientId === awareness.clientID) continue;
      const payload = awarenessPayload((state as Record<string, unknown>)[AWARENESS_FIELD]);
      if (!payload?.selection) continue;
      present.add(clientId);
      const { anchor: from, head: to } = payload.selection;
      const key =
        `${from.paragraphId}:${from.offset}:${from.digest ?? ''}|` +
        `${to.paragraphId}:${to.offset}:${to.digest ?? ''}`;
      let baseline = this.baselines.get(clientId);
      if (baseline?.key !== key) {
        baseline = { key, texts: new Map(), resolved: new Map(), missing: new Map() };
        this.baselines.set(clientId, baseline);
      }
      const { texts, resolved, missing } = baseline;
      const resolve = (address: EncodedSelectionAddress): ResolvedAddress | null => {
        // Beside the published character, wherever it shows here, and that paragraph's text.
        const beside = (): { address: ResolvedAddress; text: string } | null => {
          const found = address.character
            ? findCharacter?.(address.paragraphId, address.character)
            : null;
          const shown = found ? port.paragraphByNodeId(found.nodeId) : null;
          if (!found || !shown) return null;
          const at = { paragraphId: shown.paragraphId, nodeId: shown.nodeId, offset: found.offset };
          return { address: Object.freeze(at), text: shown.text };
        };
        const paragraph = port.paragraphByStableId(address.paragraphId);
        // A join or deletion removed the paragraph: the character can still show elsewhere.
        if (!paragraph) {
          const key = address.paragraphId + ':' + address.offset;
          revision ??= port.revision();
          const looked = missing.get(key);
          if (looked?.revision === revision) return looked.address;
          const found = beside()?.address ?? null;
          missing.set(key, { revision, address: found });
          return found;
        }
        const cached = resolved.get(address.paragraphId + ':' + address.offset);
        if (
          cached?.text === paragraph.text &&
          cached.address.nodeId === paragraph.nodeId &&
          // A character moves with text that left the paragraph, which changes it, or into one.
          (cached.target === undefined ||
            port.paragraphByNodeId(cached.address.nodeId)?.text === cached.target)
        ) {
          return cached.address;
        }
        const found = beside();
        if (found) {
          resolved.set(address.paragraphId + ':' + address.offset, {
            text: paragraph.text,
            address: found.address,
            target: found.text,
          });
          return found.address;
        }
        let before = texts.get(address.paragraphId);
        // The text the offset counts in is the author's. A peer's presence can arrive before
        // the edit it was published after, and treating this replica's older text as the
        // baseline then carried the offset across that edit a second time. So the baseline
        // is the first local text that matches the author's; until one does, the offset holds.
        if (before === undefined) {
          if (address.digest !== undefined && textDigest(paragraph.text) !== address.digest) {
            return Object.freeze({
              paragraphId: paragraph.paragraphId,
              nodeId: paragraph.nodeId,
              offset: Math.min(address.offset, paragraph.text.length),
            });
          }
          before = paragraph.text;
          texts.set(address.paragraphId, before);
        }
        const pair =
          before === paragraph.text
            ? ''
            : `${address.paragraphId}:${before.length}:${textDigest(before)}`;
        const alignable = pair === '' || aligned.has(pair) || aligned.size < MAX_ALIGNED_PAIRS;
        if (alignable && pair !== '') aligned.add(pair);
        const mapped = Object.freeze({
          paragraphId: paragraph.paragraphId,
          nodeId: paragraph.nodeId,
          offset: alignable
            ? mapOffsetAcrossText(address.offset, before, paragraph.text)
            : Math.min(address.offset, paragraph.text.length),
        });
        resolved.set(address.paragraphId + ':' + address.offset, {
          text: paragraph.text,
          address: mapped,
        });
        return mapped;
      };
      const anchor = resolve(from);
      const head = resolve(to);
      if (!anchor || !head) continue;
      selections.push(
        Object.freeze({
          actorId: payload.actorId,
          name: payload.name,
          ...(payload.color ? { color: payload.color } : {}),
          ...(payload.selection.kind === 'cells' ? { kind: 'cells' as const } : {}),
          anchor,
          head,
        })
      );
    }
    for (const clientId of this.baselines.keys()) {
      if (!present.has(clientId)) this.baselines.delete(clientId);
    }
    return Object.freeze(selections);
  }
}
