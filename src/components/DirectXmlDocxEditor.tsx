import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Plugin, PluginKey } from 'prosemirror-state';
import { parseDocx } from '../docx/parser';
import {
  applyRealDocChanges,
  type ApplyRealDocChangesOptions,
  type RealDocChangeOperation,
} from '../docx/realDocumentChangeStrategy';
import { getEditedParagraphIdsFromTransaction } from '../prosemirror/transactionParagraphTracker';
import type { Document } from '../types/document';
import { toArrayBuffer } from '../utils/docxInput';
import { DocxEditor, type DocxEditorProps, type DocxEditorRef } from './DocxEditor';
import {
  areDocumentsSaveEquivalent,
  cloneArrayBuffer,
  cloneDocumentForBaseline,
} from './docSaveEquivalence';

const PARAGRAPH_TRACKER_PLUGIN_KEY = new PluginKey('direct-xml-paragraph-tracker');

export interface DirectXmlOperationContext {
  currentDocument: Document;
  baselineDocument: Document;
  editedParagraphIds?: string[];
}

export interface DirectXmlDocxEditorProps extends Omit<DocxEditorProps, 'onSave'> {
  onSave?: (buffer: ArrayBuffer) => void;
  /**
   * Enable direct OOXML save strategy.
   * Default: true
   */
  useDirectXmlSave?: boolean;
  /**
   * Build direct OOXML operations for the current document state.
   * Required when useDirectXmlSave is true.
   */
  buildDirectXmlOperations?: (
    context: DirectXmlOperationContext
  ) => RealDocChangeOperation[] | Promise<RealDocChangeOperation[]>;
  /**
   * Options passed to applyRealDocChanges.
   */
  directXmlSaveOptions?: ApplyRealDocChangesOptions;
  /**
   * If true, uses DocxEditor's default model save when direct XML save cannot proceed.
   * Default: false
   */
  fallbackToModelSaveOnUnsupported?: boolean;
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}

export const DirectXmlDocxEditor = forwardRef<DocxEditorRef, DirectXmlDocxEditorProps>(
  function DirectXmlDocxEditor(
    {
      onSave,
      onError,
      useDirectXmlSave = true,
      buildDirectXmlOperations,
      directXmlSaveOptions,
      fallbackToModelSaveOnUnsupported = false,
      externalPlugins,
      documentBuffer,
      document: initialDocument,
      ...restProps
    },
    ref
  ) {
    const innerRef = useRef<DocxEditorRef>(null);
    const baselineLoadTokenRef = useRef(0);
    const baselineDocumentRef = useRef<Document | null>(
      initialDocument ? cloneDocumentForBaseline(initialDocument) : null
    );
    const baselineBufferRef = useRef<ArrayBuffer | null>(
      initialDocument?.originalBuffer ? cloneArrayBuffer(initialDocument.originalBuffer) : null
    );
    const editedParagraphIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
      if (!documentBuffer) {
        return;
      }

      const loadToken = baselineLoadTokenRef.current + 1;
      baselineLoadTokenRef.current = loadToken;
      baselineDocumentRef.current = null;
      baselineBufferRef.current = null;
      editedParagraphIdsRef.current = new Set();

      (async () => {
        try {
          const normalizedBuffer = await toArrayBuffer(documentBuffer);
          if (baselineLoadTokenRef.current !== loadToken) {
            return;
          }

          baselineBufferRef.current = cloneArrayBuffer(normalizedBuffer);
          const parsed = await parseDocx(cloneArrayBuffer(normalizedBuffer));
          if (baselineLoadTokenRef.current !== loadToken) {
            return;
          }

          baselineDocumentRef.current = cloneDocumentForBaseline(parsed);
          baselineBufferRef.current = parsed.originalBuffer
            ? cloneArrayBuffer(parsed.originalBuffer)
            : cloneArrayBuffer(normalizedBuffer);
        } catch (error) {
          if (baselineLoadTokenRef.current !== loadToken) {
            return;
          }
          baselineDocumentRef.current = null;
          onError?.(
            toError(
              error,
              'Failed to parse baseline DOCX for direct XML save. Falling back may be required.'
            )
          );
        }
      })();
    }, [documentBuffer, onError]);

    useEffect(() => {
      if (documentBuffer) {
        return;
      }

      if (initialDocument) {
        baselineLoadTokenRef.current += 1;
        baselineDocumentRef.current = cloneDocumentForBaseline(initialDocument);
        baselineBufferRef.current = initialDocument.originalBuffer
          ? cloneArrayBuffer(initialDocument.originalBuffer)
          : null;
        editedParagraphIdsRef.current = new Set();
        return;
      }

      baselineLoadTokenRef.current += 1;
      baselineDocumentRef.current = null;
      baselineBufferRef.current = null;
      editedParagraphIdsRef.current = new Set();
    }, [initialDocument, documentBuffer]);

    const paragraphTrackerPlugin = useMemo(
      () =>
        new Plugin({
          key: PARAGRAPH_TRACKER_PLUGIN_KEY,
          state: {
            init: () => null,
            apply: (transaction, value, _oldState, newState) => {
              if (!transaction.docChanged) {
                return value;
              }

              const editedParagraphIds = getEditedParagraphIdsFromTransaction(
                transaction,
                newState
              );
              const accumulator = editedParagraphIdsRef.current;
              for (const paraId of editedParagraphIds) {
                accumulator.add(paraId);
              }
              return value;
            },
          },
        }),
      []
    );

    const mergedPlugins = useMemo(() => {
      const plugins = externalPlugins ? [...externalPlugins] : [];
      plugins.push(paragraphTrackerPlugin);
      return plugins;
    }, [externalPlugins, paragraphTrackerPlugin]);

    const saveWithModelPipeline = useCallback(async (): Promise<ArrayBuffer | null> => {
      const inner = innerRef.current;
      if (!inner) {
        return null;
      }

      const saved = await inner.save();
      if (!saved) {
        return null;
      }

      const currentDocument = inner.getDocument();
      if (currentDocument) {
        baselineDocumentRef.current = cloneDocumentForBaseline(currentDocument);
      }
      baselineBufferRef.current = cloneArrayBuffer(saved);
      editedParagraphIdsRef.current = new Set();
      onSave?.(saved);
      return saved;
    }, [onSave]);

    const saveWithDirectXmlPipeline = useCallback(async (): Promise<ArrayBuffer | null> => {
      const inner = innerRef.current;
      if (!inner) {
        return null;
      }

      const currentDocument = inner.getDocument();
      if (!currentDocument) {
        return null;
      }

      const baselineDocument = baselineDocumentRef.current;
      const baselineBuffer = baselineBufferRef.current;
      if (!baselineDocument || !baselineBuffer) {
        if (fallbackToModelSaveOnUnsupported) {
          return saveWithModelPipeline();
        }
        throw new Error(
          'Direct XML save requires a baseline DOCX buffer and baseline parsed document'
        );
      }

      if (!buildDirectXmlOperations) {
        if (fallbackToModelSaveOnUnsupported) {
          return saveWithModelPipeline();
        }
        throw new Error('Direct XML save is enabled but buildDirectXmlOperations is not provided');
      }

      const operations = await buildDirectXmlOperations({
        currentDocument,
        baselineDocument,
        editedParagraphIds: [...editedParagraphIdsRef.current],
      });

      if (operations.length === 0) {
        if (areDocumentsSaveEquivalent(currentDocument, baselineDocument)) {
          const untouchedBuffer = cloneArrayBuffer(baselineBuffer);
          baselineDocumentRef.current = cloneDocumentForBaseline(currentDocument);
          baselineBufferRef.current = cloneArrayBuffer(untouchedBuffer);
          editedParagraphIdsRef.current = new Set();
          onSave?.(untouchedBuffer);
          return untouchedBuffer;
        }
        if (fallbackToModelSaveOnUnsupported) {
          return saveWithModelPipeline();
        }
        throw new Error(
          'Direct XML save produced no operations for a modified document. Refusing to fall back silently.'
        );
      }

      const result = await applyRealDocChanges(cloneArrayBuffer(baselineBuffer), operations, {
        strict: true,
        ...directXmlSaveOptions,
      });

      baselineDocumentRef.current = cloneDocumentForBaseline(currentDocument);
      baselineBufferRef.current = cloneArrayBuffer(result.buffer);
      editedParagraphIdsRef.current = new Set();
      onSave?.(result.buffer);
      return result.buffer;
    }, [
      buildDirectXmlOperations,
      directXmlSaveOptions,
      fallbackToModelSaveOnUnsupported,
      onSave,
      saveWithModelPipeline,
    ]);

    const handleSave = useCallback(async (): Promise<ArrayBuffer | null> => {
      try {
        if (!useDirectXmlSave) {
          return saveWithModelPipeline();
        }
        return saveWithDirectXmlPipeline();
      } catch (error) {
        onError?.(toError(error, 'Failed to save document'));
        return null;
      }
    }, [onError, saveWithDirectXmlPipeline, saveWithModelPipeline, useDirectXmlSave]);

    useImperativeHandle(
      ref,
      () => ({
        getAgent: () => innerRef.current?.getAgent() || null,
        getDocument: () => innerRef.current?.getDocument() || null,
        getEditorRef: () => innerRef.current?.getEditorRef() || null,
        save: handleSave,
        setZoom: (zoom: number) => innerRef.current?.setZoom(zoom),
        getZoom: () => innerRef.current?.getZoom() ?? 1,
        focus: () => innerRef.current?.focus(),
        getCurrentPage: () => innerRef.current?.getCurrentPage() ?? 1,
        getTotalPages: () => innerRef.current?.getTotalPages() ?? 1,
        scrollToPage: (pageNumber: number) => innerRef.current?.scrollToPage(pageNumber),
        openPrintPreview: () => innerRef.current?.openPrintPreview(),
        print: () => innerRef.current?.print(),
      }),
      [handleSave]
    );

    return (
      <DocxEditor
        ref={innerRef}
        {...restProps}
        documentBuffer={documentBuffer}
        document={initialDocument}
        onError={onError}
        onSave={undefined}
        externalPlugins={mergedPlugins}
      />
    );
  }
);
