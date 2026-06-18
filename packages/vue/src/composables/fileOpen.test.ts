import { describe, test, expect, mock } from 'bun:test';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import { useFileIO, type UseFileIOOptions } from './useFileIO';

/**
 * File > Open customization parity with React (#873 / PR #874): when an
 * `onOpen` handler is supplied, the picked file is routed to it instead of the
 * built-in local load, and async failures surface through the `error` emit.
 */

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function makeDocxFile(name = 'sample.docx'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: DOCX_MIME });
}

function makeChangeEvent(file: File | null): Event {
  // useFileIO reads `event.target` as an <input type=file>; a plain stand-in
  // with `files`/`value` is enough for the onOpen branch (no DOM needed).
  const input = { files: file ? [file] : [], value: 'preset' } as unknown as HTMLInputElement;
  return { target: input } as unknown as Event;
}

function makeOptions(overrides: Partial<UseFileIOOptions>): UseFileIOOptions {
  return {
    loadBuffer: mock(async () => {}),
    loadParsedDocument: mock(() => {}),
    getDocument: () => null as Document | null,
    saveBlob: mock(async () => null),
    extractCommentsAndChanges: mock(() => {}),
    emit: mock(() => {}),
    documentName: () => undefined,
    getActiveView: () => null,
    nextTick: async () => {},
    ...overrides,
  };
}

describe('useFileIO — File > Open customization', () => {
  test('routes the picked file to onOpen instead of loading locally', async () => {
    const file = makeDocxFile('custom.docx');
    const onOpen = mock(async (_file: File) => {});
    const loadBuffer = mock(async () => {});
    const { handleDocxFileChange } = useFileIO(makeOptions({ onOpen, loadBuffer }));

    const event = makeChangeEvent(file);
    await handleDocxFileChange(event);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(file);
    expect(loadBuffer).not.toHaveBeenCalled();
    // Input is reset so the same file can be picked again.
    expect((event.target as HTMLInputElement).value).toBe('');
  });

  test('keeps the built-in load path when onOpen is omitted', async () => {
    const loadBuffer = mock(async () => {});
    const onOpen = undefined;
    const { handleDocxFileChange } = useFileIO(makeOptions({ onOpen, loadBuffer }));

    // No file selected → built-in path no-ops without throwing or routing.
    await handleDocxFileChange(makeChangeEvent(null));
    expect(loadBuffer).not.toHaveBeenCalled();
  });

  test('routes async onOpen failures through the error emit', async () => {
    const error = new Error('backend import failed');
    const onOpen = mock(async () => {
      throw error;
    });
    const emit = mock(() => {});
    const { handleDocxFileChange } = useFileIO(makeOptions({ onOpen, emit }));

    await handleDocxFileChange(makeChangeEvent(makeDocxFile()));

    expect(emit).toHaveBeenCalledWith('error', error);
  });
});
