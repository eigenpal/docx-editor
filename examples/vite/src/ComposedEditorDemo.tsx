// The FLAGSHIP demo: the provider-first composition API, end to end.
//
// Everything on screen is composed under `<DocxEditor.Root>`: the library's compound
// toolbar (the FULL chrome registry by default, with the FontFamily slot overridden in
// place by a composed picker), the library's compound MENU BAR (with a demo-owned row
// appended into File and the whole Help menu replaced), and a demo-owned header shell
// around them — brand, title, status, Open/New/Save buttons, the perf HUD — built from
// nothing but the public hooks (`useDocxEditor`, `useEditorEvent`, `useFontFamily`).
// Between them they show both halves of the contract: packaged chrome you customize in
// place, and arbitrary React that composes under Root.
//
// The library chrome's styling comes from the CORE stylesheet (`docx-toolbar` and
// `docx-menubar` families); this demo styles only its own header.

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import {
  DocxEditor,
  useDocxEditor,
  useDocxSource,
  useEditorCaret,
  useEditorEvent,
  useFontFamily,
  type EditorCaret,
} from '@docx-editor.dev/react';
// PRO: comments + tracked changes ship in @docx-editor.dev/pro. Register the
// review module on the Root and mount the pane; without the module the same
// document still opens (final-state view) and the review toolbar controls
// disable with the engine's own "requires the pro review module" reason.
import {
  customNodesModule,
  defineCustomNode,
  exportCustomNodes,
  insertCustomNode,
  reviewModule,
  updateCustomNode,
} from '@docx-editor.dev/pro';
import {
  CustomNodeChrome,
  CustomNodeContextMenu,
  DocxEditorReview,
  useReviewItem,
} from '@docx-editor.dev/pro/react';
import { blankDocumentBytes } from '@docx-editor.dev/core/editor';
import { sanitizeHref } from '@docx-editor.dev/core/store';
import { defaultFonts } from '@docx-editor.dev/fonts';
import { BrandLogo } from '../../shared/BrandLogo';
// import { AdapterSwitcher } from '../../shared/AdapterSwitcher';
import { ExampleSwitcher } from '../../shared/ExampleSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { DrawingsE2eBridge } from './DrawingsE2eBridge';
import { DEMO_BUTTON, DEMO_PRIMARY_BUTTON, DEMO_SECONDARY_BUTTON } from './demoButtons';

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a citation carries, as an ordinary zod schema.
 *
 * `w:tag` caps at 64 characters, so the tag holds the IDENTITY and nothing else — everything
 * below lives in a customXml data part the chip binds to, and comes back through this schema
 * already checked. A payload arrives from a file the sender wrote, so "already checked" is the
 * difference between reading `data.year` and guarding every field at every call site.
 */
const CitationData = z.object({
  sourceId: z.string().min(1),
  locator: z.string(),
  authors: z.array(z.string()).max(64),
  year: z.number().int().gte(0).lte(3000),
  /** Optional, and the review card offers a thumbnail for it — behind a click. */
  url: z.url().optional(),
});
type CitationData = z.infer<typeof CitationData>;

const DEMO_CITATION = defineCustomNode({
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
  // and loses the markup that only means something here. Applied by `exportCustomNodes` (the
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
 * The pro capabilities this demo registers. One stable array — module registration is
 * construction-time (like `mode`), so the identity must not change per render.
 * `reviewModule()` enables markup rendering, suggesting mode, and the review pane;
 * `customNodesModule` shows `defineCustomNode`: an inline content control tagged
 * `docx:citation?...` is recognized as a typed node carrying the payload above (open
 * e2e/fixtures/sdt-custom-tag-original.docx to see one). Both accept `{ licenseKey }` —
 * optional while licensing is honor-system.
 */
const PRO_MODULES = [
  reviewModule(),
  customNodesModule({
    nodes: [DEMO_CITATION],
    // A payload comes from a file the sender wrote, so a mismatch is an ordinary property of an
    // ordinary document rather than a bug. The chip still renders; this is how the host finds
    // out its data is missing.
    onDiagnostic: (diagnostic) => {
      console.warn(`custom node ${diagnostic.name}: ${diagnostic.issues.join(', ')}`);
    },
  }),
];

/** Keep the caret: chrome mousedown must never move focus out of the document. */
function keepCaret(event: ReactMouseEvent): void {
  event.preventDefault();
}

/** Hand DOCX bytes to the browser as a download. */
function downloadDocx(bytes: ArrayBuffer | Uint8Array, name: string): void {
  // `BlobPart`, not `ArrayBuffer`: `exportCustomNodes` answers a `Uint8Array`, and casting its
  // `.buffer` would hand the browser the whole backing store rather than the view — silently
  // corrupt for any view with an offset or a shorter length.
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar customization: the in-place FontFamily override with typeface previews
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Custom items for the FontFamily popup: each offerable font as a single-line row
 * rendered in its own typeface, reference-picker style (the selected row gets the
 * library's right-aligned check). Options come from `useFontFamily()` — the editor's
 * configured catalog merged with the document's declared fonts, so a brand-new
 * document still lists real choices; the list follows edits.
 */
function FontPreviewItems() {
  const { options } = useFontFamily();
  if (options.length === 0) {
    return <div className="demo-font-empty">No fonts declared in this document</div>;
  }
  return (
    <>
      {options.map((family) => (
        <DocxEditor.Toolbar.FontFamily.Item key={family} value={family} className="demo-font-item">
          <span className="demo-font-item__name" style={{ fontFamily: family }}>
            {family}
          </span>
        </DocxEditor.Toolbar.FontFamily.Item>
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Perf HUD: the surface's own pass timings, bottom-left, chip-collapsed
// ─────────────────────────────────────────────────────────────────────────────

/** `4.2ms` under ten, whole milliseconds above — small numbers are where tenths matter. */
const ms = (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)}ms`;

/** The last pass's readout, pre-formatted; `key` makes value equality one compare. */
interface PerfRow {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** Plain-language explanation of what the metric tracks, shown as the row tooltip. */
  readonly tip: string;
  readonly muted?: boolean;
}

interface PerfReading {
  key: string;
  rows: readonly PerfRow[];
}

const PERF_TIPS = {
  layout:
    'Engine time placing paragraphs into pages for the last pass. placed N/M = paragraphs re-laid-out vs. total in the document; reused = pages carried over untouched from the previous layout.',
  paint: 'Engine time building and swapping the page DOM for the pages the pass changed.',
  selection: 'Engine time writing the model selection (caret/highlight) back into the browser.',
  frame:
    "Browser time from the commit to the frame it actually presented — the browser's own style, layout and composite after the DOM swap. Measured with a double requestAnimationFrame stamp.",
  input:
    'Keystroke to next paint, from the Event Timing API. delay = how long the event sat queued before its handler ran. The browser only reports events over 16ms, so quiet typing may not update this.',
  stale: 'Layout passes discarded because the document changed again before they could publish.',
  fonts:
    'Which measurer produced this layout. shaped = HarfBuzz over real font bytes (Word-accurate wrap points); fixed = monospace estimate, the zero-config fallback.',
  rev: 'Document revision — the number of committed transactions this session.',
} as const;

/**
 * The surface perf readout: layout / paint / selection
 * timings with the reuse counters, straight off the surface's own `state().perf`.
 * `editor.surface` is the DocxEditorInstance escape hatch — fine for a demo HUD.
 *
 * `perf` is deliberately NOT part of the facade snapshot (it moves on every pass and
 * would break the snapshot identity contract), so the snapshot pattern can never see
 * it — the HUD reads the surface on its OWN clock instead: a re-read after commits
 * and selection moves (`useEditorEvent`), plus a light poll while expanded to catch
 * paint-only passes (scroll rematerialization) that fire no facade event at all.
 * The value-equality guard means re-renders track changed numbers, not the clock,
 * and the collapsed chip neither polls nor re-renders. Collapsed it is a small
 * circular document chip on the outline toggle's disc recipe.
 */
/**
 * Click a citation chip → a card, the custom-node `onClick` DX. Delegated on
 * the document: the chip's boundary layer opted back into pointer events (see
 * styles.css), its chrome layer carries the node's `w:tag`, and decoding that
 * tag is the whole lookup — attrs come straight from the document.
 */
/** Where the citation card opens, and for which attrs — owned by the demo root. */
export interface CitationCard {
  readonly x: number;
  readonly y: number;
  readonly attrs: Readonly<Record<string, string>>;
  /** The chip's payload. Everything but the source ID lives here now. */
  readonly data: unknown;
}

/** One card position rule for every opener: chip click and the context menu's Edit row. */
function citationCardAt(node: {
  readonly rect: DOMRect;
  readonly attrs: Readonly<Record<string, string>>;
  readonly data?: unknown;
}): CitationCard {
  return { x: node.rect.left, y: node.rect.bottom + 8, attrs: node.attrs, data: node.data };
}

function CitationPopover({
  card,
  onOpen,
  onClose,
}: {
  card: CitationCard | null;
  onOpen: (card: CitationCard) => void;
  onClose: () => void;
}) {
  // Close when a click lands outside the card (chip clicks reopen through the API).
  useEffect(() => {
    if (!card) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !target?.closest('[role="dialog"]') &&
        !target?.closest('.docx-content-control-boundary')
      ) {
        onClose();
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [card, onClose]);
  const chrome = (
    // Definitions default to the ones registered on the Root — register once,
    // every surface (chip styling, context menu, review cards) follows.
    <CustomNodeChrome
      onNodeClick={(node) => onOpen(citationCardAt(node))}
      // Hover shows the same card. `onNodeHover` fires once per chip entered, so the card
      // follows the pointer across a paragraph of citations without a click.
      onNodeHover={(node) => onOpen(citationCardAt(node))}
    />
  );
  if (!card) return chrome;
  return (
    <>
      {chrome}
      <div
        role="dialog"
        aria-label="Citation details"
        style={{
          position: 'fixed',
          left: card.x,
          top: card.y,
          zIndex: 60,
          minWidth: 260,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)',
          padding: '12px 14px',
          font: '13px/1.5 system-ui, sans-serif',
          color: '#0f172a',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          📖 {DEMO_CITATION.dataOf(card)?.sourceId ?? 'Citation'}
        </div>
        <div style={{ color: '#475569' }}>
          <div>
            Source: <code>{card.attrs['sourceId'] ?? '—'}</code>
          </div>
          {/* From the PAYLOAD, not the tag — only the source ID rides in `w:tag` now. */}
          <div>Locator: {DEMO_CITATION.dataOf(card)?.locator || '—'}</div>
          <div>Year: {DEMO_CITATION.dataOf(card)?.year ?? '—'}</div>
        </div>
        <button
          type="button"
          style={{ ...DEMO_PRIMARY_BUTTON, marginTop: 10 }}
          onClick={() => {
            window.alert(`A real app opens source ${card.attrs['sourceId']} here.`);
            onClose();
          }}
        >
          Open source
        </button>
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
function CitationCardActions() {
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

function CitationDialog({ form, onClose }: { form: CitationFormState; onClose: () => void }) {
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

function PerfHud() {
  const editor = useDocxEditor();
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const [reading, setReading] = useState<PerfReading | null>(null);

  // Browser-side numbers the engine cannot see: how long the browser took to PRESENT
  // the frame after a commit's DOM swap, and keystroke-to-paint via the Event Timing
  // API. Held in refs so measurement never re-renders on its own; `refresh` folds the
  // latest values into the reading.
  const frameMsRef = useRef<number | null>(null);
  const inputRef = useRef<{ readonly durationMs: number; readonly delayMs: number } | null>(null);

  const refresh = useCallback(() => {
    if (!openRef.current) return;
    const state = editor?.surface?.state();
    if (!state) return;
    const { perf } = state;
    const frameMs = frameMsRef.current;
    const input = inputRef.current;
    const fontState = editor?.fontMeasurement();
    const fontValue = fontState ? (fontState.resolving ? 'resolving…' : fontState.measurer) : '';
    const key = [
      perf.layoutMs,
      perf.paintMs,
      perf.selectionMs,
      perf.placed,
      perf.total,
      perf.reusedPages,
      perf.staleDiscards,
      state.revision,
      frameMs?.toFixed(1) ?? '',
      input ? `${input.durationMs.toFixed(0)}/${input.delayMs.toFixed(1)}` : '',
      fontValue,
    ].join('|');
    setReading((previous) => {
      if (previous?.key === key) return previous;
      const rows: PerfRow[] = [
        {
          id: 'layout',
          label: 'layout',
          value: `${ms(perf.layoutMs)} (placed ${perf.placed}/${perf.total}, reused ${perf.reusedPages})`,
          tip: PERF_TIPS.layout,
        },
        { id: 'paint', label: 'paint', value: ms(perf.paintMs), tip: PERF_TIPS.paint },
        {
          id: 'selection',
          label: 'selection',
          value: ms(perf.selectionMs),
          tip: PERF_TIPS.selection,
        },
      ];
      if (frameMs !== null) {
        rows.push({ id: 'frame', label: 'dom frame', value: ms(frameMs), tip: PERF_TIPS.frame });
      }
      if (input) {
        rows.push({
          id: 'input',
          label: 'input',
          value: `${ms(input.durationMs)} (delay ${ms(input.delayMs)})`,
          tip: PERF_TIPS.input,
        });
      }
      if (perf.staleDiscards > 0) {
        rows.push({
          id: 'stale',
          label: 'stale',
          value: String(perf.staleDiscards),
          tip: PERF_TIPS.stale,
        });
      }
      if (fontValue) {
        rows.push({
          id: 'fonts',
          label: 'fonts',
          value: fontValue,
          tip: PERF_TIPS.fonts,
          muted: fontValue === 'fixed',
        });
      }
      rows.push({
        id: 'rev',
        label: 'rev',
        value: String(state.revision),
        tip: PERF_TIPS.rev,
        muted: true,
      });
      return { key, rows };
    });
  }, [editor]);

  // Commit -> presented frame: stamped at the change event, resolved after two animation
  // frames (the first fires once the task's DOM work is done, the second after the frame
  // the browser actually painted).
  const measureFrame = useCallback(() => {
    if (!openRef.current) return;
    const began = performance.now();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        frameMsRef.current = performance.now() - began;
        refresh();
      });
    });
  }, [refresh]);

  // Commits and selection moves re-read right away; the pass they announce may still
  // be in flight, and the poll below picks up its numbers when it lands.
  useEditorEvent('change', refresh);
  useEditorEvent('change', measureFrame);
  useEditorEvent('selectionChange', refresh);

  // Keystroke-to-paint, only while expanded. `durationThreshold` 16 is the API minimum;
  // entries report the full hardware-input -> next-paint span plus the queuing delay.
  useEffect(() => {
    if (!open) return undefined;
    if (
      typeof PerformanceObserver === 'undefined' ||
      !PerformanceObserver.supportedEntryTypes?.includes('event')
    ) {
      return undefined;
    }
    const observer = new PerformanceObserver((list) => {
      let latest: PerformanceEventTiming | null = null;
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (entry.name === 'keydown' || entry.name === 'beforeinput' || entry.name === 'input') {
          latest = entry;
        }
      }
      if (latest) {
        inputRef.current = {
          durationMs: latest.duration,
          delayMs: latest.processingStart - latest.startTime,
        };
        refresh();
      }
    });
    observer.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
    return () => observer.disconnect();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return undefined;
    refresh();
    const id = window.setInterval(refresh, 500);
    return () => window.clearInterval(id);
  }, [open, refresh]);

  if (!editor) return null;
  return (
    <div
      className="absolute bottom-3 left-3 z-50 flex flex-col items-start gap-2"
      data-testid="composed-perf"
    >
      {open && reading ? (
        <dl
          className="m-0 whitespace-nowrap rounded-lg border border-[var(--doc-border)] bg-[var(--doc-surface)] px-3 py-2 text-[11.5px] leading-[18px] text-[var(--doc-text)] shadow-[var(--doc-shadow-lg)] [font-variant-numeric:tabular-nums]"
          role="status"
        >
          {reading.rows.map((row) => (
            <div key={row.id} className="flex cursor-help items-baseline gap-2.5" title={row.tip}>
              <dt className="w-16 flex-none text-[var(--doc-text-muted)]">{row.label}</dt>
              <dd className={`m-0${row.muted ? ' text-[var(--doc-text-muted)]' : ''}`}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <button
        type="button"
        className="docx-outline-toggle"
        aria-label={open ? 'Hide performance metrics' : 'Show performance metrics'}
        title={open ? 'Hide performance metrics' : 'Show performance metrics'}
        aria-expanded={open}
        onMouseDown={keepCaret}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 -960 960 960" width={18} height={18} aria-hidden="true">
          <path
            d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The chrome under Root: header (demo-owned) + the library toolbar
// ─────────────────────────────────────────────────────────────────────────────

function EditorChrome({
  title,
  onTitleChange,
  colorMode,
  onColorModeChange,
  onInsertCitation,
}: {
  title: string;
  onTitleChange: (next: string) => void;
  colorMode: 'light' | 'dark';
  onColorModeChange: (next: 'light' | 'dark') => void;
  onInsertCitation: (at: EditorCaret | null) => void;
}) {
  const editor = useDocxEditor();
  // Where the caret is, as a paragraph and an offset — the shape the write APIs take as
  // their `at`. `snapshot.selection` cannot answer this (it addresses paragraphs by id and
  // carries no offsets), and reading it used to mean reaching into `editor.surface`, an
  // escape hatch documented for chrome. The value is reference-stable, so capturing it in
  // a menu handler is safe.
  const caret = useEditorCaret();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showPageSetup, setShowPageSetup] = useState(false);

  const openFile = (file: File) => {
    // The title follows the opened file, so the header names the document actually
    // on screen — and the download the Save button writes names itself after it too.
    onTitleChange(file.name.replace(/\.docx$/i, ''));
    void file.arrayBuffer().then((buffer) => {
      editor?.load(new Uint8Array(buffer));
    });
  };
  const newDocument = () => editor?.load(blankDocumentBytes());
  const saveDocument = () => {
    void editor?.save().then((buffer) => {
      const base = title.trim() || 'document';
      downloadDocx(buffer, `${base}.docx`);
    });
  };
  /**
   * The same document, with `preserveOnExport` applied.
   *
   * A SEPARATE PIPELINE from Save, which is the whole point of the option: the saved file keeps
   * its chips so reopening it here gives them back, and the exported one carries whatever the
   * definitions said should travel. The demo's citation is `'text'`, so the words survive and
   * the tag, the binding and the payload do not.
   *
   * It removes THIS LIBRARY's markup and nothing else — `docProps`, comment authors and rsids
   * are untouched, so the result is not an anonymous document and must not be described as one.
   */
  const exportDocument = () => {
    void editor?.save().then((buffer) => {
      const exported = exportCustomNodes(new Uint8Array(buffer), [DEMO_CITATION]);
      if (!exported.ok) {
        window.alert(`Export refused: ${exported.reason}`);
        return;
      }
      const base = title.trim() || 'document';
      downloadDocx(exported.bytes, `${base}-exported.docx`);
    });
  };

  return (
    // The chrome surface is header + toolbar ONLY: its seam (border + shadow)
    // closes directly under the toolbar pill. The horizontal-ruler row renders
    // BELOW the seam, on the gray workspace background — the chrome spec
    // treats the ruler as workspace furniture, not header surface.
    <div className="demo-chrome">
      <header className="demo-header">
        <div className="demo-header__left">
          <BrandLogo />
          {/* Temporarily hidden: <AdapterSwitcher current="react" /> */}
          <ExampleSwitcher current="Vite" />
        </div>

        {/* Title with the LIBRARY menu bar beneath, Docs-style.

            `DocxEditor.Menu` is the packaged bar: every row is a chrome slot, so it
            shares its label, icon, command and enabled state with the toolbar control
            for the same capability, and a row the engine cannot honour yet shows the
            engine's own reason. Two customizations demonstrate the ladder:

            - a demo-owned "New" row appended into the File menu by name;
            - the whole Help menu replaced in place, because documentation is the
              product's, not the library's.

            Open is handled by the demo (it already owns the file input the Open DOCX
            button uses); Save routes to the same download the header button runs. */}
        <div className="demo-header__title-block">
          <input
            className="demo-title"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            aria-label="Document title"
            spellCheck={false}
          />
          <DocxEditor.Menu
            onOpen={() => fileInputRef.current?.click()}
            onSave={saveDocument}
            onPageSetup={() => setShowPageSetup(true)}
          >
            {/* preset={false}: the demo wants New BETWEEN Open and Save, and stating the
                order is clearer than merging into it. */}
            <DocxEditor.Menu.File preset={false}>
              <DocxEditor.Menu.Open />
              <DocxEditor.Menu.Row onSelect={newDocument} disabled={!editor}>
                New
              </DocxEditor.Menu.Row>
              <DocxEditor.Menu.Save />
              <DocxEditor.Menu.Separator />
              <DocxEditor.Menu.PageSetup />
            </DocxEditor.Menu.File>
            {/* Row-level override: the packaged rows stay, one is swapped in place. */}
            <DocxEditor.Menu.Insert>
              <DocxEditor.Menu.Row
                icon={<span aria-hidden="true">✎</span>}
                onSelect={() => window.alert('A host action, in the packaged menu.')}
              >
                Clause library
              </DocxEditor.Menu.Row>
            </DocxEditor.Menu.Insert>
            {/* Help is the host's: drop the packaged report row, keep the menu. */}
            <DocxEditor.Menu.Help>
              <DocxEditor.Menu.ReportIssue hidden />
              <a
                className="docx-toolbar__menu-item docx-menubar__item"
                href="https://docx-editor.dev/docs"
                target="_blank"
                rel="noreferrer"
                role="menuitem"
              >
                <span className="docx-menubar__item-icon" aria-hidden="true" />
                <span className="docx-menubar__item-label">Documentation</span>
              </a>
            </DocxEditor.Menu.Help>
            {/* A menu the library knows nothing about, with the host's own id and
                label — here it carries the PRO custom-node insert: one call authors
                a tagged, sdtLocked content control at the caret. In this editor it
                is a recognized citation chip; in Word it is a locked control
                showing the literal label. */}
            <DocxEditor.Menu.Menu id="my-menu" label="My Menu">
              {/* `Menu.Group` is a real `role="group"` taking its heading as the accessible
                  name, so rows a product ADDS are visibly its own without a hand-rolled
                  heading breaking the menu's ownership of its items. */}
              <DocxEditor.Menu.Group label="Custom elements">
                <DocxEditor.Menu.Row
                  onSelect={() => {
                    if (!editor) return;
                    // Capture the caret NOW: the dialog's inputs take focus, and inserting
                    // at "wherever the selection is by then" lands the chip wrong.
                    onInsertCitation(caret);
                  }}
                >
                  Insert citation
                </DocxEditor.Menu.Row>
              </DocxEditor.Menu.Group>
            </DocxEditor.Menu.Menu>
          </DocxEditor.Menu>
        </div>

        <div className="demo-header__right">
          <ThemeToggle value={colorMode} onChange={onColorModeChange} />
          <button
            type="button"
            style={DEMO_PRIMARY_BUTTON}
            disabled={!editor}
            onMouseDown={keepCaret}
            onClick={() => fileInputRef.current?.click()}
          >
            Open DOCX
          </button>
          <button
            type="button"
            style={DEMO_SECONDARY_BUTTON}
            disabled={!editor}
            onMouseDown={keepCaret}
            onClick={newDocument}
          >
            New
          </button>
          <button
            type="button"
            style={DEMO_SECONDARY_BUTTON}
            disabled={!editor}
            onMouseDown={keepCaret}
            onClick={exportDocument}
            title="Save with preserveOnExport applied: the citation's words stay, its tag, binding and payload go"
          >
            Export
          </button>
          <button
            type="button"
            style={DEMO_BUTTON}
            disabled={!editor}
            onMouseDown={keepCaret}
            onClick={saveDocument}
          >
            Save
          </button>
        </div>
      </header>

      {/* Opening a document is a FILE READ the user drives — never a fetched URL. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) openFile(file);
          // Cleared so choosing the SAME file twice fires a change event again.
          event.target.value = '';
        }}
      />

      {/* The LIBRARY toolbar: the FULL chrome registry by default. One slot is
          customized IN PLACE to show override semantics: FontFamily renders each
          document-derived family in its own typeface. Save is
          live because the toolbar was given an onSave handler. */}
      <DocxEditor.Toolbar className="demo-toolbar" onSave={saveDocument}>
        <DocxEditor.Toolbar.FontFamily>
          <DocxEditor.Toolbar.FontFamily.Trigger className="demo-font-trigger" />
          <DocxEditor.Toolbar.FontFamily.Content className="demo-font-menu">
            <FontPreviewItems />
          </DocxEditor.Toolbar.FontFamily.Content>
        </DocxEditor.Toolbar.FontFamily>
      </DocxEditor.Toolbar>

      {/* Word-style compatibility bar when document fonts render in substitutes. */}
      <DocxEditor.FontNotice />

      {/* File > Page setup: the library dialog, applied as one undo step. */}
      <DocxEditor.PageSetupDialog open={showPageSetup} onClose={() => setShowPageSetup(false)} />
    </div>
  );
}

/**
 * The context-fed horizontal ruler: the first workspace row, sitting on the gray
 * `--doc-bg` BELOW the chrome seam, centered over the page column. It follows an
 * open navigation pane on its own — the part reads the pane's published shift —
 * so this row carries no pane-aware class of its own.
 */
function RulerRow() {
  // NOT `aria-hidden`: the ruler carries four operable indent sliders, and hiding the row
  // from assistive tech would hide them along with it.
  return (
    <div className="demo-ruler-row">
      <DocxEditor.HorizontalRuler />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The demo surface
// ─────────────────────────────────────────────────────────────────────────────

export function ComposedEditorDemo({ fixtureUrl }: { fixtureUrl: string }) {
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');
  // Named after the document it opens with, and after whichever file is opened later.
  const [title, setTitle] = useState(
    () =>
      fixtureUrl
        .split('/')
        .pop()
        ?.replace(/\.docx$/i, '') ?? 'Document'
  );
  const [showOutline, setShowOutline] = useState(false);
  // The citation details card, owned HERE so both openers share it: a click on the chip
  // (`CustomNodeChrome.onNodeClick`) and the context menu's Edit row (`onEditNode`).
  const [citationCard, setCitationCard] = useState<CitationCard | null>(null);
  const closeCitationCard = useCallback(() => setCitationCard(null), []);
  // The insert/edit FORM — My Menu inserts at the captured caret, the context menu's
  // Edit row rewrites the node in place via `updateCustomNode`.
  const [citationForm, setCitationForm] = useState<CitationFormState | null>(null);
  const closeCitationForm = useCallback(() => setCitationForm(null), []);

  // The whole boot in ONE call: fetch the fixture, load Word's default substitute faces
  // (Carlito for Calibri, Liberation Serif for Times, …), register them for paint, compose
  // the configuration, and cancel both if this unmounts.
  //
  // The hook holds `document` back until fonts SETTLE — resolved or failed — because layout
  // measures with them: handing the editor bytes first paginates the whole document on the
  // fixed fallback and then re-paginates, which reads as the text jumping. A font failure
  // still releases it, and the editor opens on the fixed measurer, the documented
  // degradation.
  const {
    document: bytes,
    fonts,
    error: loadError,
  } = useDocxSource(fixtureUrl, { fonts: defaultFonts });

  return (
    <div
      className={`ep-root demo-app${colorMode === 'dark' ? ' dark' : ''}`}
      data-testid="composed-mount"
    >
      {bytes ? (
        // Authoring is ambient: comments and tracked changes take their `@w:author` from
        // `author`, the way the Office JS API sources it from context. A real app supplies
        // the signed-in user; a demo supplies a name so replies can be written at all.
        <DocxEditor.Root
          document={bytes}
          author="Demo Reviewer"
          modules={PRO_MODULES}
          {...(fonts ? { fonts } : {})}
          onFontError={(error) => console.warn(`[fonts] ${error.code}: ${error.message}`)}
        >
          <EditorChrome
            title={title}
            onTitleChange={setTitle}
            colorMode={colorMode}
            onColorModeChange={setColorMode}
            onInsertCitation={(at) => setCitationForm({ mode: 'insert', at })}
          />
          <RulerRow />
          {/* The viewport stays FULL-WIDTH so the vertical ruler (an absolute
              child of the scroll container, pinned at left: 0) never moves. The
              navigation pane floats over the gutter to the LEFT of the centered
              page and moves the document only when the window is too narrow to
              hold both — it owns that measurement, so the demo supplies nothing
              but the positioned row it anchors to. */}
          <div className="demo-main">
            <DocxEditor.Navigation
              open={showOutline}
              onOpenChange={setShowOutline}
              paneWidth={280}
            />
            <DocxEditor.Viewport className="demo-viewport">
              {/* The vertical ruler rides INSIDE the scroll container as an
                  absolutely positioned child, so it scrolls with the document and
                  its top offset lines up with the first page's top edge. */}
              <div className="demo-vruler" aria-hidden="true">
                <DocxEditor.VerticalRuler />
              </div>
              {/* Furniture / note chrome — sugar `<DocxEditor chrome>` mounts these; a
                  composed tree must place them by name or enter/exit has no overlay UI. */}
              <DocxEditor.HeaderFooterChrome />
              <DocxEditor.NotesChrome />
              <DocxEditor.Content />
              {/* The right-click menu, with the PRO custom-node section on top: pointing
                  at a citation chip shows its data and "Edit Citation" above the packaged
                  rows. Chips are content-locked, so the menu is the editing entry point. */}
              <DocxEditor.ContextMenu>
                <CustomNodeContextMenu
                  onEditNode={(node) =>
                    node.nodeId
                      ? setCitationForm({
                          mode: 'edit',
                          nodeId: node.nodeId,
                          data: node.data,
                        })
                      : setCitationCard(citationCardAt(node))
                  }
                />
              </DocxEditor.ContextMenu>
              <DrawingsE2eBridge />
              {/* The link popover. Inside the viewport so it stays with the page while
                  scrolling. `<DocxEditor>` mounts it for you; a composition like this one
                  places it by name, exactly like the rulers above. */}
              <DocxEditor.HyperLink />
              {/* The review rail (PRO): tracked changes and comments as cards beside the
                  page, with accept / reject / reply. Imported from
                  `@docx-editor.dev/pro/react` and enabled by the `reviewModule()` on the
                  Root. Inside the viewport for the same reason as the popover — it
                  scrolls with the document rather than chasing it. */}
              <DocxEditorReview card={{ className: 'demo-review-card' }}>
                {/* Host content inside every card: `useReviewItem()` scopes it to
                    citation cards, the packaged parts stay. A custom node's card carries
                    `data-node-name`, so `demo-review-card[data-node-name='citation']`
                    styles citations without inspecting its own children to find them. */}
                <CitationCardActions />
              </DocxEditorReview>
            </DocxEditor.Viewport>
            <DocxEditor.PageNumber />
            {/* Floating diagnostics chrome, above the overlay panels. */}
            <PerfHud />
            <CitationPopover
              card={citationCard}
              onOpen={setCitationCard}
              onClose={closeCitationCard}
            />
            {citationForm ? (
              <CitationDialog form={citationForm} onClose={closeCitationForm} />
            ) : null}
          </div>
        </DocxEditor.Root>
      ) : loadError ? (
        // A failed fetch is NOT a loading state: it is terminal, and routing it through
        // the polite live region would announce it as progress. Its own assertive region.
        <div className="demo-loading" role="alert">
          {`Could not load the document: ${loadError.message}`}
        </div>
      ) : (
        // The library's loading surface rather than a hand-rolled div: rendered outside
        // a `Root` it always shows, which is exactly this branch's condition. Children
        // replace the packaged screen, so the spinner is composed back in by name.
        <DocxEditor.Loading className="demo-loading">
          <DocxEditor.Loading.Spinner />
          <span>Loading document…</span>
        </DocxEditor.Loading>
      )}
    </div>
  );
}
