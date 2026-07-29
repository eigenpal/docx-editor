// Browser harness for the PRODUCTION React adapter (comprehensive 4.4/4.8). Unlike DocxEditable
// (which drives the engine mount directly), this renders the real @docx-editor.dev/react DocxEditor
// with DOCX bytes and exposes the stable engine-neutral EditorDriver on window, so a browser test
// exercises the actual published package entry: props -> createEditor -> layout -> paint -> save.

import React, { Profiler, useEffect, useState } from 'react';

/**
 * React commit accounting for the renderer benchmarks.
 *
 * The run-grouping baseline needs commit counts, and asserting that a selection cost "is
 * React reconciling N elements" without measuring it is exactly the unsupported claim an
 * independent review caught. `Profiler` is the supported way to get it: `onRender` fires
 * once per commit of the wrapped tree with the real `actualDuration`.
 *
 * Exposed on `window` because the harness is loaded from the console. Reset by the
 * harness before each measured operation. Zero cost when nobody reads it — `Profiler` is
 * a no-op in production builds.
 */
declare global {
  interface Window {
    __docxProfiler?: { commits: number; totalDurationMs: number; reset: () => void };
  }
}

if (typeof window !== 'undefined' && !window.__docxProfiler) {
  window.__docxProfiler = {
    commits: 0,
    totalDurationMs: 0,
    reset() {
      this.commits = 0;
      this.totalDurationMs = 0;
    },
  };
}

const onEditorRender: React.ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
  const p = typeof window !== 'undefined' ? window.__docxProfiler : undefined;
  if (!p) return;
  p.commits += 1;
  p.totalDurationMs += actualDuration;
};
import { DocxEditor } from '@docx-editor.dev/react';
import { createEditorDriver, type EditorDriver } from '../../packages/core/src/editor/index.ts';
import { RawProseMirrorReference } from './RawProseMirrorReference';
import en from '../../packages/i18n/en.json';
import { loadDemoFontConfiguration } from './demoFontShaping';
import type { FontConfiguration } from '@docx-editor.dev/core-contract/contracts/editor';

/**
 * Resolve an i18n key against `packages/i18n/en.json`, imported directly.
 *
 * The HOST owns localization, not the adapter: the published adapters hold only
 * i18n keys so they ship no English of their own (CLAUDE.md forbids hardcoded
 * user-facing English in components, and `en.json` is the single source of truth).
 * The demo is the host here, so it does the resolving.
 */
function translate(key: string): string {
  const value = key.split('.').reduce<unknown>(
    (node, part) => {
      return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
    },
    en as Record<string, unknown>
  );
  // Surfacing the key is deliberate when a string is missing: a silent fallback to
  // the key's last segment reads like a real label and hides the gap.
  return typeof value === 'string' ? value : key;
}
import type { Editor } from '@docx-editor.dev/react';

declare global {
  interface Window {
    __docxAdapterDriver?: EditorDriver;
    /**
     * The public `Editor` facade, exposed so browser gates can dispatch a real
     * interaction and assert the TYPED OUTCOME, not just the visible result. A
     * silent no-op and a typed rejection look identical on screen; the
     * one-surface specs have to tell them apart.
     */
    __docxAdapterEditor?: Editor;
    __docxAdapterHarness?: {
      setZoom(zoom: number): void;
      getZoom(): number;
    };
  }
}

/**
 * Body text the raw PM reference starts from. Kept in the harness rather than read from
 * the document, so the two editors provably begin identical: the gate compares COMMAND
 * BEHAVIOR, and a mismatch in starting content would look like a command difference.
 */
/**
 * Fallback seed for the raw ProseMirror reference, used only if the document exposes no
 * editable paragraphs. The reference is normally seeded from the OPEN DOCUMENT (below):
 * a differential gate that holds different text in the two surfaces cannot compare them,
 * and the M6K.1 gate quietly asserted only against the reference because of it.
 */
const PM_REFERENCE_FALLBACK = [
  'The quick brown fox jumps over the lazy dog',
  'Second paragraph here',
  'Third',
];

import { BrandLogo } from './BrandLogo';
import { AdapterSwitcher } from './AdapterSwitcher';
import { ExampleSwitcher } from './ExampleSwitcher';
import { DEMO_BUTTON, DEMO_PRIMARY_BUTTON, DEMO_SECONDARY_BUTTON } from './demoButtons';
import { ThemeToggle } from './ThemeToggle';

/** `styles.button` / `newButton` / `fileInputLabel` from the legacy demo's App.tsx. */
// Shared adapter presentation and compatibility behavior.
// 1px border the source does not have, which made the title-bar row taller than the
// reference — exactly the kind of authored value the port rule forbids.


export function DocxAdapterHarness({
  fixtureUrl,
  initialZoom = 1,
}: {
  readonly fixtureUrl: string;
  readonly initialZoom?: number;
}): React.ReactElement {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fonts, setFonts] = useState<FontConfiguration | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [zoom, setZoom] = useState(initialZoom);
  // The document title is SHELL state: the engine owns no title contract (M4.0).
  const [title, setTitle] = useState('Untitled document');
  // The demo owns the colour mode, as the legacy demo does; `.dark` on the editor root is
  // what the token palette keys off.
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');
  const [editor, setEditor] = useState<Editor | null>(null);
  // Seeded from the real document once it opens, so the raw ProseMirror reference and
  // the production surface start from the SAME paragraphs.
  const [refParagraphs, setRefParagraphs] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [b, shaping] = await Promise.all([
          fetch(fixtureUrl).then(async (response) => new Uint8Array(await response.arrayBuffer())),
          loadDemoFontConfiguration(),
        ]);
        if (!cancelled) {
          setBytes(b);
          setFonts(shaping);
        }
      } catch (e) {
        if (!cancelled) setStatus(`Could not fetch fixture (${(e as Error).message}).`);
      }
    })();
    return () => {
      cancelled = true;
      delete window.__docxAdapterDriver;
      delete window.__docxAdapterEditor;
      delete window.__docxAdapterHarness;
    };
  }, [fixtureUrl]);

  useEffect(() => {
    window.__docxAdapterHarness = {
      setZoom: (next) => setZoom(next),
      getZoom: () => zoom,
    };
  }, [zoom]);

  const onReady = (editor: Editor): void => {
    const driver = createEditorDriver(editor);
    window.__docxAdapterDriver = driver;
    window.__docxAdapterEditor = editor;
    setEditor(editor);
    setStatus(driver.editable() ? 'Editable (paragraphs)' : 'Read-only (contains tables/SDTs)');
    const paragraphs = driver
      .accessibilityObservation()
      .entries.filter((e) => e.role === 'editableParagraph')
      .map((e) => e.text)
      .filter((t) => t.trim().length > 0)
      .slice(0, 3);
    setRefParagraphs(paragraphs.length > 0 ? paragraphs : PM_REFERENCE_FALLBACK);
  };

  const onSave = (): void => {
    void editor?.save();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Gate-visible status, VISUALLY hidden: it was a full-width grey strip pinned
          above the product's own header, which is not part of the editor and made the
          demo look like a debug page. The testid stays so e2e keeps reading it. */}
      <div
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
        }}
      >
        <span data-testid="adapter-status">{status}</span>
      </div>
      {/* Raw ProseMirror reference for the M6K.1 differential gate, behind `?pmref=1`
          so it never appears in the normal demo. */}
      {new URLSearchParams(window.location.search).get('pmref') === '1' && refParagraphs && (
        <RawProseMirrorReference paragraphs={refParagraphs} />
      )}
      {/* The production component composes its OWN chrome (task M6V.1). The demo no
          longer assembles a second shell out of the exported pieces — that is exactly
          how the demo and the published component drift apart. Supplying `t` turns the
          chrome on; everything else is the component's business. */}
      {bytes && fonts && (
        <Profiler id="docx-editor" onRender={onEditorRender}>
          <DocxEditor
            document={bytes}
            fonts={fonts}
            zoom={zoom}
            onReady={onReady}
            t={translate}
            // The demo owns the title-bar slots, as the legacy demo does — brand lockup and
            // the adapter/example switchers on the left, Open/New/Save on the right.
            // `AdapterSwitcher` and `ExampleSwitcher` are the components that already ship
            // in `examples/shared`; the editor no longer hand-rolls its own versions.
            renderTitleBarLeft={() => (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BrandLogo />
                <AdapterSwitcher current="react" />
                <ExampleSwitcher current="Vite" />
              </div>
            )}
            renderTitleBarRight={() => (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ThemeToggle value={colorMode} onChange={setColorMode} />
                <button style={DEMO_PRIMARY_BUTTON}>Open DOCX</button>
                <button style={DEMO_SECONDARY_BUTTON}>New</button>
                <button style={DEMO_BUTTON} onClick={onSave}>
                  Save
                </button>
              </div>
            )}
            title={title}
            onTitleChange={setTitle}
            onSave={onSave}
            colorMode={colorMode}
          />
        </Profiler>
      )}
    </div>
  );
}
