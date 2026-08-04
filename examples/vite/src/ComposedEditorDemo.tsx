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
import type { MouseEvent as ReactMouseEvent } from 'react';
import { zipSync, strToU8 } from 'fflate';
import {
  DocxEditor,
  useDocxEditor,
  useDocxSource,
  useEditorEvent,
  useFontFamily,
} from '@docx-editor.dev/react';
import { defaultFonts } from '@docx-editor.dev/fonts';
import { createT, en, type TranslationKey } from '@docx-editor.dev/i18n';
import { BrandLogo } from '../../shared/BrandLogo';
import { AdapterSwitcher } from '../../shared/AdapterSwitcher';
import { ExampleSwitcher } from '../../shared/ExampleSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { DEMO_BUTTON, DEMO_PRIMARY_BUTTON, DEMO_SECONDARY_BUTTON } from './demoButtons';

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────

/** English labels for the library toolbar's i18n keys. Demos are apps: English is fine. */
const tEnglish = createT(en);
const translate = (key: string): string => tEnglish(key as TranslationKey);

/** Keep the caret: chrome mousedown must never move focus out of the document. */
function keepCaret(event: ReactMouseEvent): void {
  event.preventDefault();
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** A minimal empty document, built the same way the adapter test suite builds one. */
function emptyDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t></w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

/** Hand DOCX bytes to the browser as a download. */
function downloadDocx(buffer: ArrayBuffer, name: string): void {
  const blob = new Blob([buffer], {
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
 * Custom items for the FontFamily popup: each document font as a single-line row
 * rendered in its own typeface, reference-picker style (the selected row gets the
 * library's right-aligned check). Options come from `useFontFamily()`, i.e. from
 * the DOCUMENT's font catalog — the list follows edits.
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
    const fontValue = fontState
      ? fontState.resolving
        ? 'resolving…'
        : fontState.measurer
      : '';
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
}: {
  title: string;
  onTitleChange: (next: string) => void;
  colorMode: 'light' | 'dark';
  onColorModeChange: (next: 'light' | 'dark') => void;
}) {
  const editor = useDocxEditor();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showPageSetup, setShowPageSetup] = useState(false);

  const openFile = (file: File) => {
    void file.arrayBuffer().then((buffer) => {
      editor?.load(new Uint8Array(buffer));
    });
  };
  const newDocument = () => editor?.load(emptyDocx());
  const saveDocument = () => {
    void editor?.save().then((buffer) => {
      const base = title.trim() || 'document';
      downloadDocx(buffer, `${base}.docx`);
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
          <AdapterSwitcher current="react" />
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
            t={translate}
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
            {/* A menu the library knows nothing about, with the host's own id and label. */}
            <DocxEditor.Menu.Menu id="review" label="Review">
              <DocxEditor.Menu.Row onSelect={() => window.alert('Sent for approval.')}>
                Send for approval
              </DocxEditor.Menu.Row>
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
      <DocxEditor.Toolbar t={translate} className="demo-toolbar" onSave={saveDocument}>
        <DocxEditor.Toolbar.FontFamily>
          <DocxEditor.Toolbar.FontFamily.Trigger className="demo-font-trigger" />
          <DocxEditor.Toolbar.FontFamily.Content className="demo-font-menu">
            <FontPreviewItems />
          </DocxEditor.Toolbar.FontFamily.Content>
        </DocxEditor.Toolbar.FontFamily>
      </DocxEditor.Toolbar>

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
  const [title, setTitle] = useState('Sample Document');
  const [showOutline, setShowOutline] = useState(false);

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
          {...(fonts ? { fonts } : {})}
          onFontError={(error) => console.warn(`[fonts] ${error.code}: ${error.message}`)}
        >
          <EditorChrome
            title={title}
            onTitleChange={setTitle}
            colorMode={colorMode}
            onColorModeChange={setColorMode}
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
              {/* The link popover. Inside the viewport so it stays with the page while
                  scrolling. `<DocxEditor>` mounts it for you; a composition like this one
                  places it by name, exactly like the rulers above. */}
              <DocxEditor.HyperLink />
              {/* The review rail: tracked changes and comments as cards beside the page,
                  with accept / reject / reply. Inside the viewport for the same reason as
                  the popover — it scrolls with the document rather than chasing it. */}
              <DocxEditor.Review />
            </DocxEditor.Viewport>
            {/* Floating diagnostics chrome, above the overlay panels. */}
            <PerfHud />
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
