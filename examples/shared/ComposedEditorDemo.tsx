// The FLAGSHIP demo: the provider-first composition API, end to end.
//
// Everything on screen is composed under `<DocxEditor.Root>`: the library's compound
// toolbar (the FULL chrome registry by default, with the FontFamily slot overridden
// in place by a composed picker), and a completely demo-owned header — File / Format /
// Help menus, an editable title, live status, Open/New/Save actions — built from
// nothing but the public hooks (`useDocxEditor`, `useEditorState`, `useEditorCommand`,
// `useFontFamily`). No library chrome components are used for the header on purpose:
// it demonstrates that ANY React tree composes under Root.
//
// The library toolbar's styling comes from the CORE stylesheet (`docx-toolbar`
// family); this demo styles only its own header and menus.

import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { zipSync, strToU8 } from 'fflate';
import {
  DocxEditor,
  useDocxEditor,
  useEditorCommand,
  useEditorState,
  useFontFamily,
  type ChromeSlotId,
  type EditorSnapshot,
} from '@docx-editor.dev/react';
import { createT, en, type TranslationKey } from '@docx-editor.dev/i18n';
import { BrandLogo } from './BrandLogo';
import { AdapterSwitcher } from './AdapterSwitcher';
import { ExampleSwitcher } from './ExampleSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { DEMO_BUTTON, DEMO_PRIMARY_BUTTON, DEMO_SECONDARY_BUTTON } from './demoButtons';

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────

/** English labels for the library toolbar's i18n keys. Demos are apps: English is fine. */
const tEnglish = createT(en);
const translate = (key: string): string => tEnglish(key as TranslationKey);

/** Stable selectors so `useEditorState` memoization holds across renders. */
const selectPage = (snapshot: EditorSnapshot) => snapshot.page;
const selectEditable = (snapshot: EditorSnapshot) => snapshot.editable;

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
// Demo-local dropdown menu (plain React, not library parts — that is the point)
// ─────────────────────────────────────────────────────────────────────────────

function DemoMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: globalThis.MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  return (
    <div className="demo-menu" ref={rootRef}>
      <button
        type="button"
        className={`demo-menu__trigger${open ? ' demo-menu__trigger--open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={keepCaret}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </button>
      {open ? (
        <div role="menu" className="demo-menu__list" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  onSelect,
  checked,
  disabled,
  title,
  children,
}: {
  onSelect: () => void;
  checked?: boolean;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="demo-menu__item"
      disabled={disabled}
      title={title}
      onMouseDown={keepCaret}
      onClick={onSelect}
    >
      <span className="demo-menu__check" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      <span className="demo-menu__label">{children}</span>
    </button>
  );
}

/** A menu item bound to one chrome slot through `useEditorCommand`. */
function CommandMenuItem({ slot, children }: { slot: ChromeSlotId; children: ReactNode }) {
  const command = useEditorCommand(slot);
  return (
    <MenuItem
      onSelect={command.execute}
      checked={command.isActive}
      disabled={!command.isEnabled}
      title={command.disabledReason ?? undefined}
    >
      {children}
    </MenuItem>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header menus: File / Format / Help — all hook-built
// ─────────────────────────────────────────────────────────────────────────────

function FormatMenu() {
  return (
    <DemoMenu label="Format">
      <CommandMenuItem slot="text.bold">Bold</CommandMenuItem>
      <CommandMenuItem slot="text.italic">Italic</CommandMenuItem>
      <CommandMenuItem slot="text.underline">Underline</CommandMenuItem>
      <CommandMenuItem slot="text.strike">Strikethrough</CommandMenuItem>
      <div className="demo-menu__separator" role="separator" />
      <CommandMenuItem slot="alignment.left">Align left</CommandMenuItem>
      <CommandMenuItem slot="alignment.center">Align center</CommandMenuItem>
      <CommandMenuItem slot="alignment.right">Align right</CommandMenuItem>
      <CommandMenuItem slot="alignment.justify">Justify</CommandMenuItem>
    </DemoMenu>
  );
}

function InsertMenu() {
  // The chrome spec's menu row is File · Format · Insert · Help. Image and table
  // insertion are UNWIRED engine slots (`image.insert` / `table.insert`), so the items
  // bind through `useEditorCommand` and render disabled with the engine's own reason —
  // present but disabled, never faked.
  return (
    <DemoMenu label="Insert">
      <CommandMenuItem slot="image.insert">Image</CommandMenuItem>
      <CommandMenuItem slot="table.insert">Table</CommandMenuItem>
    </DemoMenu>
  );
}

function HelpMenu() {
  return (
    <DemoMenu label="Help">
      <a
        className="demo-menu__item"
        href="https://docx-editor.dev"
        target="_blank"
        rel="noreferrer"
        role="menuitem"
      >
        <span className="demo-menu__check" aria-hidden="true" />
        <span className="demo-menu__label">Documentation</span>
      </a>
    </DemoMenu>
  );
}

/** Live page + editability chip straight off the snapshot. */
function StatusChip() {
  const page = useEditorState(selectPage);
  const editable = useEditorState(selectEditable);
  return (
    <span className="demo-status-chip" data-testid="composed-status">
      <span>{`Page ${page.current} / ${page.total}`}</span>
      <span className="demo-status-chip__dot" aria-hidden="true" />
      <span>{editable ? 'Editing' : 'Read-only'}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar customization: the in-place FontFamily override with typeface previews
// ─────────────────────────────────────────────────────────────────────────────

const PANGRAM = 'Sphinx of black quartz, judge my vow.';

/**
 * Custom items for the FontFamily popup: each document font rendered in its own
 * typeface with a pangram preview line. Options come from `useFontFamily()`, i.e.
 * from the DOCUMENT's font catalog — the list follows edits.
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
          <span className="demo-font-item__preview" style={{ fontFamily: family }}>
            {PANGRAM}
          </span>
        </DocxEditor.Toolbar.FontFamily.Item>
      ))}
    </>
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
    <>
      <header className="demo-header">
        <div className="demo-header__left">
          <BrandLogo />
          <AdapterSwitcher current="react" />
          <ExampleSwitcher current="Vite" />
        </div>

        {/* Title with the File / Format / Help menu row beneath, Docs-style. */}
        <div className="demo-header__title-block">
          <input
            className="demo-title"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            aria-label="Document title"
            spellCheck={false}
          />
          <nav className="demo-header__menus" aria-label="Document menus">
            <DemoMenu label="File">
              <MenuItem onSelect={() => fileInputRef.current?.click()} disabled={!editor}>
                Open&hellip;
              </MenuItem>
              <MenuItem onSelect={newDocument} disabled={!editor}>
                New
              </MenuItem>
              <MenuItem onSelect={saveDocument} disabled={!editor}>
                Save as .docx
              </MenuItem>
            </DemoMenu>
            <FormatMenu />
            <InsertMenu />
            <HelpMenu />
          </nav>
        </div>

        <div className="demo-header__right">
          <StatusChip />
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
          document-derived family in its own typeface with a pangram preview. Save is
          live because the toolbar was given an onSave handler. */}
      <DocxEditor.Toolbar t={translate} className="demo-toolbar" onSave={saveDocument}>
        <DocxEditor.Toolbar.FontFamily>
          <DocxEditor.Toolbar.FontFamily.Trigger className="demo-font-trigger" />
          <DocxEditor.Toolbar.FontFamily.Content className="demo-font-menu">
            <FontPreviewItems />
          </DocxEditor.Toolbar.FontFamily.Content>
        </DocxEditor.Toolbar.FontFamily>
      </DocxEditor.Toolbar>

      {/* The context-fed horizontal ruler, placed per the chrome spec: below the toolbar,
          centered over the page column. Read-only — the engine has no margin
          commands yet, so nothing here pretends to drag. */}
      <div className="demo-ruler-row" aria-hidden="true">
        <DocxEditor.HorizontalRuler />
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The demo surface
// ─────────────────────────────────────────────────────────────────────────────

export function ComposedEditorDemo({ fixtureUrl }: { fixtureUrl: string }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');
  const [title, setTitle] = useState('Sample Document');
  const [showOutline, setShowOutline] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(fixtureUrl);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const buffer = await response.arrayBuffer();
        if (!cancelled) setBytes(new Uint8Array(buffer));
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fixtureUrl]);

  return (
    <div
      className={`ep-root demo-app${colorMode === 'dark' ? ' dark' : ''}`}
      data-testid="composed-mount"
    >
      {bytes ? (
        <DocxEditor.Root document={bytes}>
          <EditorChrome
            title={title}
            onTitleChange={setTitle}
            colorMode={colorMode}
            onColorModeChange={setColorMode}
          />
          {/* The chrome spec's layout: the heading outline in a left sidebar beside
              the scrolled page column, collapsible. */}
          <div className="demo-main">
            {showOutline ? (
              <aside className="demo-outline">
                <DocxEditor.DocumentOutline onClose={() => setShowOutline(false)} />
              </aside>
            ) : (
              <button
                type="button"
                className="docx-outline-toggle demo-outline-toggle"
                aria-label="Show document outline"
                title="Show document outline"
                onMouseDown={keepCaret}
                onClick={() => setShowOutline(true)}
              >
                <svg viewBox="0 -960 960 960" width={20} height={20} aria-hidden="true">
                  <path
                    d="M120-240v-80h240v80H120Zm0-200v-80h480v80H120Zm0-200v-80h720v80H120Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            )}
            <DocxEditor.Viewport className="demo-viewport">
              <DocxEditor.Content />
            </DocxEditor.Viewport>
          </div>
        </DocxEditor.Root>
      ) : (
        <div className="demo-loading" data-testid="composed-loading">
          {loadError ? `Could not load the document: ${loadError}` : 'Loading document…'}
        </div>
      )}
    </div>
  );
}
