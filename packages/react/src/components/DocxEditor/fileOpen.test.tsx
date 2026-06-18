import '@happy-dom/global-registrator/register';
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import type { DocumentAgent } from '@eigenpal/docx-editor-core/agent';
import type { DocxInput } from '@eigenpal/docx-editor-core/utils';
import { useFileIO } from './hooks/useFileIO';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { DocxEditorToolbar } from './DocxEditorToolbar';
import type { PagedEditorRef } from './PagedEditor';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

afterEach(() => {
  cleanup();
});

function makeDocxFile(name = 'sample.docx') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: DOCX_MIME });
}

function FileIOHarness({
  onOpen,
  loadBuffer,
  onError,
  onDocumentNameChange,
}: {
  onOpen?: (file: File) => void | Promise<void>;
  loadBuffer: (buffer: DocxInput) => Promise<void>;
  onError?: (error: Error) => void;
  onDocumentNameChange?: (name: string) => void;
}) {
  const agentRef = useRef<DocumentAgent | null>(null);
  const pagedEditorRef = useRef<PagedEditorRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileIO = useFileIO({
    agentRef,
    pagedEditorRef,
    containerRef,
    comments: [],
    documentName: undefined,
    onSave: undefined,
    onOpen,
    onError,
    onPrint: undefined,
    onDocumentNameChange,
    loadBuffer,
    getActiveEditorView: () => null,
    focusActiveEditor: () => {},
  });

  return (
    <>
      <div ref={containerRef} />
      <input
        aria-label="docx input"
        ref={fileIO.docxInputRef}
        type="file"
        accept=".docx"
        onChange={fileIO.handleDocxFileChange}
      />
    </>
  );
}

function KeyboardHarness({
  showFileOpen,
  onOpenDocument,
}: {
  showFileOpen: boolean;
  onOpenDocument?: () => void;
}) {
  const pagedEditorRef = useRef<PagedEditorRef | null>(null);
  useKeyboardShortcuts({
    pagedEditorRef,
    disableFindReplaceShortcuts: false,
    showFileOpen,
    onOpenDocument,
    findReplace: {
      openFind: mock(() => {}),
      openReplace: mock(() => {}),
    } as never,
    hyperlinkDialog: {
      openInsert: mock(() => {}),
      openEdit: mock(() => {}),
    } as never,
    tableSelection: {
      state: { tableIndex: null },
      handleAction: mock(() => {}),
    } as never,
  });

  return null;
}

function dispatchCtrlO() {
  const event = new KeyboardEvent('keydown', {
    key: 'o',
    ctrlKey: true,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

function renderToolbar({ showFileOpen, onOpen }: { showFileOpen: boolean; onOpen: () => void }) {
  const noop = () => {};
  return render(
    <DocxEditorToolbar
      toolbarRefCallback={noop}
      agentPanelOpen={false}
      setAgentPanelOpen={noop}
      document={null}
      theme={null}
      pmState={null}
      selectionFormatting={{}}
      tableContext={null}
      imageContext={null}
      readOnly={false}
      editingMode="editing"
      setEditingMode={noop}
      setShowCommentsSidebar={noop}
      setExpandedSidebarItem={noop}
      showCommentsSidebar={false}
      agentPanel={undefined}
      renderLogo={undefined}
      documentName={undefined}
      onDocumentNameChange={undefined}
      documentNameEditable={true}
      renderTitleBarRight={undefined}
      toolbarExtra={null}
      fontFamilies={undefined}
      zoom={1}
      showZoomControl={false}
      onFormat={noop}
      onUndo={noop}
      onRedo={noop}
      onPrint={noop}
      showFileOpen={showFileOpen}
      showHelpMenu={true}
      onOpen={onOpen}
      onSave={noop}
      onZoomChange={noop}
      onRefocusEditor={noop}
      onInsertTable={noop}
      onInsertImage={noop}
      onInsertPageBreak={noop}
      onInsertSectionBreakNextPage={noop}
      onInsertSectionBreakContinuous={noop}
      onInsertTOC={noop}
      onImageWrapType={noop}
      onImageTransform={noop}
      onOpenImageProperties={noop}
      onPageSetup={noop}
      onWatermark={noop}
      onTableAction={noop}
    />
  );
}

describe('File > Open customization', () => {
  test('passes the picked File to onOpen instead of loading locally', async () => {
    const file = makeDocxFile('custom.docx');
    const onOpen = mock(async (_file: File) => {});
    const loadBuffer = mock(async (_buffer: DocxInput) => {});

    const { getByLabelText } = render(<FileIOHarness onOpen={onOpen} loadBuffer={loadBuffer} />);
    fireEvent.change(getByLabelText('docx input'), { target: { files: [file] } });

    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onOpen).toHaveBeenCalledWith(file);
    expect(loadBuffer).not.toHaveBeenCalled();
  });

  test('keeps the built-in load path when onOpen is omitted', async () => {
    const file = makeDocxFile('built-in.docx');
    const loadBuffer = mock(async (_buffer: DocxInput) => {});
    const onDocumentNameChange = mock((_name: string) => {});

    const { getByLabelText } = render(
      <FileIOHarness loadBuffer={loadBuffer} onDocumentNameChange={onDocumentNameChange} />
    );
    fireEvent.change(getByLabelText('docx input'), { target: { files: [file] } });

    await waitFor(() => expect(loadBuffer).toHaveBeenCalledTimes(1));
    const buffer = loadBuffer.mock.calls[0][0] as ArrayBuffer;
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3]);
    expect(onDocumentNameChange).toHaveBeenCalledWith('built-in');
  });

  test('routes async onOpen failures through onError', async () => {
    const error = new Error('backend import failed');
    const onOpen = mock(async () => {
      throw error;
    });
    const onError = mock((_error: Error) => {});

    const { getByLabelText } = render(
      <FileIOHarness
        onOpen={onOpen}
        onError={onError}
        loadBuffer={mock(async (_buffer: DocxInput) => {})}
      />
    );
    fireEvent.change(getByLabelText('docx input'), {
      target: { files: [makeDocxFile()] },
    });

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith(error);
  });

  test('showFileOpen=false hides Open and leaves Ctrl+O unhandled', () => {
    const onOpen = mock(() => {});
    const onOpenDocument = mock(() => {});

    const toolbar = renderToolbar({ showFileOpen: false, onOpen });
    render(<KeyboardHarness showFileOpen={false} onOpenDocument={onOpenDocument} />);

    fireEvent.click(toolbar.getByRole('button', { name: 'File' }));
    expect(toolbar.queryByText('Open')).toBeNull();
    expect(toolbar.getByText('Save')).toBeTruthy();

    const event = dispatchCtrlO();
    expect(onOpenDocument).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
