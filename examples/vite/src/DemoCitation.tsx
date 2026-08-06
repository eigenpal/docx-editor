// The demo's custom node, and the host-owned UI around it.
//
// One `defineCustomNode` call and everything that reads its payload: the card the chip
// opens, the actions inside the packaged review card, and the insert/edit form. Kept
// beside each other because they all speak the same schema — the definition is the only
// place the shape is written down.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { z } from 'zod';
import { useDocxEditor, type EditorCaret } from '@docx-editor.dev/react';
import { defineCustomNode, insertCustomNode, updateCustomNode } from '@docx-editor.dev/pro';
import { CustomNodeChrome, useReviewItem } from '@docx-editor.dev/pro/react';
import { sanitizeHref } from '@docx-editor.dev/core/store';
import { DEMO_PRIMARY_BUTTON, DEMO_SECONDARY_BUTTON, keepCaret } from './demoButtons';
import { useChipPopover } from '../../shared/useChipPopover';

/**
 * What a citation carries, as an ordinary zod schema.
 *
 * `w:tag` caps at 64 characters, so the tag holds the IDENTITY and nothing else — everything
 * below lives in a customXml data part the chip binds to, and comes back through this schema
 * already checked. A payload arrives from a file the sender wrote, so "already checked" is the
 * difference between reading `data.year` and guarding every field at every call site.
 */
export const CitationData = z.object({
  sourceId: z.string().min(1),
  locator: z.string(),
  authors: z.array(z.string()).max(64),
  year: z.number().int().gte(0).lte(3000),
  /** Optional, and the review card offers a thumbnail for it — behind a click. */
  url: z.url().optional(),
});
type CitationData = z.infer<typeof CitationData>;

export const DEMO_CITATION = defineCustomNode({
  name: 'citation',
  tagPrefix: 'docx',
  label: 'Citation',
  // HOST-authored chip appearance — CustomNodeChrome applies it.
  chrome: { color: '#7c3aed' },
  // The payload's shape. Checked on the way IN (a bad insert is refused, naming the field) and
  // on the way OUT (a tampered file reports through `onDiagnostic` below and the chip still
  // renders, without its data).
  schema: CitationData,
  // What the document SHOWS, from the payload — so the sentence cannot drift from the citation
  // it describes. This is why a write below passes `{ data }` and nothing else.
  text: (data) =>
    `(${data.authors[0] ?? 'Anon'} ${String(data.year)}${data.locator ? `, ${data.locator}` : ''})`,
  // The one thing worth putting in the tag as well: a reader who opens this file WITHOUT the
  // payload store can still tell which source it is.
  tagAttrs: (data) => ({ sourceId: data.sourceId }),
  // What happens to a citation in a file that leaves this system: the sentence keeps its words
  // and loses the markup that only means something here. Applied by `prepareForExport` (the
  // header's Export button), never by `save()` — so the document at rest keeps its chips.
  preserveOnExport: 'text',
  // Sidebar card. `data` is TYPED here — `CitationData`, because that is the schema above.
  reviewCard: ({ text, data }) => ({
    title: `Citation — ${data?.sourceId ?? 'unknown source'}`,
    detail: data
      ? `${data.authors.join(', ') || 'no authors'} (${String(data.year)})${data.locator ? `, ${data.locator}` : ''}`
      : text,
  }),
});

/**
 * Click a citation chip → a card, the custom-node `onClick` DX. Delegated on
 * the document: the chip's boundary layer opted back into pointer events (see
 * styles.css), its chrome layer carries the node's `w:tag`, and decoding that
 * tag is the whole lookup — attrs come straight from the document.
 */
/** What the citation card shows, and which chip it hangs off — owned by the demo root. */
export interface CitationCard {
  readonly attrs: Readonly<Record<string, string>>;
  /** The chip's payload. Everything but the source ID lives here now. */
  readonly data: unknown;
  /**
   * `preview` follows the pointer and carries no actions; `open` is the one a click pins, and is
   * the only one with a button. A card that appears on hover and asks to be clicked is a card
   * you have to chase.
   */
  readonly mode: 'preview' | 'open';
  /** The control this card belongs to, so it can re-anchor when the page scrolls. */
  readonly controlId: string | undefined;
}

/** One card for every opener: chip click, chip hover, and the context menu's Edit row. */
export function citationCardAt(
  node: {
    readonly attrs: Readonly<Record<string, string>>;
    readonly data?: unknown;
    readonly nodeId?: string;
  },
  mode: 'preview' | 'open'
): CitationCard {
  // No coordinates: `useChipPopover` names the chip and CSS places the card against it.
  return { attrs: node.attrs, data: node.data, mode, controlId: node.nodeId };
}

export function CitationPopover({
  card,
  onOpen,
  onClose,
}: {
  card: CitationCard | null;
  onOpen: (card: CitationCard) => void;
  onClose: () => void;
}) {
  // A pinned card stays pinned. Without this, hovering a neighbour swapped the card out from
  // under the pointer on its way to the button.
  const onHover = (next: CitationCard) => {
    if (card?.mode !== 'open') onOpen(next);
  };
  const { ref } = useChipPopover<HTMLDivElement>(card?.controlId, onClose);
  // A preview follows the pointer, so it leaves when the pointer does. A card a click pinned is
  // not a preview and stays.
  const previewing = card?.mode === 'preview';
  useEffect(() => {
    if (!previewing) return;
    const onOver = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[popover]') || target.closest('[data-docx-content-control]')) return;
      onClose();
    };
    document.addEventListener('pointerover', onOver, true);
    return () => document.removeEventListener('pointerover', onOver, true);
  }, [previewing, onClose]);
  const citation = card ? DEMO_CITATION.dataOf(card) : undefined;
  return (
    <>
      {/* Definitions default to the ones registered on the Root — register once,
          every surface (chip styling, context menu, review cards) follows. */}
      <CustomNodeChrome
        onNodeClick={(node) => onOpen(citationCardAt(node, 'open'))}
        // `onNodeHover` fires once per chip entered, so the preview follows the pointer across a
        // paragraph of citations. It never replaces a card a click has already pinned.
        onNodeHover={(node) => onHover(citationCardAt(node, 'preview'))}
      />
      {/* Always mounted, because `showPopover` needs an element to call it on. Empty and
          closed when there is no card. */}
      <div
        ref={ref}
        popover="manual"
        className="citation-card"
        role="dialog"
        aria-label="Citation details"
      >
        {card && !citation ? (
          <div style={{ color: '#64748b' }}>This citation carries no readable data.</div>
        ) : null}
        {citation ? (
          <>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              {citation.authors.join(', ') || 'Unknown author'}
            </div>
            <div style={{ color: '#475569' }}>
              {citation.year}
              {citation.locator ? `, ${citation.locator}` : ''}
            </div>
            <div
              style={{ marginTop: 8, font: '11px/1.4 ui-monospace, monospace', color: '#94a3b8' }}
            >
              {citation.sourceId}
            </div>
          </>
        ) : null}
        {card?.mode === 'open' ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              style={DEMO_PRIMARY_BUTTON}
              onMouseDown={keepCaret}
              onClick={() =>
                window.alert(`A real app opens source ${card.attrs['sourceId']} here.`)
              }
            >
              Open source
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
            Click the citation to open it
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Host-owned content INSIDE the packaged citation cards: children of
 * `<DocxEditorReview>` render in every card, and `useReviewItem()` says which
 * item the surrounding card is about — so this adds a button to citation cards
 * and stays out of comments and tracked changes.
 */
export function CitationCardActions() {
  const item = useReviewItem();
  // Which URLs this reader has agreed to load, for this session. Remembered so a card that
  // scrolls out and back does not ask again — and never persisted, because consent to fetch is
  // this reader's, not the document's.
  const [allowed, setAllowed] = useState<ReadonlySet<string>>(() => new Set());
  if (!item || item.kind !== 'custom' || item.item.kind !== 'custom') return null;
  // Collapsed until the card is ACTIVE — clicking a card activates it (and selects the
  // chip's text); clicking another card or pressing elsewhere deactivates it. The state
  // is already on the item, so active-only content is one condition, not new wiring.
  if (!item.isActive) return null;
  const attrs = item.item.attrs;
  const citation = DEMO_CITATION.dataOf(item.item);
  // THE URL IS THE SENDER'S. `sanitizeHref` is the allowlist — `javascript:`, `data:` and
  // `vbscript:` are well-formed URLs a schema is happy with and a browser will execute.
  const safe = citation?.url ? sanitizeHref(citation.url) : null;
  const href = safe?.ok ? safe.href : null;
  return (
    <div style={{ marginTop: 10 }}>
      {href ? (
        <CitationThumbnail
          href={href}
          loaded={allowed.has(href)}
          onLoad={() => setAllowed((previous) => new Set(previous).add(href))}
        />
      ) : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          style={DEMO_PRIMARY_BUTTON}
          onMouseDown={keepCaret}
          onClick={() => window.alert(`A real app opens source ${attrs['sourceId']} here.`)}
        >
          Open source
        </button>
      </div>
    </div>
  );
}

/**
 * The payload's URL as a badge — a PLACEHOLDER until the reader asks for it.
 *
 * NOTHING IS FETCHED ON OPEN. A remote URL in a document is a beacon: loading it tells whoever
 * wrote the file that this reader opened it, from this address, at this moment. So the card
 * shows the host and a button, and only a click turns it into an `<img>`. The href has already
 * been through `sanitizeHref`; this renders it as text and as a `src`, never as markup.
 */
function CitationThumbnail({
  href,
  loaded,
  onLoad,
}: {
  href: string;
  loaded: boolean;
  onLoad: () => void;
}) {
  const host = (() => {
    try {
      return new URL(href).host;
    } catch {
      return href;
    }
  })();
  if (loaded) {
    return (
      <img
        src={href}
        alt=""
        referrerPolicy="no-referrer"
        style={{ display: 'block', maxWidth: '100%', borderRadius: 6, border: '1px solid #e2e8f0' }}
      />
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        border: '1px dashed #cbd5e1',
        borderRadius: 6,
        font: '12px/1.4 system-ui, sans-serif',
        color: '#475569',
      }}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{host}</span>
      <button type="button" style={DEMO_SECONDARY_BUTTON} onMouseDown={keepCaret} onClick={onLoad}>
        Load preview
      </button>
    </div>
  );
}

/**
 * The insert form: what goes into the document before it goes in. A real app
 * renders its reference picker here; the shape is the whole demo — collect the
 * attrs, then ONE `insertCustomNode` call authors the locked, tagged chip at
 * the caret the menu row captured.
 */
/** Insert at a captured caret, or edit an existing node by its id. */
export type CitationFormState =
  | { readonly mode: 'insert'; readonly at: EditorCaret | null }
  | {
      readonly mode: 'edit';
      readonly nodeId: string;
      /** The node's current payload, so an edit starts from what the document says. */
      readonly data?: unknown;
    };

export function CitationDialog({
  form,
  onClose,
}: {
  form: CitationFormState;
  onClose: () => void;
}) {
  const editor = useDocxEditor();
  const editing = form.mode === 'edit';
  // The payload the document already holds, typed by the definition's own schema. Everything
  // but `sourceId` comes from here rather than from the tag: 64 characters is not a bibliography.
  const current = editing ? DEMO_CITATION.dataOf(form) : undefined;
  const [sourceId, setSourceId] = useState(
    () => current?.sourceId ?? `src_${Date.now().toString(36)}`
  );
  const [locator, setLocator] = useState(() => current?.locator ?? 'p.42');
  const [authors, setAuthors] = useState(() =>
    (current?.authors ?? ['Smith, J.', 'Okonkwo, A.']).join(', ')
  );
  const [year, setYear] = useState(() => String(current?.year ?? 2024));
  const [url, setUrl] = useState(() => current?.url ?? '');
  const field: CSSProperties = {
    display: 'block',
    width: '100%',
    marginTop: 4,
    padding: '6px 8px',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    font: '13px/1.4 system-ui, sans-serif',
  };
  const labelStyle: CSSProperties = {
    display: 'block',
    marginTop: 10,
    font: '12px/1.4 system-ui, sans-serif',
    color: '#475569',
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Edit citation' : 'Insert citation'}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(15, 23, 42, 0.35)',
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        style={{
          width: 340,
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 48px rgba(15, 23, 42, 0.25)',
          padding: '16px 18px',
          color: '#0f172a',
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!editor) return;
          // Chips are content-locked, so persistence goes through the node APIs. The payload is
          // the WHOLE argument: `text` and `tagAttrs` on the definition compute what the
          // document shows and what rides in the tag, and the schema validates on the way in —
          // so a bad year is refused here rather than saved and rejected on the next open.
          const data = {
            sourceId,
            locator,
            authors: authors
              .split(',')
              .map((name) => name.trim())
              .filter((name) => name.length > 0),
            year: Number(year),
            ...(url.trim() ? { url: url.trim() } : {}),
          };
          const result = editing
            ? updateCustomNode(editor, DEMO_CITATION, form.nodeId, { data, alias: 'Citation' })
            : insertCustomNode(editor, DEMO_CITATION, {
                data,
                alias: 'Citation',
                ...(form.at ? { at: form.at } : {}),
              });
          if (!result.ok) window.alert(`${editing ? 'Edit' : 'Insert'} refused: ${result.reason}`);
          onClose();
        }}
      >
        <div style={{ font: '600 15px/1.4 system-ui, sans-serif' }}>
          {editing ? 'Edit citation' : 'Insert citation'}
        </div>
        <div style={{ marginTop: 4, font: '12px/1.5 system-ui, sans-serif', color: '#64748b' }}>
          The definition derives what the paragraph shows from these fields, so there is no separate
          label to keep in step. Only the source ID rides in the chip&#39;s tag; the rest is a
          payload in a customXml data part, checked against the schema and handed back typed on
          click, hover, and the review card.
        </div>
        <label style={labelStyle}>
          Source ID
          <input
            style={field}
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            required
          />
        </label>
        <label style={labelStyle}>
          Locator
          <input style={field} value={locator} onChange={(e) => setLocator(e.target.value)} />
        </label>
        <label style={labelStyle}>
          Authors (comma separated)
          <input style={field} value={authors} onChange={(e) => setAuthors(e.target.value)} />
        </label>
        <label style={labelStyle}>
          Year
          <input
            style={field}
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            required
          />
        </label>
        <label style={labelStyle}>
          URL (optional)
          <input
            style={field}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/paper.pdf"
          />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" style={DEMO_SECONDARY_BUTTON} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" style={DEMO_PRIMARY_BUTTON}>
            {editing ? 'Save' : 'Insert'}
          </button>
        </div>
      </form>
    </div>
  );
}
