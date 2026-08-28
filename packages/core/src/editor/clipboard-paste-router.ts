// Paste flavour routing (rich-clipboard-fidelity task 4.1).
//
// Fidelity order: internal fragment, then external `text/html`, then `text/plain` — and
// the degrade is CONTINUOUS: a payload that fails decoding, fails the bounded package
// read, or is refused at apply falls to the next flavour instead of leaving a no-op
// paste. Suggesting mode and non-body stories force the plain lane, whose tracked-write
// behaviour already exists; the drop lane never routes through here.

import { fragmentFromHtml } from './clipboard-fragment-codec.ts';
import { projectExternalHtml } from './clipboard-html-read.ts';

export interface PasteRouteTarget {
  /** True when a fragment landing is even possible: body story, edit mode. */
  readonly richLaneOpen: boolean;
  /** Land a fragment package; false means refused (any reason) and the router degrades. */
  pasteFragment(
    bytes: Uint8Array,
    lastMarkCovered: boolean,
    lane: 'fragment' | 'external-html'
  ): boolean;
  insertPlainText(text: string): void;
}

export interface PasteRouteInput {
  readonly html: string | null;
  readonly text: string;
  /** Cmd+Shift+V or the pasteWithoutFormatting command: plain lane, no questions. */
  readonly forcePlain: boolean;
}

export type PasteRouteLane = 'fragment' | 'external-html' | 'plain' | 'none';

/** Route one paste payload; reports the lane that actually landed. */
export function routePaste(target: PasteRouteTarget, input: PasteRouteInput): PasteRouteLane {
  const plain = (): PasteRouteLane => {
    if (input.text.length === 0) return 'none';
    target.insertPlainText(input.text);
    return 'plain';
  };

  if (input.forcePlain || !target.richLaneOpen) return plain();
  const html = input.html;
  if (html === null || html.length === 0) return plain();

  const embedded = fragmentFromHtml(html);
  if (embedded && target.pasteFragment(embedded.bytes, embedded.lastMarkCovered, 'fragment')) {
    return 'fragment';
  }

  const projected = projectExternalHtml(html);
  if (
    projected.ok &&
    target.pasteFragment(projected.fragmentBytes, projected.lastMarkCovered, 'external-html')
  ) {
    return 'external-html';
  }

  return plain();
}
