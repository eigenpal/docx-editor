// Browser harness for the PRODUCTION React adapter (comprehensive 4.4/4.8). Unlike DocxEditable
// (which drives the engine mount directly), this renders the real @docx-editor.dev/react DocxEditor
// with DOCX bytes and exposes the stable engine-neutral EditorDriver on window, so a browser test
// exercises the actual published package entry: props -> createEditor -> layout -> paint -> save.

import React, { useEffect, useState } from 'react';
import {
  DocxEditor,
} from '@docx-editor.dev/react';
import { createEditorDriver, type EditorDriver } from '@docx-editor.dev/engine-editor';
import { RawProseMirrorReference } from './RawProseMirrorReference';
import en from '../../packages/i18n/en.json';

/**
 * Resolve an i18n key against `packages/i18n/en.json`, imported directly.
 *
 * The HOST owns localization, not the adapter: the published adapters hold only
 * i18n keys so they ship no English of their own (CLAUDE.md forbids hardcoded
 * user-facing English in components, and `en.json` is the single source of truth).
 * The demo is the host here, so it does the resolving.
 */
function translate(key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => {
    return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  }, en as Record<string, unknown>);
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
const PM_REFERENCE_FALLBACK = ['The quick brown fox jumps over the lazy dog', 'Second paragraph here', 'Third'];

export function DocxAdapterHarness({
  fixtureUrl,
  initialZoom = 1,
}: {
  readonly fixtureUrl: string;
  readonly initialZoom?: number;
}): React.ReactElement {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [zoom, setZoom] = useState(initialZoom);
  // The document title is SHELL state: the engine owns no title contract (M4.0).
  const [title, setTitle] = useState('Untitled document');
  const [editor, setEditor] = useState<Editor | null>(null);
  // Seeded from the real document once it opens, so the raw ProseMirror reference and
  // the production surface start from the SAME paragraphs.
  const [refParagraphs, setRefParagraphs] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const b = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
        if (!cancelled) setBytes(b);
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
      <div style={{ padding: '8px 12px', font: '13px system-ui, sans-serif', color: '#333', borderBottom: '1px solid #e0e0e0' }}>
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
      {bytes && (
        <DocxEditor
          document={bytes}
          zoom={zoom}
          onReady={onReady}
          t={translate}
          title={title}
          onTitleChange={setTitle}
          onSave={onSave}
        />
      )}
    </div>
  );
}
